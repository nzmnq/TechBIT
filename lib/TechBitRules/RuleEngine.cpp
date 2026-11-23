#include "RuleEngine.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace techbit {
namespace rules {

RuleEngine::RuleEngine() : lastUpdateMs_(0) {
    init();
}

void RuleEngine::init() {
    cfg_ = RuleConfig{};
    std::snprintf(tractorId_, sizeof(tractorId_), "TR_001");
    trailerId_[0] = '\0';
    std::memset(nodes_, 0, sizeof(nodes_));
    std::memset(&indicator_, 0, sizeof(indicator_));
    indicator_.driverSeverity = SEV_GREEN;
    std::snprintf(indicator_.wheelCode, sizeof(indicator_.wheelCode), "OK");
    lastUpdateMs_ = 0;
}

void RuleEngine::setAssetIds(const char* tractorId, const char* trailerId) {
    if (tractorId && tractorId[0] != '\0') {
        std::snprintf(tractorId_, sizeof(tractorId_), "%s", tractorId);
    }
    if (trailerId) {
        std::snprintf(trailerId_, sizeof(trailerId_), "%s", trailerId);
    }
}

int RuleEngine::findOrCreateNode(uint32_t nodeId) {
    int freeIdx = -1;
    for (int i = 0; i < static_cast<int>(kMaxTrackedNodes); ++i) {
        if (nodes_[i].used && nodes_[i].telemetry.nodeId == nodeId) {
            return i;
        }
        if (!nodes_[i].used && freeIdx < 0) {
            freeIdx = i;
        }
    }
    if (freeIdx >= 0) {
        std::memset(&nodes_[freeIdx], 0, sizeof(TrackedAxleNode));
        nodes_[freeIdx].used             = true;
        nodes_[freeIdx].telemetry.nodeId = nodeId;
    }
    return freeIdx;
}

bool RuleEngine::assignNodeSlot(uint32_t nodeId, WheelSlot slot) {
    const int idx = findOrCreateNode(nodeId);
    if (idx < 0) return false;
    nodes_[idx].slot = slot;
    return true;
}

void RuleEngine::onAxleTelemetry(const can2::AxleTelemetry& t, bool fromTrailer, uint32_t nowMs) {
    const int idx = findOrCreateNode(t.nodeId);
    if (idx < 0) return;
    TrackedAxleNode& n = nodes_[idx];
    n.telemetry   = t;
    n.fromTrailer = fromTrailer;
    n.online      = true;
    n.lastRxMs    = nowMs;

    // Auto-assign sensible fallback slots if not yet mapped in BLE Service Mode
    if (n.slot == SLOT_UNASSIGNED) {
        if (!fromTrailer) {
            n.slot = (idx == 0) ? SLOT_TRACTOR_A1 : SLOT_TRACTOR_A2;
        } else {
            uint8_t trailerIdx = 0;
            for (int i = 0; i < idx; ++i) {
                if (nodes_[i].used && nodes_[i].fromTrailer) ++trailerIdx;
            }
            n.slot = static_cast<WheelSlot>(SLOT_TRAILER_A1 + std::min<uint8_t>(trailerIdx, 2U));
        }
    }
}

void RuleEngine::onNodeHeartbeat(const can2::NodeHeartbeat& hb, bool fromTrailer, uint32_t nowMs) {
    const int idx = findOrCreateNode(hb.nodeId);
    if (idx < 0) return;
    nodes_[idx].online    = true;
    nodes_[idx].fromTrailer = fromTrailer;
    nodes_[idx].lastRxMs  = nowMs;
    nodes_[idx].uptimeSec = hb.uptimeSec;
}

void RuleEngine::onTrailerEspNowPacket(const espnow2::TrailerTelemetryPacket& pkt, uint32_t nowMs) {
    if (pkt.trailerId[0] != '\0') {
        std::snprintf(trailerId_, sizeof(trailerId_), "%s", pkt.trailerId);
    }
    const uint8_t n = (pkt.nodeCount <= espnow2::kMaxNodesPerBridgePacket)
                          ? pkt.nodeCount
                          : espnow2::kMaxNodesPerBridgePacket;
    for (uint8_t i = 0; i < n; ++i) {
        can2::AxleTelemetry t = espnow2::fromCompactRecord(pkt.nodes[i]);
        onAxleTelemetry(t, true, nowMs);
    }
}

uint8_t RuleEngine::collectSummaries(can2::AxleTelemetry* outArr, uint8_t maxCount) const {
    if (!outArr || maxCount == 0) return 0;
    uint8_t n = 0;
    for (uint8_t i = 0; i < kMaxTrackedNodes && n < maxCount; ++i) {
        if (nodes_[i].used && nodes_[i].online) {
            outArr[n++] = nodes_[i].telemetry;
        }
    }
    return n;
}

BurstTriggerEvent RuleEngine::update(uint32_t nowMs) {
    BurstTriggerEvent evt{};
    evt.triggered = false;

    uint32_t dtMs = (lastUpdateMs_ == 0 || nowMs < lastUpdateMs_) ? 1000U : (nowMs - lastUpdateMs_);
    if (dtMs > 5000U) dtMs = 5000U;
    lastUpdateMs_ = nowMs;

    // 1. Compute global peer baseline vibration across all online nodes
    float vibSum = 0.0f;
    uint8_t onlineCount = 0;
    uint8_t offlineCount = 0;

    for (uint8_t i = 0; i < kMaxTrackedNodes; ++i) {
        TrackedAxleNode& n = nodes_[i];
        if (!n.used) continue;

        n.online = ((nowMs - n.lastRxMs) <= kNodeOfflineTimeoutMs);
        if (n.online) {
            ++onlineCount;
            vibSum += 0.5f * (n.telemetry.vibRmsLeft + n.telemetry.vibRmsRight);
        } else {
            ++offlineCount;
        }
    }

    const float fleetMeanVib = (onlineCount > 0U) ? std::max(0.8f, vibSum / static_cast<float>(onlineCount)) : 1.0f;

    // Detect bad cobblestone road when >= 2 axles share elevated vibration simultaneously
    uint8_t roughAxleCount = 0;
    for (uint8_t i = 0; i < kMaxTrackedNodes; ++i) {
        if (!nodes_[i].used || !nodes_[i].online) continue;
        const float meanV = 0.5f * (nodes_[i].telemetry.vibRmsLeft + nodes_[i].telemetry.vibRmsRight);
        if (meanV >= cfg_.vibWarnRmsMmS) {
            ++roughAxleCount;
        }
    }
    const bool roughRoadAllWheels = (onlineCount >= 2U && roughAxleCount >= 2U);

    // 2. Evaluate each online axle node
    AlertSeverity highestDriverSev = SEV_GREEN;
    char highestWheelCode[8] = "OK";

    for (uint8_t i = 0; i < kMaxTrackedNodes; ++i) {
        TrackedAxleNode& n = nodes_[i];
        if (!n.used || !n.online) continue;

        const can2::AxleTelemetry& t = n.telemetry;
        const float maxTemp = std::max(t.tempLeftC, t.tempRightC);
        const float tempDelta = std::fabs(t.tempLeftC - t.tempRightC);
        n.rightIsHotSide = (t.tempRightC > t.tempLeftC) ||
                           (tempDelta < 3.0f && t.vibRmsRight > t.vibRmsLeft);

        const float minSideVib = std::max(0.6f, std::min(t.vibRmsLeft, t.vibRmsRight));
        const float maxSideVib = std::max(t.vibRmsLeft, t.vibRmsRight);
        const float sideRatio  = maxSideVib / minSideVib;
        const float peerRatio  = maxSideVib / fleetMeanVib;

        // Pothole transient shock guard (high crest without sustained thermal build-up)
        const bool transientPothole =
            ((n.rightIsHotSide ? t.crestRight : t.crestLeft) >= 4.2f) && (tempDelta < 10.0f);

        // Hard critical RED condition
        const bool redCond =
            (maxTemp >= cfg_.tempCritC) ||
            (tempDelta >= cfg_.axleTempDeltaCritC) ||
            (!transientPothole && !roughRoadAllWheels &&
             maxSideVib >= cfg_.vibCritRmsMmS && peerRatio >= cfg_.vibDeltaRatioWarn);

        // Warning YELLOW condition (sustained > 60 s per Spec 3.3!)
        const bool yellowCond =
            redCond ||
            (maxTemp >= cfg_.tempWarnC) ||
            (tempDelta >= cfg_.axleTempDeltaWarnC) ||
            (!transientPothole && !roughRoadAllWheels &&
             sideRatio >= cfg_.vibDeltaRatioWarn && maxSideVib >= cfg_.vibWarnRmsMmS);

        // Shadow Mode condition (early subtle anomaly: logs to Cloud Black Box silently)
        const bool shadowCond =
            cfg_.shadowModeEnabled &&
            !yellowCond &&
            !transientPothole &&
            !roughRoadAllWheels &&
            (sideRatio >= cfg_.shadowVibRatio || tempDelta >= (cfg_.axleTempDeltaWarnC * 0.65f));

        if (redCond) {
            n.redAccumMs = std::min<uint32_t>(n.redAccumMs + dtMs, cfg_.redConfirmMs + 5000U);
        } else {
            const uint32_t dec = dtMs * 2U;
            n.redAccumMs = (n.redAccumMs > dec) ? (n.redAccumMs - dec) : 0U;
            if (n.redAccumMs == 0U) n.redLatched = false;
        }

        if (yellowCond) {
            // Thermal delta accumulates at real-time pace; vibration spikes only if not a pothole
            n.yellowAccumMs = std::min<uint32_t>(n.yellowAccumMs + dtMs, cfg_.yellowConfirmMs + 5000U);
        } else if (transientPothole) {
            const uint32_t slowDec = dtMs / 2U;
            n.yellowAccumMs = (n.yellowAccumMs > slowDec) ? (n.yellowAccumMs - slowDec) : 0U;
        } else {
            const uint32_t dec = dtMs * 2U;
            n.yellowAccumMs = (n.yellowAccumMs > dec) ? (n.yellowAccumMs - dec) : 0U;
            if (n.yellowAccumMs == 0U) n.yellowLatched = false;
        }

        const char* reason = "VIB_SPIKE";
        if (maxTemp >= cfg_.tempCritC || tempDelta >= cfg_.axleTempDeltaCritC) {
            reason = "TEMP_CRITICAL_BRAKE";
        } else if (tempDelta >= cfg_.axleTempDeltaWarnC || maxTemp >= cfg_.tempWarnC) {
            reason = "TEMP_DELTA_HIGH";
        }
        std::snprintf(n.lastReason, sizeof(n.lastReason), "%s", reason);

        // Edge-triggered Black Box uploads when entering RED, YELLOW, or SHADOW
        if (n.redAccumMs >= cfg_.redConfirmMs && !n.redLatched) {
            n.redLatched    = true;
            n.yellowLatched = true;
            evt.triggered     = true;
            evt.severity      = SEV_RED;
            evt.triggerNodeId = t.nodeId;
            formatWheelCode(n.slot, n.rightIsHotSide, evt.wheelCode);
            std::snprintf(evt.reason, sizeof(evt.reason), "%s", reason);
        } else if (n.yellowAccumMs >= cfg_.yellowConfirmMs && !n.yellowLatched) {
            n.yellowLatched = true;
            evt.triggered     = true;
            evt.severity      = SEV_YELLOW;
            evt.triggerNodeId = t.nodeId;
            formatWheelCode(n.slot, n.rightIsHotSide, evt.wheelCode);
            std::snprintf(evt.reason, sizeof(evt.reason), "%s", reason);
        } else if (shadowCond && !n.shadowTriggered) {
            n.shadowTriggered = true;
            if (!evt.triggered) {
                evt.triggered     = true;
                evt.severity      = SEV_SHADOW;
                evt.triggerNodeId = t.nodeId;
                formatWheelCode(n.slot, n.rightIsHotSide, evt.wheelCode);
                std::snprintf(evt.reason, sizeof(evt.reason), "SHADOW_EARLY_DRIFT");
            }
        } else if (!shadowCond && n.yellowAccumMs == 0U) {
            n.shadowTriggered = false;
        }

        if (n.redLatched) {
            highestDriverSev = SEV_RED;
            formatWheelCode(n.slot, n.rightIsHotSide, highestWheelCode);
        } else if (n.yellowLatched && highestDriverSev < SEV_YELLOW) {
            highestDriverSev = SEV_YELLOW;
            formatWheelCode(n.slot, n.rightIsHotSide, highestWheelCode);
        }
    }

    indicator_.driverSeverity   = highestDriverSev;
    indicator_.buzzerOn         = (highestDriverSev == SEV_RED);
    indicator_.activeNodeCount  = onlineCount;
    indicator_.offlineNodeCount = offlineCount;
    std::snprintf(indicator_.wheelCode, sizeof(indicator_.wheelCode), "%s", highestWheelCode);

    return evt;
}

} // namespace rules
} // namespace techbit
