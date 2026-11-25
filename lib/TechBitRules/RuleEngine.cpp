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
    for (uint8_t i = 0; i < kMaxTrackedNodes; ++i) {
        nodes_[i] = TrackedAxleNode{};
    }
    indicator_ = CabinIndicatorState{};
    indicator_.driverSeverity = SEV_GREEN;
    std::snprintf(indicator_.wheelCode, sizeof(indicator_.wheelCode), "OK");
    lastUpdateMs_ = 0;
}

void RuleEngine::resetBaselines() {
    for (uint8_t i = 0; i < kMaxTrackedNodes; ++i) {
        std::memset(&nodes_[i].baseLeft, 0, sizeof(WheelBaseline));
        std::memset(&nodes_[i].baseRight, 0, sizeof(WheelBaseline));
        nodes_[i].yellowAccumMs   = 0;
        nodes_[i].redAccumMs      = 0;
        nodes_[i].yellowLatched   = false;
        nodes_[i].redLatched      = false;
        nodes_[i].shadowTriggered = false;
    }
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
        nodes_[freeIdx]                  = TrackedAxleNode{};
        nodes_[freeIdx].used             = true;
        nodes_[freeIdx].telemetry        = can2::AxleTelemetry{};
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
    nodes_[idx].online      = true;
    nodes_[idx].fromTrailer = fromTrailer;
    nodes_[idx].lastRxMs    = nowMs;
    nodes_[idx].uptimeSec   = hb.uptimeSec;
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

void RuleEngine::updateWheelBaseline(WheelBaseline& b, float rms, bool allowLearn) {
    const float stdFloor = (cfg_.vehicleClass == VEHICLE_CROSSOVER) ? 0.14f : 0.30f;

    if (b.ready) {
        const float denom = std::max(b.stdRms, stdFloor);
        b.lastZScore = (rms - b.meanRms) / denom;
    } else {
        b.lastZScore = 0.0f;
    }

    if (!cfg_.autoBaselineEnabled || !allowLearn || rms < 0.08f) {
        return;
    }

    // Freeze baseline learning if current reading already deviates sharply from learned norm
    // so a progressive bearing failure never corrupts the healthy baseline!
    if (b.ready && b.lastZScore >= (cfg_.zScoreWarn * 0.75f)) {
        return;
    }

    if (b.samples < 600U) {
        ++b.samples;
        const float delta  = rms - b.meanRms;
        b.meanRms         += delta / static_cast<float>(b.samples);
        const float delta2 = rms - b.meanRms;
        b.m2Rms           += delta * delta2;
        if (b.samples >= 2U) {
            b.stdRms = std::sqrt(b.m2Rms / static_cast<float>(b.samples - 1U));
        }
    } else {
        // Ultra-slow tracking once mature (adapts gently to new tires without erasing faults)
        constexpr float kAlpha = 0.002f;
        const float diff = rms - b.meanRms;
        b.meanRms += kAlpha * diff;
        const float var = (1.0f - kAlpha) * (b.stdRms * b.stdRms) + kAlpha * (diff * diff);
        b.stdRms = std::sqrt(std::max(var, 0.0001f));
    }

    if (b.samples >= cfg_.baselineMinSamples) {
        b.ready = true;
        const float denom = std::max(b.stdRms, stdFloor);
        b.lastZScore = (rms - b.meanRms) / denom;
    }
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

    const float fleetFloor   = (cfg_.vehicleClass == VEHICLE_CROSSOVER) ? 0.30f : 0.80f;
    const float fleetMeanVib = (onlineCount > 0U)
                                   ? std::max(fleetFloor, vibSum / static_cast<float>(onlineCount))
                                   : 1.0f;

    // Rough cobblestone detection:
    // - Multi-axle: >= 2 axles share elevated vibration simultaneously
    // - Single-axle MVP (e.g., Hyundai Santa Fe front L/R): both wheels vibrate symmetrically high
    uint8_t roughAxleCount = 0;
    const float roughThresh = (cfg_.vehicleClass == VEHICLE_CROSSOVER)
                                  ? std::min(cfg_.vibWarnRmsMmS, 2.4f)
                                  : cfg_.vibWarnRmsMmS;
    for (uint8_t i = 0; i < kMaxTrackedNodes; ++i) {
        if (!nodes_[i].used || !nodes_[i].online) continue;
        const can2::AxleTelemetry& t = nodes_[i].telemetry;
        const float meanV = 0.5f * (t.vibRmsLeft + t.vibRmsRight);
        const float minV  = std::max(fleetFloor, std::min(t.vibRmsLeft, t.vibRmsRight));
        const float maxV  = std::max(t.vibRmsLeft, t.vibRmsRight);
        if (meanV >= roughThresh) {
            ++roughAxleCount;
        }
        if (onlineCount == 1U &&
            t.vibRmsLeft >= roughThresh &&
            t.vibRmsRight >= roughThresh &&
            (maxV / minV) < 1.35f) {
            roughAxleCount = 2U;
        }
    }
    const bool roughRoadAllWheels = (roughAxleCount >= 2U);

    // 2. Evaluate each online axle node
    AlertSeverity highestDriverSev = SEV_GREEN;
    char highestWheelCode[8] = "OK";

    for (uint8_t i = 0; i < kMaxTrackedNodes; ++i) {
        TrackedAxleNode& n = nodes_[i];
        if (!n.used || !n.online) continue;

        const can2::AxleTelemetry& t = n.telemetry;
        const float maxTemp   = std::max(t.tempLeftC, t.tempRightC);
        const float tempDelta = std::fabs(t.tempLeftC - t.tempRightC);

        // Identify hot/stressed side cleanly (thermal delta >= 3°C wins; otherwise vibration/kurtosis)
        if (tempDelta >= 3.0f) {
            n.rightIsHotSide = (t.tempRightC > t.tempLeftC);
        } else {
            const float scoreL = t.vibRmsLeft + ((t.kurtosisLeft >= cfg_.kurtosisWarn) ? 1.5f : 0.0f);
            const float scoreR = t.vibRmsRight + ((t.kurtosisRight >= cfg_.kurtosisWarn) ? 1.5f : 0.0f);
            n.rightIsHotSide = (scoreR > scoreL);
        }

        const float minSideFloor = (cfg_.vehicleClass == VEHICLE_CROSSOVER) ? 0.25f : 0.60f;
        const float minSideVib   = std::max(minSideFloor, std::min(t.vibRmsLeft, t.vibRmsRight));
        const float maxSideVib   = std::max(t.vibRmsLeft, t.vibRmsRight);
        const float sideRatio    = maxSideVib / minSideVib;
        const float peerRatio    = maxSideVib / fleetMeanVib;

        const float hotCrest     = n.rightIsHotSide ? t.crestRight : t.crestLeft;
        const float hotKurtosis  = n.rightIsHotSide ? t.kurtosisRight : t.kurtosisLeft;
        const float hotHfEnergy  = n.rightIsHotSide ? t.hfEnergyRight : t.hfEnergyLeft;

        // Pothole transient shock guard (high crest without sustained thermal build-up or HF bearing resonance)
        const bool transientPothole =
            (hotCrest >= 4.2f) && (tempDelta < 10.0f) && (hotHfEnergy < cfg_.hfEnergyWarn);

        // Update per-wheel Auto-Baseline on calm, non-pothole, non-overheating frames
        const bool calmFrame = !transientPothole && !roughRoadAllWheels && (tempDelta < 12.0f);
        updateWheelBaseline(n.baseLeft, t.vibRmsLeft, calmFrame && (sideRatio < 1.55f));
        updateWheelBaseline(n.baseRight, t.vibRmsRight, calmFrame && (sideRatio < 1.55f));

        const WheelBaseline& hotBase = n.rightIsHotSide ? n.baseRight : n.baseLeft;
        const float hotZScore = hotBase.ready ? hotBase.lastZScore : 0.0f;

        // Domain-invariant bearing/spall impulse condition (scale-free: works on Santa Fe AND 40t trucks!)
        const bool mlBearingImpulse =
            !transientPothole &&
            !roughRoadAllWheels &&
            (hotKurtosis >= cfg_.kurtosisWarn) &&
            (hotHfEnergy >= cfg_.hfEnergyWarn) &&
            (sideRatio >= 1.45f || hotZScore >= 2.5f);

        // Domain-invariant Auto-Baseline Z-score condition (detects quiet crossover faults below truck mm/s!)
        const bool baselineDriftWarn =
            cfg_.autoBaselineEnabled &&
            hotBase.ready &&
            !transientPothole &&
            !roughRoadAllWheels &&
            (hotZScore >= cfg_.zScoreWarn) &&
            (sideRatio >= 1.50f || hotHfEnergy >= cfg_.hfEnergyWarn || hotKurtosis >= 4.5f);

        const bool baselineDriftCrit =
            cfg_.autoBaselineEnabled &&
            hotBase.ready &&
            !transientPothole &&
            !roughRoadAllWheels &&
            (hotZScore >= cfg_.zScoreCrit) &&
            (sideRatio >= cfg_.vibDeltaRatioWarn) &&
            (hotKurtosis >= cfg_.kurtosisWarn || hotHfEnergy >= cfg_.hfEnergyWarn);

        // Hard critical RED condition
        const bool redCond =
            (maxTemp >= cfg_.tempCritC) ||
            (tempDelta >= cfg_.axleTempDeltaCritC) ||
            baselineDriftCrit ||
            (!transientPothole && !roughRoadAllWheels &&
             maxSideVib >= cfg_.vibCritRmsMmS && peerRatio >= cfg_.vibDeltaRatioWarn);

        // Warning YELLOW condition (sustained > 60 s ignores potholes!)
        const bool yellowCond =
            redCond ||
            (maxTemp >= cfg_.tempWarnC) ||
            (tempDelta >= cfg_.axleTempDeltaWarnC) ||
            mlBearingImpulse ||
            baselineDriftWarn ||
            (!transientPothole && !roughRoadAllWheels &&
             sideRatio >= cfg_.vibDeltaRatioWarn && maxSideVib >= cfg_.vibWarnRmsMmS);

        // Shadow Mode condition (early subtle anomaly: logs to Cloud Black Box silently)
        const bool shadowCond =
            cfg_.shadowModeEnabled &&
            !yellowCond &&
            !transientPothole &&
            !roughRoadAllWheels &&
            (sideRatio >= cfg_.shadowVibRatio ||
             tempDelta >= (cfg_.axleTempDeltaWarnC * 0.65f) ||
             (hotBase.ready && hotZScore >= 2.5f && hotHfEnergy >= 0.45f));

        if (redCond) {
            n.redAccumMs = std::min<uint32_t>(n.redAccumMs + dtMs, cfg_.redConfirmMs + 5000U);
        } else {
            const uint32_t dec = dtMs * 2U;
            n.redAccumMs = (n.redAccumMs > dec) ? (n.redAccumMs - dec) : 0U;
            if (n.redAccumMs == 0U) n.redLatched = false;
        }

        if (yellowCond) {
            n.yellowAccumMs = std::min<uint32_t>(n.yellowAccumMs + dtMs, cfg_.yellowConfirmMs + 5000U);
        } else if (transientPothole) {
            const uint32_t slowDec = dtMs / 2U;
            n.yellowAccumMs = (n.yellowAccumMs > slowDec) ? (n.yellowAccumMs - slowDec) : 0U;
        } else {
            const uint32_t dec = dtMs * 2U;
            n.yellowAccumMs = (n.yellowAccumMs > dec) ? (n.yellowAccumMs - dec) : 0U;
            if (n.yellowAccumMs == 0U) n.yellowLatched = false;
        }

        const char* reason = "NORMAL";
        if (maxTemp >= cfg_.tempCritC || tempDelta >= cfg_.axleTempDeltaCritC) {
            reason = "TEMP_CRITICAL_BRAKE";
        } else if (tempDelta >= cfg_.axleTempDeltaWarnC || maxTemp >= cfg_.tempWarnC) {
            reason = "TEMP_DELTA_HIGH";
        } else if (mlBearingImpulse) {
            reason = "ML_BEARING_IMPULSE";
        } else if (baselineDriftWarn || baselineDriftCrit) {
            reason = "BASELINE_ZSCORE_DRIFT";
        } else if (yellowCond) {
            reason = "VIB_SPIKE";
        } else if (roughRoadAllWheels) {
            reason = "COBBLESTONE_FILTERED";
        } else if (transientPothole) {
            reason = "POTHOLE_GUARD";
        }
        std::snprintf(n.lastReason, sizeof(n.lastReason), "%s", reason);

        // Edge-triggered Black Box uploads when entering RED, YELLOW, or SHADOW
        if (n.redAccumMs >= cfg_.redConfirmMs && !n.redLatched) {
            n.redLatched      = true;
            n.yellowLatched   = true;
            evt.triggered     = true;
            evt.severity      = SEV_RED;
            evt.triggerNodeId = t.nodeId;
            formatWheelCode(n.slot, n.rightIsHotSide, evt.wheelCode);
            std::snprintf(evt.reason, sizeof(evt.reason), "%s", reason);
        } else if (n.yellowAccumMs >= cfg_.yellowConfirmMs && !n.yellowLatched) {
            n.yellowLatched   = true;
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
