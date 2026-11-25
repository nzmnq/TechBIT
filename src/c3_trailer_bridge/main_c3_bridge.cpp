#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>
#include <cstring>
#include "esp_now.h"
#include "esp_wifi.h"

#include "CanBusManager.h"
#include "board_pins.h"
#include "can_protocol_v2.h"
#include "esp_now_protocol.h"
#include "techbit_config.h"

using namespace techbit;

namespace {

CanBusManager g_can;
Preferences   g_prefs;

char     g_trailerId[12]   = "TL_042";
uint8_t  g_s3PeerMac[6]    = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
bool     g_s3Paired        = false;
uint16_t g_espSeq          = 0;
uint32_t g_lastEspSendMs   = 0;
uint32_t g_lastDiscoveryMs = 0;
uint32_t g_lastBlinkMs     = 0;
bool     g_ledOn           = false;

struct TrailerNodeCache {
    bool                used;
    uint32_t            lastRxMs;
    can2::AxleTelemetry data;
};
TrailerNodeCache g_nodes[espnow2::kMaxNodesPerBridgePacket];

void setLed(bool on) {
    g_ledOn = on;
    digitalWrite(PIN_STATUS_LED, STATUS_LED_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW));
}

int findOrAddNode(uint32_t nodeId) {
    int freeIdx = -1;
    for (int i = 0; i < static_cast<int>(espnow2::kMaxNodesPerBridgePacket); ++i) {
        if (g_nodes[i].used && g_nodes[i].data.nodeId == nodeId) return i;
        if (!g_nodes[i].used && freeIdx < 0) freeIdx = i;
    }
    if (freeIdx >= 0) {
        g_nodes[freeIdx]             = TrailerNodeCache{};
        g_nodes[freeIdx].used        = true;
        g_nodes[freeIdx].data.nodeId = nodeId;
    }
    return freeIdx;
}

bool addS3EncryptedPeer(const uint8_t mac[6]) {
    if (esp_now_is_peer_exist(mac)) {
        esp_now_del_peer(mac);
    }
    esp_now_peer_info_t peer = {};
    std::memcpy(peer.peer_addr, mac, 6);
    peer.channel = kEspNowChannel;
    peer.ifidx   = WIFI_IF_STA;
    if (kEspNowEnableEncryption) {
        peer.encrypt = true;
        std::memcpy(peer.lmk, kEspNowLmk, 16);
    }
    return (esp_now_add_peer(&peer) == ESP_OK);
}

void onEspNowRecv(const uint8_t* mac, const uint8_t* data, int len) {
    if (!mac || !data || len < 4) return;
    // Handle pairing ACK or CMD_REQUEST_RAW_BURST forwarded from S3 Master
    if (data[0] == espnow2::kMagicByte0 && data[1] == espnow2::kMagicByte1) {
        if (data[3] == espnow2::PKT_PAIR_ACK) {
            std::memcpy(g_s3PeerMac, mac, 6);
            g_s3Paired = true;
            g_prefs.begin("tb_bridge", false);
            g_prefs.putBytes("s3_mac", g_s3PeerMac, 6);
            g_prefs.end();
            addS3EncryptedPeer(g_s3PeerMac);
            Serial.println("[Trailer Bridge] Paired securely with S3 Master (AES-128)!");
        } else if (data[3] == espnow2::PKT_BURST_DATA && len >= 8) {
            // Relay burst request onto Trailer CAN bus
            uint32_t targetNode = static_cast<uint32_t>(data[4]) |
                                  (static_cast<uint32_t>(data[5]) << 8) |
                                  (static_cast<uint32_t>(data[6]) << 16);
            uint8_t cmd[8];
            can2::packMasterCmdFrame(can2::CMD_REQUEST_RAW_BURST, targetNode, cmd);
            g_can.sendExtendedFrame(can2::makeExtId(can2::MSG_MASTER_CMD, 0xFFFFFFU), cmd, 8);
        }
    }
}

void sendDiscoveryBeacon() {
    espnow2::TrailerDiscoveryPacket dp{};
    dp.magic0          = espnow2::kMagicByte0;
    dp.magic1          = espnow2::kMagicByte1;
    dp.protocolVersion = kProtocolVersion;
    dp.packetType      = espnow2::PKT_DISCOVERY;
    std::snprintf(dp.trailerId, sizeof(dp.trailerId), "%s", g_trailerId);
    esp_read_mac(dp.bridgeMac, ESP_MAC_WIFI_STA);
    dp.crc16 = espnow2::crc16Ccitt(reinterpret_cast<const uint8_t*>(&dp),
                                   sizeof(dp) - sizeof(uint16_t));

    uint8_t bcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
    if (!esp_now_is_peer_exist(bcast)) {
        esp_now_peer_info_t bPeer = {};
        std::memcpy(bPeer.peer_addr, bcast, 6);
        bPeer.channel = kEspNowChannel;
        bPeer.ifidx   = WIFI_IF_STA;
        bPeer.encrypt = false;
        esp_now_add_peer(&bPeer);
    }
    esp_now_send(bcast, reinterpret_cast<const uint8_t*>(&dp), sizeof(dp));
}

} // namespace

