#include <Arduino.h>
#include <cmath>
#include <cstring>
#include "esp_system.h"

#include "CanBusManager.h"
#include "MultiAdcDmaSampler.h"
#include "VibrationDSP.h"
#include "board_pins.h"
#include "can_protocol_v2.h"
#include "techbit_config.h"

using namespace techbit;

namespace {

MultiAdcDmaSampler  g_adc;
dsp::VibrationDSP   g_dsp;
CanBusManager       g_can;

uint32_t g_nodeId24 = 0;
char     g_nodeName[12] = "C3_000000";

uint16_t g_rawLeft[kDspFftSize];
uint16_t g_rawRight[kDspFftSize];

// Compact local circular burst buffer on C3 Node (serviced upon CMD_REQUEST_RAW_BURST)
struct C3BurstEntry {
    uint16_t vibLeftX100;
    uint16_t tempLeftX10;
};
C3BurstEntry g_burstRing[kC3BurstRingFrames];
uint8_t      g_burstHead  = 0;
uint8_t      g_burstCount = 0;

uint8_t  g_txSeq        = 0;
uint32_t g_lastReportMs = 0;
uint32_t g_lastHbMs     = 0;
uint32_t g_identUntilMs = 0;
uint32_t g_lastBlinkMs  = 0;
bool     g_ledOn        = false;

// Window accumulators
float    g_rmsSqL   = 0.0f;
float    g_rmsSqR   = 0.0f;
float    g_peakL    = 0.0f;
float    g_peakR    = 0.0f;
float    g_crestL   = 1.0f;
float    g_crestR   = 1.0f;
uint16_t g_domHzL   = 0;
uint16_t g_domHzR   = 0;
uint16_t g_winCount = 0;
bool     g_clipL    = false;
bool     g_clipR    = false;

void setLed(bool on) {
    g_ledOn = on;
    digitalWrite(PIN_STATUS_LED, STATUS_LED_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW));
}

uint32_t deriveMacNodeId24() {
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    return (static_cast<uint32_t>(mac[3]) << 16) |
           (static_cast<uint32_t>(mac[4]) << 8) |
           static_cast<uint32_t>(mac[5]);
}

float ntcRawToCelsius(uint16_t rawAdc, bool& sensorOk) {
    // Assumes 10k NTC divider (10k pullup to 3.3V, Beta 3950 K)
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
            const uint8_t  cmdCode = rx.data[0];
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

} // namespace

void setup() {
    pinMode(PIN_STATUS_LED, OUTPUT);
    setLed(false);

    Serial.begin(115200);
    delay(300);

    g_nodeId24 = deriveMacNodeId24();
    can2::formatNodeIdString(g_nodeId24, g_nodeName);
    Serial.printf("\n[TechBIT C3 Node] Unified Axle Node booting: %s\n", g_nodeName);

    if (!g_adc.begin(kAdcPerChannelVibHz)) {
        Serial.println("[C3 Node] ERROR: Failed to initialize 4-ch DMA ADC1!");
    }
    g_dsp.begin(static_cast<float>(kAdcPerChannelVibHz), g_adc.mvPerCount());

    if (!g_can.begin(PIN_CAN_TX, PIN_CAN_RX)) {
        Serial.println("[C3 Node] ERROR: Failed to initialize TWAI CAN @ 500 kbps!");
    } else {
        Serial.printf("[C3 Node] CAN TX=%d RX=%d OK\n", PIN_CAN_TX, PIN_CAN_RX);
    }

    g_lastReportMs = millis();
    g_lastHbMs     = millis();
}

