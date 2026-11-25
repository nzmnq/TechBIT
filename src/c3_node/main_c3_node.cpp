#include <Arduino.h>
#include <Preferences.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include "esp_system.h"

#include "CanBusManager.h"
#include "MultiAdcDmaSampler.h"
#include "Sht40Sensor.h"
#include "VibrationDSP.h"
#include "board_pins.h"
#include "can_protocol_v2.h"
#include "techbit_config.h"

#ifndef ENABLE_SHT40
#define ENABLE_SHT40 1
#endif

using namespace techbit;

namespace {

MultiAdcDmaSampler  g_adc;
dsp::VibrationDSP   g_dsp;
CanBusManager       g_can;
Sht40Sensor         g_sht40;
Preferences         g_prefs;

uint32_t g_nodeId24     = 0;
char     g_nodeName[12] = "C3_000000";
uint8_t  g_savedSlot    = 0; // 0 = unassigned, 1..5 = T1/T2/P1..P3
bool     g_serialJson   = true;
uint32_t g_serialPeriodMs = 200;

uint16_t g_rawLeft[kDspFftSize];
uint16_t g_rawRight[kDspFftSize];

struct C3BurstEntry {
    uint16_t vibLeftX100;
    uint16_t tempLeftX10;
};
C3BurstEntry g_burstRing[kC3BurstRingFrames];
uint8_t      g_burstHead  = 0;
uint8_t      g_burstCount = 0;

uint8_t  g_txSeq        = 0;
uint32_t g_lastReportMs = 0;
uint32_t g_lastJsonMs   = 0;
uint32_t g_lastHbMs     = 0;
uint32_t g_identUntilMs = 0;
uint32_t g_lastBlinkMs  = 0;
bool     g_ledOn        = false;
char     g_cmdBuf[128];
size_t   g_cmdLen       = 0;

// Window accumulators
float    g_rmsSqL    = 0.0f;
float    g_rmsSqR    = 0.0f;
float    g_rmsMvSqL  = 0.0f;
float    g_rmsMvSqR  = 0.0f;
float    g_peakL     = 0.0f;
float    g_peakR     = 0.0f;
float    g_crestL    = 1.0f;
float    g_crestR    = 1.0f;
float    g_kurtSumL  = 0.0f;
float    g_kurtSumR  = 0.0f;
float    g_hfSumL    = 0.0f;
float    g_hfSumR    = 0.0f;
float    g_lowSumL   = 0.0f;
float    g_lowSumR   = 0.0f;
float    g_tonalSumL = 0.0f;
float    g_tonalSumR = 0.0f;
float    g_dcOffsetL = 1650.0f;
float    g_dcOffsetR = 1650.0f;
uint16_t g_domHzL    = 0;
uint16_t g_domHzR    = 0;
uint16_t g_winCount  = 0;
bool     g_clipL     = false;
bool     g_clipR     = false;
float    g_spec32L[32] = {};
float    g_spec32R[32] = {};

void setLed(bool on) {
#if !ENABLE_SHT40
    // On ESP32-C3 SuperMini, GPIO8 is wired to BOTH the blue LED and I2C SDA.
    g_ledOn = on;
    digitalWrite(PIN_STATUS_LED, STATUS_LED_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW));
#else
    (void)on;
#endif
}

void downsampleSpectrum32(const float* mag, uint16_t halfSize, float sampleRateHz, float outBins[32]) {
    const float binWidth = sampleRateHz / static_cast<float>(halfSize * 2U);
    constexpr float kBucketWidthHz = 140.0f; // 32 * 140 = 4480 Hz (~Nyquist of 10 kSPS)
    for (uint8_t b = 0; b < 32; ++b) {
        uint16_t kStart = static_cast<uint16_t>(std::ceil((b * kBucketWidthHz) / binWidth));
        uint16_t kEnd   = static_cast<uint16_t>(std::floor(((b + 1U) * kBucketWidthHz) / binWidth));
        if (kStart < 1U) kStart = 1U;
        if (kEnd >= halfSize) kEnd = static_cast<uint16_t>(halfSize - 1U);
        float peak = 0.0f;
        for (uint16_t k = kStart; k <= kEnd; ++k) {
            if (mag[k] > peak) peak = mag[k];
        }
        outBins[b] = peak;
    }
}