void setup() {
    pinMode(PIN_STATUS_LED, OUTPUT);
    pinMode(PIN_BTN_PAIR, INPUT_PULLUP);
    setLed(false);

    Serial.begin(115200);
    delay(300);

    g_prefs.begin("tb_bridge", false);
    String savedId = g_prefs.getString("trailer_id", "TL_042");
    std::snprintf(g_trailerId, sizeof(g_trailerId), "%s", savedId.c_str());
    if (g_prefs.getBytesLength("s3_mac") == 6) {
        g_prefs.getBytes("s3_mac", g_s3PeerMac, 6);
        g_s3Paired = true;
    }
    g_prefs.end();

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
        esp_now_register_recv_cb(onEspNowRecv);
        if (g_s3Paired) {
            addS3EncryptedPeer(g_s3PeerMac);
        }
        Serial.printf("[Trailer Bridge] ESP-NOW ready (ID=%s, Ch=%u, LR=%s)\n",
                      g_trailerId, kEspNowChannel, kEspNowUseLongRange ? "ON" : "OFF");
    }

    if (!g_can.begin(PIN_CAN_TX, PIN_CAN_RX)) {
        Serial.println("[Trailer Bridge] ERROR: CAN init failed!");
    }
}

void loop() {
    const uint32_t nowMs = millis();

    // 1. Drain Trailer CAN bus
    CanFrame rx{};
    while (g_can.receiveFrame(rx)) {
        if (!rx.extended) continue;
        const uint8_t  type   = can2::extractMsgType(rx.id);
        const uint32_t nodeId = can2::extractNodeId(rx.id);
        const int idx = findOrAddNode(nodeId);
        if (idx < 0) continue;

        g_nodes[idx].lastRxMs = nowMs;
        if (type == can2::MSG_AXLE_VIB) {
            can2::unpackAxleVibFrame(rx.data, g_nodes[idx].data);
        } else if (type == can2::MSG_AXLE_ML_FEATURES) {
            can2::unpackAxleMlFeaturesFrame(rx.data, g_nodes[idx].data);
        } else if (type == can2::MSG_AXLE_TEMP_META) {
            can2::unpackAxleTempFrame(rx.data, g_nodes[idx].data);
        }
    }
    g_can.serviceRecovery();

    // 2. Periodic ESP-NOW telemetry transfer to Cabin S3 Master (1 Hz)
    if (g_s3Paired && (nowMs - g_lastEspSendMs >= 1000U)) {
        g_lastEspSendMs = nowMs;

        espnow2::TrailerTelemetryPacket pkt{};
        std::snprintf(pkt.trailerId, sizeof(pkt.trailerId), "%s", g_trailerId);
        pkt.sequence = ++g_espSeq;

        uint8_t nCount = 0;
        for (int i = 0; i < static_cast<int>(espnow2::kMaxNodesPerBridgePacket); ++i) {
            if (g_nodes[i].used && (nowMs - g_nodes[i].lastRxMs <= kNodeOfflineTimeoutMs)) {
                pkt.nodes[nCount++] = espnow2::toCompactRecord(g_nodes[i].data);
            }
        }
        pkt.nodeCount = nCount;
        espnow2::finalizeTelemetryCrc(pkt);

        if (nCount > 0) {
            esp_now_send(g_s3PeerMac, reinterpret_cast<const uint8_t*>(&pkt), sizeof(pkt));
        }

        Serial.printf("{\"type\":\"techbit_trailer_bridge\",\"mcu\":\"ESP32-C3\",\"trailerId\":\"%s\",\"paired\":%s,\"seq\":%u,\"nodeCount\":%u,\"canRx\":%lu}\n",
                      g_trailerId,
                      g_s3Paired ? "true" : "false",
                      static_cast<unsigned>(g_espSeq),
                      static_cast<unsigned>(nCount),
                      static_cast<unsigned long>(g_can.rxCount()));
    }

    // 3. Discovery beacon if unpaired or pair button pressed (Drop & Hook auto-discovery)
    const bool forcePair = (digitalRead(PIN_BTN_PAIR) == LOW);
    if ((!g_s3Paired || forcePair) && (nowMs - g_lastDiscoveryMs >= 3000U)) {
        g_lastDiscoveryMs = nowMs;
        sendDiscoveryBeacon();
    }

    if (nowMs - g_lastBlinkMs >= (g_s3Paired ? 800U : 200U)) {
        g_lastBlinkMs = nowMs;
        setLed(!g_ledOn);
    }

    delay(5);
}
