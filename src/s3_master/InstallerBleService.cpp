#include "InstallerBleService.h"

#include <Arduino.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "techbit_config.h"

namespace techbit {

static constexpr const char* kServiceUuid  = "74656368-6269-7400-0001-000000000001";
static constexpr const char* kCharNodesId  = "74656368-6269-7400-0001-000000000002";
static constexpr const char* kCharCmdId    = "74656368-6269-7400-0001-000000000003";

namespace {

BLECharacteristic* g_nodesChar = nullptr;
rules::RuleEngine* g_cbEngine  = nullptr;
bool*              g_cbSavePtr = nullptr;
bool*              g_cbTestPtr = nullptr;

class BleCmdCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pChar) override {
        std::string val = pChar->getValue();
        if (val.empty() || !g_cbEngine) return;

        // Command formats for Web Bluetooth Installer UI:
        //   MAP:<HEX_NODE_ID>=<SLOT_1_TO_5>   (e.g. MAP:998877=4 -> P2-L/R)
        //   TRACTOR:<PLATE_OR_ID>
        //   TRAILER:<ID>
        //   LED_TEST
        if (val.rfind("MAP:", 0) == 0) {
            const char* eq = std::strchr(val.c_str() + 4, '=');
            if (eq) {
                uint32_t nid  = static_cast<uint32_t>(std::strtoul(val.c_str() + 4, nullptr, 16));
                int      slot = std::atoi(eq + 1);
                if (slot >= 1 && slot <= 5) {
                    g_cbEngine->assignNodeSlot(nid, static_cast<rules::WheelSlot>(slot));
                    if (g_cbSavePtr) *g_cbSavePtr = true;
                }
            }
        } else if (val.rfind("TRACTOR:", 0) == 0) {
            g_cbEngine->setAssetIds(val.c_str() + 8, g_cbEngine->trailerId());
            if (g_cbSavePtr) *g_cbSavePtr = true;
        } else if (val.rfind("TRAILER:", 0) == 0) {
            g_cbEngine->setAssetIds(g_cbEngine->tractorId(), val.c_str() + 8);
            if (g_cbSavePtr) *g_cbSavePtr = true;
        } else if (val == "LED_TEST") {
            if (g_cbTestPtr) *g_cbTestPtr = true;
        }
    }
};

BleCmdCallbacks g_cmdCallbacks;

} // namespace

InstallerBleService::InstallerBleService()
    : active_(false),
      expiresAtMs_(0),
      lastRefreshMs_(0),
      engine_(nullptr),
      pendingNvsSave_(false),
      ledTestRequested_(false) {}

void InstallerBleService::enableFor15Min(uint32_t nowMs, rules::RuleEngine* engine) {
    engine_ = engine;
    g_cbEngine  = engine;
    g_cbSavePtr = &pendingNvsSave_;
    g_cbTestPtr = &ledTestRequested_;
    expiresAtMs_ = nowMs + kBleServiceTimeoutMs;

    if (active_) return;

    BLEDevice::init("TechBIT-Service-S3");
    BLEServer* server   = BLEDevice::createServer();
    BLEService* service = server->createService(kServiceUuid);

    g_nodesChar = service->createCharacteristic(
        kCharNodesId, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
    g_nodesChar->addDescriptor(new BLE2902());

    BLECharacteristic* cmdChar = service->createCharacteristic(
        kCharCmdId, BLECharacteristic::PROPERTY_WRITE);
    cmdChar->setCallbacks(&g_cmdCallbacks);

    service->start();
    BLEAdvertising* adv = BLEDevice::getAdvertising();
    adv->addServiceUUID(kServiceUuid);
    adv->setScanResponse(true);
    BLEDevice::startAdvertising();

    active_ = true;
    Serial.println("[TechBIT BLE] Service Mode ACTIVE for 15 min (Web Bluetooth Installer).");
}

void InstallerBleService::disable() {
    if (!active_) return;
    BLEDevice::deinit(false);
    g_nodesChar = nullptr;
    active_     = false;
    Serial.println("[TechBIT BLE] Service Mode DISABLED (radio returned exclusively to ESP-NOW).");
}

uint32_t InstallerBleService::remainingSec(uint32_t nowMs) const {
    if (!active_ || nowMs >= expiresAtMs_) return 0;
    return (expiresAtMs_ - nowMs) / 1000U;
}

void InstallerBleService::service(uint32_t nowMs) {
    if (!active_) return;
    if (nowMs >= expiresAtMs_) {
        disable();
        return;
    }

    if (g_nodesChar && engine_ && (nowMs - lastRefreshMs_ >= 1000U)) {
        lastRefreshMs_ = nowMs;
        char buf[384];
        size_t pos = static_cast<size_t>(std::snprintf(
            buf, sizeof(buf), "{\"tractor\":\"%s\",\"trailer\":\"%s\",\"nodes\":[",
            engine_->tractorId(), engine_->trailerId()));

        bool first = true;
        const auto* nodes = engine_->nodes();
        for (uint8_t i = 0; i < kMaxTrackedNodes; ++i) {
            if (!nodes[i].used || pos + 64 >= sizeof(buf)) continue;
            char nid[12];
            can2::formatNodeIdString(nodes[i].telemetry.nodeId, nid);
            pos += static_cast<size_t>(std::snprintf(
                buf + pos, sizeof(buf) - pos,
                "%s{\"id\":\"%s\",\"slot\":%u,\"tL\":%.1f,\"tR\":%.1f,\"vL\":%.2f,\"vR\":%.2f}",
                first ? "" : ",",
                nid,
                static_cast<unsigned>(nodes[i].slot),
                nodes[i].telemetry.tempLeftC,
                nodes[i].telemetry.tempRightC,
                nodes[i].telemetry.vibRmsLeft,
                nodes[i].telemetry.vibRmsRight));
            first = false;
        }
        std::snprintf(buf + pos, sizeof(buf) - pos, "]}");
        g_nodesChar->setValue(buf);
        g_nodesChar->notify();
    }
}

} // namespace techbit