uint32_t deriveMacNodeId24() {
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    return (static_cast<uint32_t>(mac[3]) << 16) |
           (static_cast<uint32_t>(mac[4]) << 8) |
           static_cast<uint32_t>(mac[5]);
}

float ntcRawToCelsius(uint16_t rawAdc, bool& sensorOk) {
    if (rawAdc < 35 || rawAdc > 4060) {
        sensorOk = false;
        return 25.0f;
    }
    sensorOk = true;
    constexpr float kSeriesR = 10000.0f;
    constexpr float kNomR    = 10000.0f;
    constexpr float kBeta    = 3950.0f;
    constexpr float kT0      = 298.15f;
    float ratio = static_cast<float>(rawAdc) / (static_cast<float>(kAdcMaxCounts) - static_cast<float>(rawAdc));
    float rNtc  = kSeriesR * ratio;
    float invT  = (1.0f / kT0) + (1.0f / kBeta) * std::log(rNtc / kNomR);
    return (1.0f / invT) - 273.15f;
}

void sendBurstChunksOverCan() {
    if (g_burstCount == 0) return;
    const uint16_t total = g_burstCount;
    const uint16_t start = (g_burstCount == kC3BurstRingFrames) ? g_burstHead : 0;

    for (uint16_t i = 0; i < total; ++i) {
        const uint8_t idx = static_cast<uint8_t>((start + i) % kC3BurstRingFrames);
        can2::RawBurstChunk chunk{};
        chunk.nodeId            = g_nodeId24;
        chunk.chunkIndex        = i;
        chunk.totalChunks       = total;
        chunk.sampleVibLeftX100 = g_burstRing[idx].vibLeftX100;
        chunk.sampleTempLeftX10 = g_burstRing[idx].tempLeftX10;

        uint8_t buf[8];
        can2::packBurstChunkFrame(chunk, buf);
        g_can.sendExtendedFrame(can2::makeExtId(can2::MSG_RAW_BURST_CHUNK, g_nodeId24), buf, 8);
        delay(2);
    }
}

void pollCanCommands() {
    CanFrame rx{};
    while (g_can.receiveFrame(rx)) {
        if (!rx.extended) continue;
        if (can2::extractMsgType(rx.id) == can2::MSG_MASTER_CMD && rx.dlc >= 4) {
            const uint8_t  cmdCode  = rx.data[0];
            const uint32_t targetId = static_cast<uint32_t>(rx.data[1]) |
                                      (static_cast<uint32_t>(rx.data[2]) << 8) |
                                      (static_cast<uint32_t>(rx.data[3]) << 16);
            if (targetId != g_nodeId24 && targetId != 0xFFFFFFU) continue;

            if (cmdCode == can2::CMD_REQUEST_RAW_BURST) {
                sendBurstChunksOverCan();
            } else if (cmdCode == can2::CMD_IDENTIFY_LED) {
                g_identUntilMs = millis() + 4000U;
            }
        }
    }
}

