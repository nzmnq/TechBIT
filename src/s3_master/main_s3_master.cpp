#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <cstring>
#include "esp_now.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#include "BlackBoxBuffer.h"
#include "CanBusManager.h"
#include "InstallerBleService.h"
#include "LteOfflineQueue.h"
#include "OtaManager.h"
#include "RuleConfig.h"
#include "RuleEngine.h"
#include "board_pins.h"
#include "can_protocol_v2.h"
#include "esp_now_protocol.h"
#include "techbit_config.h"

using namespace techbit;

namespace {

CanBusManager           g_can;
rules::RuleEngine       g_rules;
rules::BlackBoxBuffer   g_blackBox;
LteOfflineQueue         g_lte;
InstallerBleService     g_ble;
Preferences             g_prefs;

QueueHandle_t           g_canRxQueue    = nullptr;
QueueHandle_t           g_espNowQueue   = nullptr;

char                    g_deviceId[16]  = "S3_000000";
uint32_t                g_eventSeq      = 0;
uint32_t                g_lastEvalMs    = 0;
uint32_t                g_lastLteHbMs   = 0;
uint32_t                g_lastBtnMs     = 0;
uint32_t                g_ledTestEndMs  = 0;
char                    g_cmdBuf[256];
size_t                  g_cmdLen        = 0;

struct EspNowRxItem {
    uint8_t mac[6];
    int     rssi;
    size_t  len;
    uint8_t data[250];
};

// Reassembly cache for incoming Tractor CAN extended frames (two frames per node)
can2::AxleTelemetry     g_tractorNodes[kMaxTrackedNodes];

can2::AxleTelemetry* getOrCreateCanNode(uint32_t nodeId) {
    for (uint8_t i = 0; i < kMaxTrackedNodes; ++i) {
        if (g_tractorNodes[i].nodeId == nodeId || g_tractorNodes[i].nodeId == 0U) {
            g_tractorNodes[i].nodeId = nodeId;
            return &g_tractorNodes[i];
        }
    }
    return nullptr;
}

void deriveS3DeviceId() {
    uint8_t mac[6] = {};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    std::snprintf(g_deviceId, sizeof(g_deviceId), "S3_%02X%02X%02X", mac[3], mac[4], mac[5]);
}

void saveMappingAndIdsToNvs() {
    g_prefs.begin("tb_s3", false);
    g_prefs.putString("tractor_id", g_rules.tractorId());
    g_prefs.putString("trailer_id", g_rules.trailerId());
    const auto* nodes = g_rules.nodes();
    for (uint8_t i = 0; i < kMaxTrackedNodes; ++i) {
        if (nodes[i].used && nodes[i].slot != rules::SLOT_UNASSIGNED) {
            char key[16];
            std::snprintf(key, sizeof(key), "n_%06X", static_cast<unsigned>(nodes[i].telemetry.nodeId));
            g_prefs.putUChar(key, static_cast<uint8_t>(nodes[i].slot));
        }
    }
    g_prefs.end();
}

void loadStateFromNvs() {
    g_prefs.begin("tb_s3", true);
    String trId = g_prefs.getString("tractor_id", "TR_001");
    String tlId = g_prefs.getString("trailer_id", "");
    g_rules.setAssetIds(trId.c_str(), tlId.c_str());

    rules::RuleConfig& cfg = g_rules.config();
    cfg.tempWarnC          = g_prefs.getFloat("t_warn", cfg.tempWarnC);
    cfg.tempCritC          = g_prefs.getFloat("t_crit", cfg.tempCritC);
    cfg.axleTempDeltaWarnC = g_prefs.getFloat("dt_warn", cfg.axleTempDeltaWarnC);
    cfg.yellowConfirmMs    = g_prefs.getUInt("y_ms", cfg.yellowConfirmMs);
    cfg.shadowModeEnabled  = g_prefs.getBool("shadow", cfg.shadowModeEnabled);
    cfg.configVersion      = g_prefs.getUInt("cfg_ver", 1);
    g_prefs.end();
}

void saveConfigToNvs() {
    const rules::RuleConfig& cfg = g_rules.config();
    g_prefs.begin("tb_s3", false);
    g_prefs.putFloat("t_warn", cfg.tempWarnC);
    g_prefs.putFloat("t_crit", cfg.tempCritC);
    g_prefs.putFloat("dt_warn", cfg.axleTempDeltaWarnC);
    g_prefs.putUInt("y_ms", cfg.yellowConfirmMs);
    g_prefs.putBool("shadow", cfg.shadowModeEnabled);
    g_prefs.putUInt("cfg_ver", cfg.configVersion);
    g_prefs.end();
}

void onEspNowRecvCb(const uint8_t* mac, const uint8_t* data, int len) {
    if (!mac || !data || len <= 0 || len > 250 || !g_espNowQueue) return;
    EspNowRxItem item{};
    std::memcpy(item.mac, mac, 6);
    item.len = static_cast<size_t>(len);
    std::memcpy(item.data, data, item.len);
    xQueueSendFromISR(g_espNowQueue, &item, nullptr);
}

void pairWithBridgeMac(const uint8_t bridgeMac[6], const char* trailerId) {
    if (!esp_now_is_peer_exist(bridgeMac)) {
        esp_now_peer_info_t peer = {};
        std::memcpy(peer.peer_addr, bridgeMac, 6);
        peer.channel = kEspNowChannel;
        peer.ifidx   = WIFI_IF_STA;
        if (kEspNowEnableEncryption) {
            peer.encrypt = true;
            std::memcpy(peer.lmk, kEspNowLmk, 16);
        }
        esp_now_add_peer(&peer);
    }

    uint8_t ack[8] = {
        espnow2::kMagicByte0, espnow2::kMagicByte1, kProtocolVersion, espnow2::PKT_PAIR_ACK, 0, 0, 0, 0
    };
    esp_now_send(bridgeMac, ack, sizeof(ack));
    if (trailerId && trailerId[0] != '\0') {
        g_rules.setAssetIds(g_rules.tractorId(), trailerId);
    }
}

void canRxTask(void* /*param*/) {
    CanFrame frame{};
    for (;;) {
        while (g_can.receiveFrame(frame)) {
            if (g_canRxQueue != nullptr) {
                xQueueSend(g_canRxQueue, &frame, 0);
            }
        }
        g_can.serviceRecovery();
        vTaskDelay(pdMS_TO_TICKS(2));
    }
}

void updateCabinMiniLedIndicator(const rules::CabinIndicatorState& ind, uint32_t nowMs) {
    if (nowMs < g_ledTestEndMs) {
        bool blink = ((nowMs / 150U) % 2U) == 0U;
        digitalWrite(PIN_LED_GREEN, LOW);
        digitalWrite(PIN_LED_YELLOW, blink ? HIGH : LOW);
        digitalWrite(PIN_LED_RED, blink ? LOW : HIGH);
        digitalWrite(PIN_BUZZER, LOW);
        return;
    }

    switch (ind.driverSeverity) {
        case rules::SEV_RED:
            digitalWrite(PIN_LED_GREEN, LOW);
            digitalWrite(PIN_LED_YELLOW, LOW);
            digitalWrite(PIN_LED_RED, HIGH);
            digitalWrite(PIN_BUZZER, ((nowMs % 600U) < 250U) ? HIGH : LOW);
            break;
        case rules::SEV_YELLOW:
            digitalWrite(PIN_LED_GREEN, LOW);
            digitalWrite(PIN_LED_YELLOW, HIGH);
            digitalWrite(PIN_LED_RED, LOW);
            digitalWrite(PIN_BUZZER, LOW);
            break;
        case rules::SEV_GREEN:
        case rules::SEV_SHADOW: // Strictly hidden from driver!
        default:
            digitalWrite(PIN_LED_GREEN, (ind.activeNodeCount > 0 || ((nowMs / 700U) % 2U) == 0U) ? HIGH : LOW);
            digitalWrite(PIN_LED_YELLOW, LOW);
            digitalWrite(PIN_LED_RED, LOW);
            digitalWrite(PIN_BUZZER, LOW);
            break;
    }
}

void triggerBlackBoxUpload(const rules::BurstTriggerEvent& trig, uint32_t nowMs) {
    const uint32_t epochSec = g_lte.currentUtcEpoch(nowMs);
    char tsUtc[24];
    char uuid[40];
    rules::BlackBoxBuffer::formatIsoUtc(epochSec, tsUtc);
    rules::BlackBoxBuffer::makeEventUuid(epochSec, trig.triggerNodeId, ++g_eventSeq, uuid);

    can2::AxleTelemetry summaries[kMaxTrackedNodes];
    const uint8_t sumCount = g_rules.collectSummaries(summaries, kMaxTrackedNodes);

    const char* sevStr = (trig.severity == rules::SEV_RED)
                             ? "RED"
                             : (trig.severity == rules::SEV_SHADOW ? "SHADOW" : "YELLOW");

    static char jsonBuf[2400];
    g_blackBox.buildAnomalyBurstJson(
        jsonBuf, sizeof(jsonBuf),
        g_deviceId,
        g_rules.tractorId(),
        g_rules.trailerId(),
        tsUtc,
        uuid,
        sevStr,
        trig.triggerNodeId,
        trig.reason,
        summaries,
        sumCount);

    g_lte.enqueuePayload(jsonBuf);

    // Ask trigger C3 Node for raw detail chunk burst as well
    uint8_t cmd[8];
    can2::packMasterCmdFrame(can2::CMD_REQUEST_RAW_BURST, trig.triggerNodeId, cmd);
    g_can.sendExtendedFrame(can2::makeExtId(can2::MSG_MASTER_CMD, 0xFFFFFFU), cmd, 8);

    Serial.printf("\n[S3 BLACK BOX] %s Wheel=%s Reason=%s UTC=%s\n%s\n",
                  sevStr, trig.wheelCode, trig.reason, tsUtc, jsonBuf);
}

void printStatus() {
    const auto& ind = g_rules.indicator();
    const auto& cfg = g_rules.config();
    Serial.printf("\n=== TechBIT S3 Master (%s) Tractor=%s Trailer=%s ===\n",
                  g_deviceId, g_rules.tractorId(),
                  g_rules.trailerId()[0] ? g_rules.trailerId() : "NONE");
    Serial.printf("LED=%u Code=%s ActiveNodes=%u Offline=%u BlackBoxRecs=%u BLE=%s LTE=%s PendingQ=%u CfgV=%lu\n",
                  static_cast<unsigned>(ind.driverSeverity),
                  ind.wheelCode,
                  ind.activeNodeCount,
                  ind.offlineNodeCount,
                  g_blackBox.size(),
                  g_ble.isActive() ? "ON(15m)" : "OFF",
                  g_lte.isModemOnline() ? "ONLINE" : "OFFLINE",
                  g_lte.pendingCount(),
                  static_cast<unsigned long>(cfg.configVersion));
    Serial.println("CLI: status | ble on | ble off | cfg <json> | sim | dump\n");
}

void handleSerialCmd(const char* line) {
    if (std::strcmp(line, "status") == 0) {
        printStatus();
    } else if (std::strcmp(line, "ble on") == 0) {
        g_ble.enableFor15Min(millis(), &g_rules);
    } else if (std::strcmp(line, "ble off") == 0) {
        g_ble.disable();
    } else if (std::strncmp(line, "cfg ", 4) == 0) {
        if (rules::applyJsonConfigUpdate(line + 4, g_rules.config())) {
            saveConfigToNvs();
            Serial.printf("[S3 Master] Updated remote config to v%lu\n",
                          static_cast<unsigned long>(g_rules.config().configVersion));
        }
    } else if (std::strcmp(line, "sim") == 0) {
        rules::BurstTriggerEvent sim{};
        sim.triggered     = true;
        sim.severity      = rules::SEV_YELLOW;
        sim.triggerNodeId = 0x998877U;
        std::snprintf(sim.wheelCode, sizeof(sim.wheelCode), "P2-L");
        std::snprintf(sim.reason, sizeof(sim.reason), "TEMP_DELTA_HIGH");
        triggerBlackBoxUpload(sim, millis());
    } else if (std::strcmp(line, "dump") == 0) {
        printStatus();
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

} // namespace

void setup() {
    OtaManager::confirmAppValidAfterSelfTest();

    pinMode(PIN_LED_GREEN, OUTPUT);
    pinMode(PIN_LED_YELLOW, OUTPUT);
    pinMode(PIN_LED_RED, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT);
    pinMode(PIN_BTN_SERVICE, INPUT_PULLUP);

    Serial.begin(115200);
    delay(350);

    deriveS3DeviceId();
    g_rules.init();
    loadStateFromNvs();
    g_blackBox.reset();

    WiFi.mode(WIFI_STA);
    if (kEspNowUseLongRange) {
        esp_wifi_set_protocol(WIFI_IF_STA,
                              WIFI_PROTOCOL_11B | WIFI_PROTOCOL_11G | WIFI_PROTOCOL_11N | WIFI_PROTOCOL_LR);
    }
    esp_wifi_set_channel(kEspNowChannel, WIFI_SECOND_CHAN_NONE);

    if (esp_now_init() == ESP_OK) {
        if (kEspNowEnableEncryption) {
            esp_now_set_pmk(kEspNowPmk);
        }
        esp_now_register_recv_cb(onEspNowRecvCb);
    }

    g_can.begin(PIN_CAN_TX, PIN_CAN_RX);
    g_lte.begin(PIN_LTE_RX, PIN_LTE_TX, PIN_LTE_PWRKEY, "https://api.techbit.ua/api/ingest");

    g_canRxQueue  = xQueueCreate(48, sizeof(CanFrame));
    g_espNowQueue = xQueueCreate(16, sizeof(EspNowRxItem));
    xTaskCreatePinnedToCore(canRxTask, "can_rx_task", 4096, nullptr, 3, nullptr, 0);

    printStatus();
}

void loop() {
    const uint32_t nowMs = millis();

    // 1. Ingest Tractor CAN frames (Front + Rear C3 Nodes)
    CanFrame canRx{};
    while (g_canRxQueue && xQueueReceive(g_canRxQueue, &canRx, 0) == pdTRUE) {
        if (!canRx.extended) continue;
        const uint8_t  type   = can2::extractMsgType(canRx.id);
        const uint32_t nodeId = can2::extractNodeId(canRx.id);

        if (type == can2::MSG_HEARTBEAT) {
            can2::NodeHeartbeat hb{};
            hb.nodeId = nodeId;
            can2::unpackHeartbeatFrame(canRx.data, hb);
            g_rules.onNodeHeartbeat(hb, false, nowMs);
        } else if (type == can2::MSG_AXLE_VIB || type == can2::MSG_AXLE_TEMP_META) {
            can2::AxleTelemetry* t = getOrCreateCanNode(nodeId);
            if (t) {
                if (type == can2::MSG_AXLE_VIB) {
                    can2::unpackAxleVibFrame(canRx.data, *t);
                } else {
                    can2::unpackAxleTempFrame(canRx.data, *t);
                    g_rules.onAxleTelemetry(*t, false, nowMs);
                }
            }
        }
    }

    // 2. Ingest Trailer ESP-NOW packets
    EspNowRxItem espRx{};
    while (g_espNowQueue && xQueueReceive(g_espNowQueue, &espRx, 0) == pdTRUE) {
        espnow2::TrailerTelemetryPacket tp{};
        if (espnow2::validateTelemetryPacket(espRx.data, espRx.len, tp)) {
            g_rules.onTrailerEspNowPacket(tp, nowMs);
        } else if (espRx.len == sizeof(espnow2::TrailerDiscoveryPacket) &&
                   espRx.data[0] == espnow2::kMagicByte0 &&
                   espRx.data[3] == espnow2::PKT_DISCOVERY) {
            // Auto-pair in Service BLE Mode or if no trailer paired yet
            const auto* dp = reinterpret_cast<const espnow2::TrailerDiscoveryPacket*>(espRx.data);
            if (g_ble.isActive() || g_rules.trailerId()[0] == '\0') {
                pairWithBridgeMac(espRx.mac, dp->trailerId);
            }
        }
    }

    // 3. enclosure Service Button -> 15 min BLE Installer Mode (strictly OFF otherwise!)
    if (digitalRead(PIN_BTN_SERVICE) == LOW && (nowMs - g_lastBtnMs > 400U)) {
        g_lastBtnMs = nowMs;
        if (g_ble.isActive()) {
            g_ble.disable();
        } else {
            g_ble.enableFor15Min(nowMs, &g_rules);
        }
    }
    g_ble.service(nowMs);
    if (g_ble.consumePendingConfigSave()) {
        saveMappingAndIdsToNvs();
    }
    if (g_ble.consumeLedTestRequest()) {
        g_ledTestEndMs = nowMs + 3000U;
    }

    pollSerialCli();

    // 4. Periodic 1-Hz Black Box Snapshot + Rule Engine Evaluation + Cabin LED
    if (nowMs - g_lastEvalMs >= 1000U) {
        g_lastEvalMs = nowMs;

        const uint32_t utcSec = g_lte.currentUtcEpoch(nowMs);
        can2::AxleTelemetry sums[kMaxTrackedNodes];
        const uint8_t sCnt = g_rules.collectSummaries(sums, kMaxTrackedNodes);
        for (uint8_t i = 0; i < sCnt; ++i) {
            g_blackBox.pushSample(utcSec, sums[i]);
        }

        const rules::BurstTriggerEvent trig = g_rules.update(nowMs);
        if (trig.triggered) {
            triggerBlackBoxUpload(trig, nowMs);
        }
    }

    updateCabinMiniLedIndicator(g_rules.indicator(), nowMs);

    // 5. Lightweight LTE Periodic Heartbeat (1-5 min) + Offline Queue Flush
    if (nowMs - g_lastLteHbMs >= kLteHeartbeatPeriodMs) {
        g_lastLteHbMs = nowMs;
        can2::AxleTelemetry sums[kMaxTrackedNodes];
        const uint8_t sCnt = g_rules.collectSummaries(sums, kMaxTrackedNodes);
        if (sCnt > 0U) {
            char tsUtc[24];
            char hbBuf[1200];
            rules::BlackBoxBuffer::formatIsoUtc(g_lte.currentUtcEpoch(nowMs), tsUtc);
            g_blackBox.buildHeartbeatJson(hbBuf, sizeof(hbBuf), g_deviceId,
                                            g_rules.tractorId(), g_rules.trailerId(),
                                            tsUtc, sums, sCnt, g_rules.config().configVersion);
            g_lte.enqueuePayload(hbBuf);
        }
    }
    g_lte.service(nowMs);

    delay(5);
}
