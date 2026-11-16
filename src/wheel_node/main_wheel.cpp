#include <Arduino.h>
#include <cmath>
#include <cstring>

#include "AdcDmaSampler.h"
#include "CanBusManager.h"
#include "VibrationDSP.h"
#include "board_pins.h"
#include "can_protocol.h"
#include "techbit_config.h"

#ifndef WHEEL_NODE_ID
#define WHEEL_NODE_ID 0
#endif

using namespace techbit;

namespace {

AdcDmaSampler       g_adc;
dsp::VibrationDSP   g_dsp;
CanBusManager       g_can;

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

uint32_t            g_lastPrintMs      = 0;
uint32_t            g_lastBlinkMs      = 0;
bool                g_ledState         = false;
bool                g_hubCalibAck      = false;
uint32_t            g_calibAckUntilMs  = 0;

void setStatusLed(bool on) {
    g_ledState = on;
    if (STATUS_LED_ACTIVE_LOW) {
        digitalWrite(PIN_STATUS_LED, on ? LOW : HIGH);
    } else {
        digitalWrite(PIN_STATUS_LED, on ? HIGH : LOW);
    }
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

} // namespace

void setup() {
    pinMode(PIN_STATUS_LED, OUTPUT);
    setStatusLed(false);

    Serial.begin(115200);
    delay(400);

    g_wheelId = resolveWheelId();

    Serial.printf("\n[TechBIT Wheel Node] Booting corner=%s (ID=%u)\n",
                  wheelName(g_wheelId), g_wheelId);

    int ntcPin = -1;
#ifdef ENABLE_NTC_TEMP
    ntcPin = PIN_NTC_ADC;
#endif

    if (!g_adc.begin(PIN_PIEZO_ADC, kSampleRateHz, ntcPin)) {
        Serial.println("[TechBIT Wheel] ERROR: Failed to start 20 kSPS DMA ADC!");
    } else {
        Serial.printf("[TechBIT Wheel] DMA ADC active @ %lu Hz (%.4f mV/count)\n",
                      static_cast<unsigned long>(kSampleRateHz), g_adc.mvPerCount());
    }

    g_dsp.begin(static_cast<float>(kSampleRateHz), g_adc.mvPerCount());

    if (!g_can.begin(PIN_CAN_TX, PIN_CAN_RX)) {
        Serial.println("[TechBIT Wheel] ERROR: Failed to initialize TWAI CAN @ 500 kbps!");
    } else {
        Serial.printf("[TechBIT Wheel] CAN TWAI active @ 500 kbps (TX=%d, RX=%d)\n",
                      PIN_CAN_TX, PIN_CAN_RX);
    }

    resetWindowAccumulator();
}

void loop() {
    const uint32_t nowMs = millis();

    // 1. Read 512 samples @ 20 kSPS via hardware DMA (~25.6 ms)
    if (!g_adc.readFrame(g_rawSamples, dsp::kDspFftSize, 80)) {
        g_can.serviceRecovery();
        pollCanCommands();
        return;
    }

    // 2. Compute Time-Domain & Fourier Series (512-pt FFT) features
    const dsp::VibrationFeatures feat = g_dsp.processRawFrame(
        g_rawSamples, kAdcSurgeLowThresh, kAdcSurgeHighThresh);

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
    }

    ++g_frameCounter;

    // 4. Publish compact CAN frames when aggregation window completes
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

#ifdef ENABLE_NTC_TEMP
        if (g_adc.hasNtc()) {
            pkt.tempC = computeNtcTempC(g_adc.latestNtcRaw());
            flags |= can::FLAG_TEMP_VALID;
        }
#endif
        pkt.statusFlags = flags;

        uint8_t coreBuf[8];
        uint8_t specBuf[8];
        can::packCoreFrame(pkt, coreBuf);
        can::packSpectralFrame(pkt, specBuf);

        g_can.sendFrame(can::kCanIdCoreBase + g_wheelId, coreBuf, 8);
        g_can.sendFrame(can::kCanIdSpectralBase + g_wheelId, specBuf, 8);

        // Periodic human/plotter serial telemetry (every 250 ms)
        if (nowMs - g_lastPrintMs >= 250U) {
            g_lastPrintMs = nowMs;
            Serial.printf(
                "Wheel:%s RMS:%.1fmV Peak:%.1fmV fDom:%uHz fCent:%uHz Band[L:%.2f M:%.2f H:%.2f] Ton:%.2f Kurt:%.2f Vref:%.0fmV CAN_TX:%lu\n",
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
                feat.dcOffsetMv,
                static_cast<unsigned long>(g_can.txCount()));
        }

        resetWindowAccumulator();
    }

    // 5. Service CAN commands, bus-off recovery & heartbeat LED
    pollCanCommands();
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