void handleSerialCmd(const char* line) {
    if (std::strcmp(line, "json") == 0) {
        g_serialJson = true;
    } else if (std::strcmp(line, "human") == 0) {
        g_serialJson = false;
    } else if (std::strncmp(line, "slot ", 5) == 0) {
        int s = std::atoi(line + 5);
        if (s >= 0 && s <= 5) {
            g_savedSlot = static_cast<uint8_t>(s);
            g_prefs.begin("tb_node", false);
            g_prefs.putUChar("slot", g_savedSlot);
            g_prefs.end();
        }
    } else if (std::strncmp(line, "rate ", 5) == 0) {
        uint32_t r = static_cast<uint32_t>(std::strtoul(line + 5, nullptr, 10));
        if (r >= 60U && r <= 2000U) g_serialPeriodMs = r;
    } else if (std::strcmp(line, "status") == 0) {
        Serial.printf("{\"type\":\"techbit_status\",\"nodeId\":\"%s\",\"slot\":%u,\"sht40Ok\":%s,\"sda\":%d,\"scl\":%d,\"addr\":\"0x%02X\",\"err\":%u}\n",
                      g_nodeName,
                      static_cast<unsigned>(g_savedSlot),
                      g_sht40.isValid() ? "true" : "false",
                      g_sht40.activeSdaPin(),
                      g_sht40.activeSclPin(),
                      static_cast<unsigned>(g_sht40.activeAddress()),
                      static_cast<unsigned>(g_sht40.lastError()));
    }
}

void pollSerialCli() {
    while (Serial.available() > 0) {
        char c = static_cast<char>(Serial.read());
        if (c == '\r' || c == '\n') {
            if (g_cmdLen > 0) {
                g_cmdBuf[g_cmdLen] = '\0';
                handleSerialCmd(g_cmdBuf);
                g_cmdLen = 0;
            }
        } else if (g_cmdLen + 1 < sizeof(g_cmdBuf)) {
            g_cmdBuf[g_cmdLen++] = c;
        }
    }
}

void publishWebSerialJson(const can2::AxleTelemetry& pkt,
                          float rmsMvL, float rmsMvR,
                          float rhPct, bool shtOk,
                          uint32_t nowMs) {
    static char jsonBuf[1650];
    size_t pos = static_cast<size_t>(std::snprintf(
        jsonBuf, sizeof(jsonBuf),
        "{\"type\":\"techbit_c3_node\",\"mcu\":\"ESP32-C3\",\"nodeId\":\"%s\",\"slot\":%u,\"tsMs\":%lu,"
        "\"left\":{\"rmsMv\":%.2f,\"rmsMmS\":%.2f,\"peakMmS\":%.2f,\"crest\":%.2f,"
        "\"kurtosis\":%.2f,\"hfEnergy\":%.3f,\"bandLow\":%.3f,\"tonality\":%.2f,\"dcOffsetMv\":%.1f,"
        "\"fDomHz\":%u,\"clip\":%s,\"tempC\":%.2f,\"rh\":%.1f,\"shtOk\":%s,\"spectrum\":[",
        g_nodeName,
        static_cast<unsigned>(g_savedSlot),
        static_cast<unsigned long>(nowMs),
        rmsMvL, pkt.vibRmsLeft, pkt.vibPeakLeft, pkt.crestLeft,
        pkt.kurtosisLeft, pkt.hfEnergyLeft, pkt.bandLowLeft, pkt.tonalityLeft, g_dcOffsetL,
        static_cast<unsigned>(pkt.domFreqLeftHz),
        (pkt.statusFlags & can2::FLAG_LEFT_CLIP) ? "true" : "false",
        pkt.tempLeftC, rhPct, shtOk ? "true" : "false"));

    for (uint8_t b = 0; b < 32 && pos + 16 < sizeof(jsonBuf); ++b) {
        pos += static_cast<size_t>(std::snprintf(jsonBuf + pos, sizeof(jsonBuf) - pos,
                                                 "%s%.1f", (b > 0 ? "," : ""), g_spec32L[b]));
    }

    pos += static_cast<size_t>(std::snprintf(
        jsonBuf + pos, (pos < sizeof(jsonBuf) ? sizeof(jsonBuf) - pos : 0),
        "]},\"right\":{\"rmsMv\":%.2f,\"rmsMmS\":%.2f,\"peakMmS\":%.2f,\"crest\":%.2f,"
        "\"kurtosis\":%.2f,\"hfEnergy\":%.3f,\"bandLow\":%.3f,\"tonality\":%.2f,\"dcOffsetMv\":%.1f,"
        "\"fDomHz\":%u,\"clip\":%s,\"tempC\":%.2f,\"rh\":%.1f,\"shtOk\":%s},"
        "\"i2c\":{\"sda\":%d,\"scl\":%d,\"addr\":\"0x%02X\",\"err\":%u},"
        "\"can\":{\"ready\":%s,\"tx\":%lu,\"err\":%lu}}",
        rmsMvR, pkt.vibRmsRight, pkt.vibPeakRight, pkt.crestRight,
        pkt.kurtosisRight, pkt.hfEnergyRight, pkt.bandLowRight, pkt.tonalityRight, g_dcOffsetR,
        static_cast<unsigned>(pkt.domFreqRightHz),
        (pkt.statusFlags & can2::FLAG_RIGHT_CLIP) ? "true" : "false",
        pkt.tempRightC, rhPct, shtOk ? "true" : "false",
        g_sht40.activeSdaPin(), g_sht40.activeSclPin(),
        static_cast<unsigned>(g_sht40.activeAddress()),
        static_cast<unsigned>(g_sht40.lastError()),
        g_can.isReady() ? "true" : "false",
        static_cast<unsigned long>(g_can.txCount()),
        static_cast<unsigned long>(g_can.txErrors())));

    Serial.println(jsonBuf);
}

} // namespace

