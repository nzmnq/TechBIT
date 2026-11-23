#pragma once

#include <cstdint>
#include "RuleConfig.h"
#include "can_protocol_v2.h"
#include "esp_now_protocol.h"
#include "techbit_config.h"

namespace techbit {
namespace rules {

enum AlertSeverity : uint8_t {
    SEV_GREEN  = 0,
    SEV_SHADOW = 1, // Recorded in cloud Black Box, NOT shown on cab driver LED
    SEV_YELLOW = 2, // Pre-warning (> 60s sustained or ΔT > 18°C), shows wheel code
    SEV_RED    = 3  // Critical hazard -> Red LED + wheel code + cab buzzer
};

enum WheelSlot : uint8_t {
    SLOT_UNASSIGNED = 0,
    SLOT_TRACTOR_A1 = 1, // Codes: T1-L / T1-R
    SLOT_TRACTOR_A2 = 2, // Codes: T2-L / T2-R
    SLOT_TRAILER_A1 = 3, // Codes: P1-L / P1-R
    SLOT_TRAILER_A2 = 4, // Codes: P2-L / P2-R
    SLOT_TRAILER_A3 = 5  // Codes: P3-L / P3-R
};

inline void formatWheelCode(WheelSlot slot, bool isRightWheel, char out[8]) {
    const char side = isRightWheel ? 'R' : 'L';
    switch (slot) {
        case SLOT_TRACTOR_A1: std::snprintf(out, 8, "T1-%c", side); break;
        case SLOT_TRACTOR_A2: std::snprintf(out, 8, "T2-%c", side); break;
        case SLOT_TRAILER_A1: std::snprintf(out, 8, "P1-%c", side); break;
        case SLOT_TRAILER_A2: std::snprintf(out, 8, "P2-%c", side); break;
        case SLOT_TRAILER_A3: std::snprintf(out, 8, "P3-%c", side); break;
        default:              std::snprintf(out, 8, "U-%c", side); break;
    }
}

struct TrackedAxleNode {
    bool              used;
    bool              online;
    bool              fromTrailer;
    uint32_t          lastRxMs;
    uint32_t          uptimeSec;
    WheelSlot         slot;
    can2::AxleTelemetry telemetry;

    // Sustained rule accumulation
    uint32_t          yellowAccumMs;
    uint32_t          redAccumMs;
    bool              yellowLatched;
    bool              redLatched;
    bool              shadowTriggered;
    bool              rightIsHotSide;
    char              lastReason[32];
};

struct BurstTriggerEvent {
    bool          triggered;
    AlertSeverity severity;
    uint32_t      triggerNodeId;
    char          wheelCode[8];
    char          reason[32];
};

struct CabinIndicatorState {
    AlertSeverity driverSeverity; // NEVER equals SEV_SHADOW (keeps driver calm)
    char          wheelCode[8];   // e.g. "P2-L" or "OK"
    bool          buzzerOn;
    uint8_t       activeNodeCount;
    uint8_t       offlineNodeCount;
};

// Rule-Based Multi-Axle Evaluator & Black Box Trigger Controller (Software Spec 3.3).
// 100% pure C++17 — runs identically on ESP32-S3 Master and host native_test.
class RuleEngine {
public:
    RuleEngine();

    void init();
    void setAssetIds(const char* tractorId, const char* trailerId);
    const char* tractorId() const { return tractorId_; }
    const char* trailerId() const { return trailerId_; }

    RuleConfig& config() { return cfg_; }
    const RuleConfig& config() const { return cfg_; }

    // Pair/map hardware MAC node_id to physical axle slot (via BLE Service Mode or NVS)
    bool assignNodeSlot(uint32_t nodeId, WheelSlot slot);

    // Ingest telemetry from Tractor CAN or Trailer ESP-NOW Bridge
    void onAxleTelemetry(const can2::AxleTelemetry& t, bool fromTrailer, uint32_t nowMs);
    void onNodeHeartbeat(const can2::NodeHeartbeat& hb, bool fromTrailer, uint32_t nowMs);
    void onTrailerEspNowPacket(const espnow2::TrailerTelemetryPacket& pkt, uint32_t nowMs);

    // Evaluate all online nodes and return BurstTriggerEvent if cloud upload is needed
    BurstTriggerEvent update(uint32_t nowMs);

    const CabinIndicatorState& indicator() const { return indicator_; }
    uint8_t collectSummaries(can2::AxleTelemetry* outArr, uint8_t maxCount) const;
    const TrackedAxleNode* nodes() const { return nodes_; }

private:
    int findOrCreateNode(uint32_t nodeId);

    RuleConfig          cfg_;
    char                tractorId_[16];
    char                trailerId_[16];
    TrackedAxleNode     nodes_[kMaxTrackedNodes];
    CabinIndicatorState indicator_;
    uint32_t            lastUpdateMs_;
};

} // namespace rules
} // namespace techbit
