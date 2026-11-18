#include <Arduino.h>
#include <cmath>
#include <cstring>

#include "AdcDmaSampler.h"
#include "CanBusManager.h"
#include "Sht40Sensor.h"
#include "VibrationDSP.h"
#include "WebTelemetryBridge.h"
#include "board_pins.h"
#include "can_protocol.h"
#include "techbit_config.h"

#ifndef WHEEL_NODE_ID
#define WHEEL_NODE_ID 0
#endif

#ifndef ENABLE_SHT40
#define ENABLE_SHT40 1
#endif

#ifndef TECHBIT_SERIAL_DEFAULT_JSON
#define TECHBIT_SERIAL_DEFAULT_JSON 1
#endif

using namespace techbit;

namespace {

AdcDmaSampler       g_adc;
dsp::VibrationDSP   g_dsp;
CanBusManager       g_can;
Sht40Sensor         g_sht40;
WebTelemetryBridge  g_webBridge;

uint8_t             g_wheelId = WHEEL_NODE_ID;
uint16_t            g_rawSamples[dsp::kDspFftSize];

// Accumulator across kFramesPerCanReport (2 x 25.6 ms = 51.2 ms)
uint8_t             g_frameCounter     = 0;
float               g_accRmsSq         = 0.0f;
float               g_accPeakMv        = 0.0f;
float               g_accKurtosis      = 0.0f;
float               g_accBandLow       = 0.0f;
float               g_accBandMid       = 0.0f;
float               g_accBandHigh      = 0.0f;
float               g_accCentroidHz    = 0.0f;
float               g_accTonality      = 0.0f;
float               g_bestDominantFreq = 0.0f;
float               g_bestFrameRms     = -1.0f;
bool                g_accSurgeClip     = false;
float               g_lastDcOffsetMv   = 1650.0f;
float               g_lastZeroCrossHz  = 0.0f;
float               g_bestSpectrum32[32] = {};

uint32_t            g_lastPrintMs      = 0;
uint32_t            g_lastBlinkMs      = 0;
bool                g_ledState         = false;
bool                g_hubCalibAck      = false;
uint32_t            g_calibAckUntilMs  = 0;

void setStatusLed(bool on) {
#if !ENABLE_SHT40
    // Onboard blue LED on ESP32-C3 SuperMini shares GPIO8 with I2C SDA; only use when SHT40 is off.
    g_ledState = on;
    digitalWrite(PIN_STATUS_LED, (STATUS_LED_ACTIVE_LOW ? !on : on) ? HIGH : LOW);
#else
    (void)on;
#endif
}

uint8_t resolveWheelId() {
    pinMode(PIN_ID_ENABLE, INPUT_PULLUP);
    pinMode(PIN_ID_BIT0, INPUT_PULLUP);
    pinMode(PIN_ID_BIT1, INPUT_PULLUP);
    delay(2);

    // If hardware DIP/solder pad PIN_ID_ENABLE is pulled LOW, read 2-bit wheel ID from pins
    if (digitalRead(PIN_ID_ENABLE) == LOW) {
        uint8_t bit0 = (digitalRead(PIN_ID_BIT0) == LOW) ? 1U : 0U;
        uint8_t bit1 = (digitalRead(PIN_ID_BIT1) == LOW) ? 1U : 0U;
        return static_cast<uint8_t>((bit1 << 1) | bit0);
    }

    int8_t savedId = WebTelemetryBridge::loadSavedWheelId();
    if (savedId >= 0) {
        return static_cast<uint8_t>(savedId);
    }

    return static_cast<uint8_t>(WHEEL_NODE_ID & 0x03);
}

#ifdef ENABLE_NTC_TEMP
float computeNtcTempC(uint16_t rawAdc) {
    // Assumes 10k NTC to GND, 10k pullup to 3.3V, Beta = 3950 K
    if (rawAdc < 30 || rawAdc > 4065) return 0.0f;
    constexpr float kSeriesRes = 10000.0f;
    constexpr float kNtcNomRes = 10000.0f;
    constexpr float kBeta      = 3950.0f;
    constexpr float kT0Kelvin  = 298.15f; // 25 C

    float ratio = static_cast<float>(rawAdc) / (static_cast<float>(kAdcMaxCounts) - static_cast<float>(rawAdc));
    float rNtc  = kSeriesRes * ratio;
    float invT  = (1.0f / kT0Kelvin) + (1.0f / kBeta) * std::log(rNtc / kNtcNomRes);
    return (1.0f / invT) - 273.15f;
}
#endif

void resetWindowAccumulator() {
    g_frameCounter     = 0;
    g_accRmsSq         = 0.0f;
    g_accPeakMv        = 0.0f;
    g_accKurtosis      = 0.0f;
    g_accBandLow       = 0.0f;
    g_accBandMid       = 0.0f;
    g_accBandHigh      = 0.0f;
    g_accCentroidHz    = 0.0f;
    g_accTonality      = 0.0f;
    g_bestDominantFreq = 0.0f;
    g_bestFrameRms     = -1.0f;
    g_accSurgeClip     = false;
    std::memset(g_bestSpectrum32, 0, sizeof(g_bestSpectrum32));
}

void pollCanCommands() {
    CanFrame rx{};
    while (g_can.receiveFrame(rx)) {
        if (rx.id == can::kCanIdHubCommand && rx.dlc >= 1) {
            if (rx.data[0] == can::CMD_START_CALIB) {
                g_hubCalibAck     = true;
                g_calibAckUntilMs = millis() + kCalibrationDurationMs;
            }
        }
    }
}

void processBridgeCommands() {
    char cmd[WebTelemetryBridge::kCmdLineMax];
    while (g_webBridge.pollCommand(cmd, sizeof(cmd))) {
        if (std::strncmp(cmd, "wheel ", 6) == 0) {
            int newId = std::atoi(cmd + 6);
            if (newId >= 0 && newId < WHEEL_COUNT) {
                g_wheelId = static_cast<uint8_t>(newId);
                WebTelemetryBridge::saveWheelId(g_wheelId);
                Serial.printf("[TechBIT Wheel] Active wheel ID set to %s (%u)\n",
                              wheelName(g_wheelId), g_wheelId);
            }
        } else if (std::strcmp(cmd, "status") == 0 || std::strcmp(cmd, "help") == 0) {
            Serial.printf("\n[TechBIT Wheel %s] MCU=ESP32-C3 ADC=GPIO%d Vref=%.1fmV CAN(TX=%d,RX=%d) ok=%s tx=%lu rx=%lu err=%lu\n",
                          wheelName(g_wheelId),
                          PIN_PIEZO_ADC,
                          g_lastDcOffsetMv,
                          PIN_CAN_TX,
                          PIN_CAN_RX,
                          g_can.isReady() ? "YES" : "NO",
                          static_cast<unsigned long>(g_can.txCount()),
                          static_cast<unsigned long>(g_can.rxCount()),
                          static_cast<unsigned long>(g_can.txErrors()));
#if ENABLE_SHT40
            Serial.printf("[TechBIT Wheel %s] GY-SHT40(SDA=%d,SCL=%d,%s,0x%02X,%s,scan=0x%02X,lastErr=%u): valid=%s T=%.2fC RH=%.1f%% ok=%lu err=%lu\n",
                          wheelName(g_wheelId),
                          g_sht40.activeSdaPin(),
                          g_sht40.activeSclPin(),
                          g_sht40.pinsSwapped() ? "SWAPPED" : "NORMAL",
                          g_sht40.activeAddress(),
                          g_sht40.protocolName(),
                          g_sht40.scanFoundAddress(),
                          static_cast<unsigned>(g_sht40.lastError()),
                          g_sht40.isValid() ? "YES" : "NO",
                          g_sht40.tempC(),
                          g_sht40.humidityPct(),
                          static_cast<unsigned long>(g_sht40.okCount()),
                          static_cast<unsigned long>(g_sht40.errCount()));
#endif
            g_webBridge.printNetworkStatus();
            Serial.println("Commands: json | human | rate <ms> | wheel <0..3> | wifi <ssid> <pass> <url> | wifi_ap | wifi_off | status\n");
        }
    }
}

} // namespace