void setup() {
#if !ENABLE_SHT40
    pinMode(PIN_STATUS_LED, OUTPUT);
    setLed(false);
#endif

    Serial.begin(115200);
    delay(300);

    g_prefs.begin("tb_node", false);
    g_savedSlot = g_prefs.getUChar("slot", 0);
    g_prefs.end();

    g_nodeId24 = deriveMacNodeId24();
    can2::formatNodeIdString(g_nodeId24, g_nodeName);
    Serial.printf("\n[TechBIT C3 Node] Unified Axle Node booting: %s (slot=%u)\n",
                  g_nodeName, static_cast<unsigned>(g_savedSlot));

#if ENABLE_SHT40
    g_sht40.begin(PIN_I2C_SDA, PIN_I2C_SCL, SHT40_I2C_ADDR, 400);
#endif

    if (!g_adc.begin(kAdcPerChannelVibHz)) {
        Serial.println("[C3 Node] ERROR: Failed to initialize 4-ch DMA ADC1!");
    }
    g_dsp.begin(static_cast<float>(kAdcPerChannelVibHz), g_adc.mvPerCount());

    if (!g_can.begin(PIN_CAN_TX, PIN_CAN_RX)) {
        Serial.println("[C3 Node] ERROR: Failed to initialize TWAI CAN @ 500 kbps!");
    }

    g_lastReportMs = millis();
    g_lastJsonMs   = millis();
    g_lastHbMs     = millis();
}