void loop() {
    const uint32_t nowMs = millis();

    if (g_adc.readAxleFrame(g_rawLeft, g_rawRight, kDspFftSize, 80)) {
        const dsp::VibrationFeatures featL = g_dsp.processRawFrame(g_rawLeft);
        const dsp::VibrationFeatures featR = g_dsp.processRawFrame(g_rawRight);

        // Convert mV vibration energy to scaled mm/s engineering units (calibration factor 0.05 mm/s per mV)
        constexpr float kMvToMmPerSec = 0.045f;
        const float vL = featL.rmsMv * kMvToMmPerSec;
        const float vR = featR.rmsMv * kMvToMmPerSec;
        const float pL = featL.peakMv * kMvToMmPerSec;
        const float pR = featR.peakMv * kMvToMmPerSec;

        g_rmsSqL += vL * vL;
        g_rmsSqR += vR * vR;
        if (pL > g_peakL) g_peakL = pL;
        if (pR > g_peakR) g_peakR = pR;
        if (featL.crestFactor > g_crestL) g_crestL = featL.crestFactor;
        if (featR.crestFactor > g_crestR) g_crestR = featR.crestFactor;
        g_domHzL = static_cast<uint16_t>(featL.dominantFreqHz + 0.5f);
        g_domHzR = static_cast<uint16_t>(featR.dominantFreqHz + 0.5f);
        g_clipL  = g_clipL || featL.surgeClipping;
        g_clipR  = g_clipR || featR.surgeClipping;
        ++g_winCount;
    }

    // 1. Periodic Telemetry Report (1 Hz over Extended 29-bit CAN)
    if (nowMs - g_lastReportMs >= kNodeTelemetryPeriodMs && g_winCount > 0) {
        g_lastReportMs = nowMs;

        bool tempOkL = false;
        bool tempOkR = false;
        const float tL = ntcRawToCelsius(g_adc.tempLeftRaw(), tempOkL);
        const float tR = ntcRawToCelsius(g_adc.tempRightRaw(), tempOkR);

        can2::AxleTelemetry pkt{};
        pkt.nodeId         = g_nodeId24;
        pkt.tempLeftC      = tL;
        pkt.tempRightC     = tR;
        pkt.vibRmsLeft     = std::sqrt(g_rmsSqL / static_cast<float>(g_winCount));
        pkt.vibRmsRight    = std::sqrt(g_rmsSqR / static_cast<float>(g_winCount));
        pkt.vibPeakLeft    = g_peakL;
        pkt.vibPeakRight   = g_peakR;
        pkt.crestLeft      = g_crestL;
        pkt.crestRight     = g_crestR;
        pkt.domFreqLeftHz  = g_domHzL;
        pkt.domFreqRightHz = g_domHzR;
        pkt.seq            = ++g_txSeq;

        uint8_t flags = 0;
        if (tempOkL) flags |= can2::FLAG_LEFT_OK; else flags |= can2::FLAG_LEFT_OPEN;
        if (tempOkR) flags |= can2::FLAG_RIGHT_OK; else flags |= can2::FLAG_RIGHT_OPEN;
        if (g_clipL) flags |= can2::FLAG_LEFT_CLIP;
        if (g_clipR) flags |= can2::FLAG_RIGHT_CLIP;
        pkt.statusFlags = flags;

        // Store into local burst ring buffer
        g_burstRing[g_burstHead].vibLeftX100 = can2::clampU16(pkt.vibRmsLeft * 100.0f);
        g_burstRing[g_burstHead].tempLeftX10 = static_cast<uint16_t>(can2::clampI16(pkt.tempLeftC * 10.0f));
        g_burstHead = static_cast<uint8_t>((g_burstHead + 1U) % kC3BurstRingFrames);
        if (g_burstCount < kC3BurstRingFrames) ++g_burstCount;

        uint8_t fVib[8], fTemp[8];
        can2::packAxleVibFrame(pkt, fVib);
        can2::packAxleTempFrame(pkt, fTemp);
        g_can.sendExtendedFrame(can2::makeExtId(can2::MSG_AXLE_VIB, g_nodeId24), fVib, 8);
        g_can.sendExtendedFrame(can2::makeExtId(can2::MSG_AXLE_TEMP_META, g_nodeId24), fTemp, 8);

        // Reset window accumulators
        g_rmsSqL = g_rmsSqR = 0.0f;
        g_peakL  = g_peakR  = 0.0f;
        g_crestL = g_crestR = 1.0f;
        g_clipL  = g_clipR  = false;
        g_winCount = 0;
    }

    // 2. Heartbeat packet (cable cut detection on STO / S3)
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
    g_can.serviceRecovery();

    const uint32_t blinkPeriod = (nowMs < g_identUntilMs) ? 100U : 600U;
    if (nowMs - g_lastBlinkMs >= blinkPeriod) {
        g_lastBlinkMs = nowMs;
        setLed(!g_ledOn);
    }
}