void setup() {
#if !ENABLE_SHT40
    pinMode(PIN_STATUS_LED, OUTPUT);
    setStatusLed(false);
#endif

    Serial.begin(115200);
    delay(400);

    g_wheelId = resolveWheelId();

    Serial.printf("\n[TechBIT Wheel Node] Booting ESP32-C3 SuperMini corner=%s (ID=%u)\n",
                  wheelName(g_wheelId), g_wheelId);

    int ntcPin = -1;
#ifdef ENABLE_NTC_TEMP
    ntcPin = PIN_NTC_ADC;
#endif

    if (!g_adc.begin(PIN_PIEZO_ADC, kSampleRateHz, ntcPin)) {
        Serial.println("[TechBIT Wheel] ERROR: Failed to start 20 kSPS DMA ADC!");
    } else {
        Serial.printf("[TechBIT Wheel] DMA ADC active on GPIO%d @ %lu Hz (%.4f mV/count)\n",
                      PIN_PIEZO_ADC,
                      static_cast<unsigned long>(kSampleRateHz),
                      g_adc.mvPerCount());
    }

    g_dsp.begin(static_cast<float>(kSampleRateHz), g_adc.mvPerCount());

#if ENABLE_SHT40
    if (g_sht40.begin(PIN_I2C_SDA, PIN_I2C_SCL, SHT40_I2C_ADDR, 500)) {
        Serial.printf("[TechBIT Wheel] GY-SHT40 detected on SDA=GPIO%d SCL=GPIO%d (%s, 0x%02X)\n",
                      g_sht40.activeSdaPin(),
                      g_sht40.activeSclPin(),
                      g_sht40.pinsSwapped() ? "AUTO-SWAPPED" : "NORMAL",
                      g_sht40.activeAddress());
    } else {
        Serial.printf("[TechBIT Wheel] WARN: GY-SHT40 not ACKed on GPIO8/9 (0x44/0x45, scan=0x%02X) — auto-probing normal+swapped pins\n",
                      g_sht40.scanFoundAddress());
    }
#endif

    if (!g_can.begin(PIN_CAN_TX, PIN_CAN_RX)) {
        Serial.println("[TechBIT Wheel] ERROR: Failed to initialize TWAI CAN @ 500 kbps!");
    } else {
        Serial.printf("[TechBIT Wheel] CAN TWAI active @ 500 kbps (TX=GPIO%d, RX=GPIO%d)\n",
                      PIN_CAN_TX, PIN_CAN_RX);
    }

    g_webBridge.begin(TECHBIT_SERIAL_DEFAULT_JSON ? SERIAL_MODE_JSON : SERIAL_MODE_HUMAN);
    g_webBridge.printNetworkStatus();

    resetWindowAccumulator();
}