void loop() {
    const uint32_t nowMs = millis();

#if ENABLE_SHT40
    g_sht40.update(nowMs);
#endif

    if (g_adc.readAxleFrame(g_rawLeft, g_rawRight, kDspFftSize, 80)) {
        const dsp::VibrationFeatures featL = g_dsp.processRawFrame(g_rawLeft);
        downsampleSpectrum32(g_dsp.spectrumMagnitudesMv(), dsp::kDspHalfSize,
                             static_cast<float>(kAdcPerChannelVibHz), g_spec32L);

        const dsp::VibrationFeatures featR = g_dsp.processRawFrame(g_rawRight);
        downsampleSpectrum32(g_dsp.spectrumMagnitudesMv(), dsp::kDspHalfSize,
                             static_cast<float>(kAdcPerChannelVibHz), g_spec32R);

        constexpr float kMvToMmPerSec = 0.045f;
        const float vL = featL.rmsMv * kMvToMmPerSec;
        const float vR = featR.rmsMv * kMvToMmPerSec;
        const float pL = featL.peakMv * kMvToMmPerSec;
        const float pR = featR.peakMv * kMvToMmPerSec;

        g_rmsSqL    += vL * vL;
        g_rmsSqR    += vR * vR;
        g_rmsMvSqL  += featL.rmsMv * featL.rmsMv;
        g_rmsMvSqR  += featR.rmsMv * featR.rmsMv;
        g_dcOffsetL  = featL.dcOffsetMv;
        g_dcOffsetR  = featR.dcOffsetMv;
        if (pL > g_peakL) g_peakL = pL;
        if (pR > g_peakR) g_peakR = pR;
        if (featL.crestFactor > g_crestL) g_crestL = featL.crestFactor;
        if (featR.crestFactor > g_crestR) g_crestR = featR.crestFactor;
        g_kurtSumL  += featL.kurtosis;
        g_kurtSumR  += featR.kurtosis;
        g_hfSumL    += (featL.bandMidRatio + featL.bandHighRatio);
        g_hfSumR    += (featR.bandMidRatio + featR.bandHighRatio);
        g_lowSumL   += featL.bandLowRatio;
        g_lowSumR   += featR.bandLowRatio;
        g_tonalSumL += featL.tonalityRatio;
        g_tonalSumR += featR.tonalityRatio;
        g_domHzL = static_cast<uint16_t>(featL.dominantFreqHz + 0.5f);
        g_domHzR = static_cast<uint16_t>(featR.dominantFreqHz + 0.5f);
        g_clipL  = g_clipL || featL.surgeClipping;
        g_clipR  = g_clipR || featR.surgeClipping;
        ++g_winCount;
    }

    const bool canDue  = (nowMs - g_lastReportMs >= kNodeTelemetryPeriodMs);
    const bool jsonDue = (g_serialJson && (nowMs - g_lastJsonMs >= g_serialPeriodMs));

    if ((canDue || jsonDue) && g_winCount > 0) {
        const float invN   = 1.0f / static_cast<float>(g_winCount);
        const float rmsMvL = std::sqrt(g_rmsMvSqL * invN);
        const float rmsMvR = std::sqrt(g_rmsMvSqR * invN);

        bool tempOkL = false;
        bool tempOkR = false;
        float tL = ntcRawToCelsius(g_adc.tempLeftRaw(), tempOkL);
        float tR = ntcRawToCelsius(g_adc.tempRightRaw(), tempOkR);
        float rhPct = 0.0f;
        bool shtOk  = false;

#if ENABLE_SHT40
        if (g_sht40.isValid()) {
            shtOk = true;
            rhPct = g_sht40.humidityPct();
            tL    = g_sht40.tempC();
            tempOkL = true;
            if (!tempOkR) {
                // Single PCB bench mode: mirror SHT40 if 2nd analog NTC is absent
                tR      = tL;
                tempOkR = true;
            }
        }
#endif

        can2::AxleTelemetry pkt{};
        pkt.nodeId         = g_nodeId24;
        pkt.tempLeftC      = tL;
        pkt.tempRightC     = tR;
        pkt.vibRmsLeft     = std::sqrt(g_rmsSqL * invN);
        pkt.vibRmsRight    = std::sqrt(g_rmsSqR * invN);
        pkt.vibPeakLeft    = g_peakL;
        pkt.vibPeakRight   = g_peakR;
        pkt.crestLeft      = g_crestL;
        pkt.crestRight     = g_crestR;
        pkt.domFreqLeftHz  = g_domHzL;
        pkt.domFreqRightHz = g_domHzR;
        pkt.kurtosisLeft   = g_kurtSumL * invN;
        pkt.kurtosisRight  = g_kurtSumR * invN;
        pkt.hfEnergyLeft   = g_hfSumL * invN;
        pkt.hfEnergyRight  = g_hfSumR * invN;
        pkt.bandLowLeft    = g_lowSumL * invN;
        pkt.bandLowRight   = g_lowSumR * invN;
        pkt.tonalityLeft   = g_tonalSumL * invN;
        pkt.tonalityRight  = g_tonalSumR * invN;
        pkt.seq            = g_txSeq;

        uint8_t flags = 0;
        if (tempOkL) flags |= can2::FLAG_LEFT_OK; else flags |= can2::FLAG_LEFT_OPEN;
        if (tempOkR) flags |= can2::FLAG_RIGHT_OK; else flags |= can2::FLAG_RIGHT_OPEN;
        if (g_clipL) flags |= can2::FLAG_LEFT_CLIP;
        if (g_clipR) flags |= can2::FLAG_RIGHT_CLIP;
        pkt.statusFlags = flags;

        if (jsonDue) {
            g_lastJsonMs = nowMs;
            publishWebSerialJson(pkt, rmsMvL, rmsMvR, rhPct, shtOk, nowMs);
        }

        if (canDue) {
            g_lastReportMs = nowMs;
            pkt.seq = ++g_txSeq;

            g_burstRing[g_burstHead].vibLeftX100 = can2::clampU16(pkt.vibRmsLeft * 100.0f);
            g_burstRing[g_burstHead].tempLeftX10 = static_cast<uint16_t>(can2::clampI16(pkt.tempLeftC * 10.0f));
            g_burstHead = static_cast<uint8_t>((g_burstHead + 1U) % kC3BurstRingFrames);
            if (g_burstCount < kC3BurstRingFrames) ++g_burstCount;

            uint8_t fVib[8], fTemp[8], fMl[8];
            can2::packAxleVibFrame(pkt, fVib);
            can2::packAxleTempFrame(pkt, fTemp);
            can2::packAxleMlFeaturesFrame(pkt, fMl);
            g_can.sendExtendedFrame(can2::makeExtId(can2::MSG_AXLE_VIB, g_nodeId24), fVib, 8);
            g_can.sendExtendedFrame(can2::makeExtId(can2::MSG_AXLE_ML_FEATURES, g_nodeId24), fMl, 8);
            g_can.sendExtendedFrame(can2::makeExtId(can2::MSG_AXLE_TEMP_META, g_nodeId24), fTemp, 8);

            g_rmsSqL = g_rmsSqR = g_rmsMvSqL = g_rmsMvSqR = 0.0f;
            g_peakL  = g_peakR  = 0.0f;
            g_crestL = g_crestR = 1.0f;
            g_kurtSumL = g_kurtSumR = 0.0f;
            g_hfSumL   = g_hfSumR   = 0.0f;
            g_lowSumL  = g_lowSumR  = 0.0f;
            g_tonalSumL = g_tonalSumR = 0.0f;
            g_clipL  = g_clipR  = false;
            g_winCount = 0;
        }
    }

    if (nowMs - g_lastHbMs >= kNodeHeartbeatPeriodMs) {
        g_lastHbMs = nowMs;
        can2::NodeHeartbeat hb{};
        hb.nodeId      = g_nodeId24;
        hb.fwMajor     = 2;
        hb.fwMinor     = 0;
        hb.fwPatch     = 0;
        hb.uptimeSec   = nowMs / 1000U;
        hb.healthFlags = can2::FLAG_LEFT_OK | can2::FLAG_RIGHT_OK;

        uint8_t fHb[8];
        can2::packHeartbeatFrame(hb, fHb);
        g_can.sendExtendedFrame(can2::makeExtId(can2::MSG_HEARTBEAT, g_nodeId24), fHb, 8);
    }

    pollCanCommands();
    pollSerialCli();
    g_can.serviceRecovery();

    const uint32_t blinkPeriod = (nowMs < g_identUntilMs) ? 100U : 600U;
    if (nowMs - g_lastBlinkMs >= blinkPeriod) {
        g_lastBlinkMs = nowMs;
        setLed(!g_ledOn);
    }
}