void loop() {
    const uint32_t nowMs = millis();

#if ENABLE_SHT40
    g_sht40.update(nowMs);
#endif

    // 1. Read 512 samples @ 20 kSPS via hardware DMA (~25.6 ms)
    if (!g_adc.readFrame(g_rawSamples, dsp::kDspFftSize, 80)) {
        g_can.serviceRecovery();
        pollCanCommands();
        processBridgeCommands();
        return;
    }

    // 2. Compute Time-Domain & Fourier Series (512-pt FFT) features
    const dsp::VibrationFeatures feat = g_dsp.processRawFrame(
        g_rawSamples, kAdcSurgeLowThresh, kAdcSurgeHighThresh);

    g_lastDcOffsetMv  = feat.dcOffsetMv;
    g_lastZeroCrossHz = feat.zeroCrossingsHz;

    // 3. Accumulate across 2 frames (~51.2 ms CAN reporting cadence)
    g_accRmsSq      += feat.rmsMv * feat.rmsMv;
    g_accPeakMv      = (feat.peakMv > g_accPeakMv) ? feat.peakMv : g_accPeakMv;
    g_accKurtosis    = (feat.kurtosis > g_accKurtosis) ? feat.kurtosis : g_accKurtosis;
    g_accBandLow    += feat.bandLowRatio;
    g_accBandMid    += feat.bandMidRatio;
    g_accBandHigh   += feat.bandHighRatio;
    g_accCentroidHz += feat.spectralCentroidHz;
    g_accTonality   += feat.tonalityRatio;
    g_accSurgeClip   = g_accSurgeClip || feat.surgeClipping;

    if (feat.rmsMv > g_bestFrameRms) {
        g_bestFrameRms     = feat.rmsMv;
        g_bestDominantFreq = feat.dominantFreqHz;
        downsampleSpectrum32(g_dsp.spectrumMagnitudesMv(),
                             dsp::kDspHalfSize,
                             static_cast<float>(kSampleRateHz),
                             g_bestSpectrum32);
    }

    ++g_frameCounter;

    // 4. Publish compact CAN frames & update Web Telemetry snapshot
    if (g_frameCounter >= kFramesPerCanReport) {
        const float invN = 1.0f / static_cast<float>(g_frameCounter);

        can::WheelTelemetryPacket pkt{};
        pkt.wheelId            = g_wheelId;
        pkt.rmsMv              = std::sqrt(g_accRmsSq * invN);
        pkt.peakMv             = g_accPeakMv;
        pkt.bandLowRatio       = g_accBandLow * invN;
        pkt.bandMidRatio       = g_accBandMid * invN;
        pkt.bandHighRatio      = g_accBandHigh * invN;
        pkt.dominantFreqHz     = static_cast<uint16_t>(g_bestDominantFreq + 0.5f);
        pkt.spectralCentroidHz = static_cast<uint16_t>((g_accCentroidHz * invN) + 0.5f);
        pkt.tonalityRatio      = g_accTonality * invN;
        pkt.kurtosis           = g_accKurtosis;

        uint8_t flags = can::FLAG_ADC_OK;
        if (g_accSurgeClip) {
            flags |= can::FLAG_SURGE_CLIPPING;
        }
        if (pkt.rmsMv > 150.0f) {
            flags |= can::FLAG_HIGH_ENERGY;
        }

        float tempC       = 0.0f;
        float humidityPct = 0.0f;
        bool  sht40Ok     = false;

#if ENABLE_SHT40
        if (g_sht40.isValid()) {
            tempC       = g_sht40.tempC();
            humidityPct = g_sht40.humidityPct();
            sht40Ok     = true;
            pkt.tempC   = tempC;
            flags      |= can::FLAG_TEMP_VALID;
        }
#endif
#ifdef ENABLE_NTC_TEMP
        if (!sht40Ok && g_adc.hasNtc()) {
            pkt.tempC = computeNtcTempC(g_adc.latestNtcRaw());
            tempC     = pkt.tempC;
            flags    |= can::FLAG_TEMP_VALID;
        }
#endif
        pkt.statusFlags = flags;

        uint8_t coreBuf[8];
        uint8_t specBuf[8];
        can::packCoreFrame(pkt, coreBuf);
        can::packSpectralFrame(pkt, specBuf);

        g_can.sendFrame(can::kCanIdCoreBase + g_wheelId, coreBuf, 8);
        g_can.sendFrame(can::kCanIdSpectralBase + g_wheelId, specBuf, 8);

        NodeWebSnapshot snap{};
        snap.wheelId            = g_wheelId;
        snap.tsMs               = nowMs;
        snap.rmsMv              = pkt.rmsMv;
        snap.peakMv             = pkt.peakMv;
        snap.dcOffsetMv         = g_lastDcOffsetMv;
        snap.crestFactor        = (pkt.rmsMv > 0.5f) ? (pkt.peakMv / pkt.rmsMv) : 1.0f;
        snap.kurtosis           = pkt.kurtosis;
        snap.bandLowRatio       = pkt.bandLowRatio;
        snap.bandMidRatio       = pkt.bandMidRatio;
        snap.bandHighRatio      = pkt.bandHighRatio;
        snap.dominantFreqHz     = pkt.dominantFreqHz;
        snap.spectralCentroidHz = pkt.spectralCentroidHz;
        snap.tonalityRatio      = pkt.tonalityRatio;
        snap.zeroCrossingsHz    = g_lastZeroCrossHz;
        snap.surgeClipping      = g_accSurgeClip;
        snap.tempC              = tempC;
        snap.humidityPct        = humidityPct;
        snap.sht40Ok            = sht40Ok;
        snap.canReady           = g_can.isReady();
        snap.canTx              = g_can.txCount();
        snap.canRx              = g_can.rxCount();
        snap.canErr             = g_can.txErrors();
        snap.canBusOff          = g_can.busOffRecoveries();
        snap.adcDropped         = g_adc.droppedBytes();
        std::memcpy(snap.spectrumBins, g_bestSpectrum32, sizeof(snap.spectrumBins));

        g_webBridge.publishNodeSnapshot(snap, nowMs);

        // Periodic human-readable serial telemetry (only when serialMode == SERIAL_MODE_HUMAN)
        if (g_webBridge.serialMode() == SERIAL_MODE_HUMAN && (nowMs - g_lastPrintMs >= 250U)) {
            g_lastPrintMs = nowMs;
            Serial.printf(
                "Wheel:%s RMS:%.1fmV Peak:%.1fmV fDom:%uHz fCent:%uHz Band[L:%.2f M:%.2f H:%.2f] Ton:%.2f Kurt:%.2f Vref:%.0fmV T:%.1fC RH:%.0f%% CAN_TX:%lu\n",
                wheelName(g_wheelId),
                pkt.rmsMv,
                pkt.peakMv,
                pkt.dominantFreqHz,
                pkt.spectralCentroidHz,
                pkt.bandLowRatio,
                pkt.bandMidRatio,
                pkt.bandHighRatio,
                pkt.tonalityRatio,
                pkt.kurtosis,
                g_lastDcOffsetMv,
                tempC,
                humidityPct,
                static_cast<unsigned long>(g_can.txCount()));
        }

        resetWindowAccumulator();
    }

    // 5. Service CAN commands, Web/Serial commands, bus-off recovery & heartbeat LED
    pollCanCommands();
    processBridgeCommands();
    g_can.serviceRecovery();

    if (g_hubCalibAck && nowMs > g_calibAckUntilMs) {
        g_hubCalibAck = false;
    }

    const uint32_t blinkPeriodMs = g_hubCalibAck ? 100U : 500U;
    if (nowMs - g_lastBlinkMs >= blinkPeriodMs) {
        g_lastBlinkMs = nowMs;
        setStatusLed(!g_ledState);
    }
}
