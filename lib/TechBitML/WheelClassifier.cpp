#include "WheelClassifier.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace techbit {
namespace ml {

WheelClassifier::WheelClassifier()
    : lastUpdateMs_(0),
      startupBlankingUntilMs_(0),
      calibrating_(false),
      calStartMs_(0),
      calDurationMs_(kCalibrationDurationMs),
      buzzerMuted_(false),
      prevFaultMask_(0) {
    init();
}

void WheelClassifier::init() {
    std::memset(wheels_, 0, sizeof(wheels_));
    std::memset(&summary_, 0, sizeof(summary_));
    lastUpdateMs_           = 0;
    startupBlankingUntilMs_ = 0;
    calibrating_            = false;
    calStartMs_             = 0;
    calDurationMs_          = kCalibrationDurationMs;
    buzzerMuted_            = false;
    prevFaultMask_          = 0;

    for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
        wheels_[i].telemetry.wheelId   = i;
        wheels_[i].baselineRmsMv       = kDefaultBaselineRmsMv;
        wheels_[i].predictedClass      = CLASS_NORMAL;
        wheels_[i].probs[CLASS_NORMAL] = 1.0f;
        wheels_[i].peerRatio           = 1.0f;
        wheels_[i].axleRatio           = 1.0f;
    }
    summary_.roadState = ROAD_STANDSTILL;
}

void WheelClassifier::setStartupBlanking(uint32_t untilMs) {
    startupBlankingUntilMs_ = untilMs;
}

void WheelClassifier::setBuzzerMuted(bool muted) {
    buzzerMuted_         = muted;
    summary_.buzzerMuted = muted;
}

void WheelClassifier::toggleBuzzerMute() {
    setBuzzerMuted(!buzzerMuted_);
}

void WheelClassifier::setWheelBaseline(uint8_t wheelId, float baselineRmsMv) {
    if (wheelId >= WHEEL_COUNT) return;
    if (baselineRmsMv >= 5.0f && baselineRmsMv <= 500.0f) {
        wheels_[wheelId].baselineRmsMv = baselineRmsMv;
    }
}

float WheelClassifier::getWheelBaseline(uint8_t wheelId) const {
    if (wheelId >= WHEEL_COUNT) return kDefaultBaselineRmsMv;
    return wheels_[wheelId].baselineRmsMv;
}

void WheelClassifier::onCoreFrame(uint8_t wheelId, const uint8_t data[8], uint32_t nowMs) {
    if (wheelId >= WHEEL_COUNT) return;
    WheelState& w = wheels_[wheelId];
    can::unpackCoreFrame(data, w.telemetry);
    w.telemetry.wheelId = wheelId;
    w.hasCoreFrame = true;
    w.seenEver     = true;
    w.online       = true;
    w.lastRxMs     = nowMs;
    ++w.rxPacketCount;
}

void WheelClassifier::onSpectralFrame(uint8_t wheelId, const uint8_t data[8], uint32_t nowMs) {
    if (wheelId >= WHEEL_COUNT) return;
    WheelState& w = wheels_[wheelId];
    can::unpackSpectralFrame(data, w.telemetry);
    w.telemetry.wheelId = wheelId;
    w.hasSpectralFrame = true;
    w.seenEver         = true;
    w.online           = true;
    w.lastRxMs         = nowMs;
}

void WheelClassifier::onTelemetryPacket(const can::WheelTelemetryPacket& pkt, uint32_t nowMs) {
    if (pkt.wheelId >= WHEEL_COUNT) return;
    WheelState& w = wheels_[pkt.wheelId];
    w.telemetry        = pkt;
    w.hasCoreFrame     = true;
    w.hasSpectralFrame = true;
    w.seenEver         = true;
    w.online           = true;
    w.lastRxMs         = nowMs;
    ++w.rxPacketCount;
}

void WheelClassifier::startCalibration(uint32_t nowMs, uint32_t durationMs) {
    calibrating_   = true;
    calStartMs_    = nowMs;
    calDurationMs_ = (durationMs > 500) ? durationMs : 500;
    for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
        wheels_[i].calMean  = 0.0;
        wheels_[i].calM2    = 0.0;
        wheels_[i].calCount = 0;
    }
}

void WheelClassifier::resetFaultLatches() {
    for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
        wheels_[i].anomalyAccumMs         = 0;
        wheels_[i].faultConfirmed         = false;
        wheels_[i].thermalOverheat        = false;
        wheels_[i].roadSuppressed         = false;
        wheels_[i].sensorDead             = false;
        wheels_[i].lowSignalMs            = 0;
        wheels_[i].potholeCooldownUntilMs = 0;
        wheels_[i].potholeCount           = 0;
    }
    buzzerMuted_   = false;
    prevFaultMask_ = 0;
}

float WheelClassifier::computeMedian(float* values, uint8_t count) const {
    if (count == 0) return kDefaultBaselineRmsMv;
    std::sort(values, values + count);
    if (count & 1U) {
        return values[count / 2];
    }
    return 0.5f * (values[count / 2 - 1] + values[count / 2]);
}

uint8_t WheelClassifier::runMlpInference(const float rawFeatures[kNumFeatures],
                                         float outProbs[kNumClasses]) {
    float x[kNumFeatures];
    for (int i = 0; i < kNumFeatures; ++i) {
        x[i] = (rawFeatures[i] - kScalerMean[i]) / kScalerStd[i];
    }

    // Hidden Layer 1: 10 -> 16 (ReLU)
    float h1[kHidden1];
    for (int j = 0; j < kHidden1; ++j) {
        float acc = kB1[j];
        for (int i = 0; i < kNumFeatures; ++i) {
            acc += x[i] * kW1[i][j];
        }
        h1[j] = (acc > 0.0f) ? acc : 0.0f;
    }

    // Hidden Layer 2: 16 -> 12 (ReLU)
    float h2[kHidden2];
    for (int j = 0; j < kHidden2; ++j) {
        float acc = kB2[j];
        for (int i = 0; i < kHidden1; ++i) {
            acc += h1[i] * kW2[i][j];
        }
        h2[j] = (acc > 0.0f) ? acc : 0.0f;
    }

    // Output Layer: 12 -> 4 (Numerically stable Softmax)
    float logits[kNumClasses];
    float maxLogit = -1e30f;
    for (int j = 0; j < kNumClasses; ++j) {
        float acc = kB3[j];
        for (int i = 0; i < kHidden2; ++i) {
            acc += h2[i] * kW3[i][j];
        }
        logits[j] = acc;
        if (acc > maxLogit) {
            maxLogit = acc;
        }
    }

    float sumExp = 0.0f;
    for (int j = 0; j < kNumClasses; ++j) {
        float e = std::exp(logits[j] - maxLogit);
        outProbs[j] = e;
        sumExp += e;
    }

    uint8_t bestClass = 0;
    float bestProb = -1.0f;
    const float invSum = (sumExp > 1e-9f) ? (1.0f / sumExp) : 0.25f;
    for (int j = 0; j < kNumClasses; ++j) {
        outProbs[j] *= invSum;
        if (outProbs[j] > bestProb) {
            bestProb  = outProbs[j];
            bestClass = static_cast<uint8_t>(j);
        }
    }

    return bestClass;
}

void WheelClassifier::evaluateWheel(uint8_t id, uint32_t nowMs, uint32_t dtMs,
                                    float peerMedianRms, float peerMedianTemp, bool hasPeerTemp,
                                    uint8_t activeCount, uint8_t otherRoughCount,
                                    bool allStandstill, float maxPeerRms) {
    WheelState& w = wheels_[id];
    const can::WheelTelemetryPacket& p = w.telemetry;
    w.roadSuppressed = false;

    // 0a. ACC power-on / starter cranking blanking guard
    if (startupBlankingUntilMs_ > 0U && nowMs < startupBlankingUntilMs_) {
        w.predictedClass = CLASS_NORMAL;
        w.anomalyAccumMs = 0;
        w.faultConfirmed = false;
        return;
    }

    // 0b. Dead / disconnected piezo sensor watchdog (while peers are actively rolling)
    if (activeCount >= 2U && maxPeerRms >= kDeadSensorPeerMinMv && p.rmsMv <= kDeadSensorRmsMv) {
        w.lowSignalMs = std::min<uint32_t>(w.lowSignalMs + dtMs, kDeadSensorTimeoutMs + 2000U);
        if (w.lowSignalMs >= kDeadSensorTimeoutMs) {
            w.sensorDead = true;
        }
    } else {
        const uint32_t dec = dtMs * 2U;
        w.lowSignalMs = (w.lowSignalMs > dec) ? (w.lowSignalMs - dec) : 0U;
        if (w.lowSignalMs == 0U) {
            w.sensorDead = false;
        }
    }

    // 1. Cross-wheel & opposite-axle ratios
    const float safePeer = std::max(peerMedianRms, kMinPeerMedianMv);
    w.peerRatio = p.rmsMv / safePeer;

    const uint8_t oppId = id ^ 0x01; // FL<->FR (0<->1), RL<->RR (2<->3)
    const bool oppOnline = (wheels_[oppId].online && wheels_[oppId].hasCoreFrame);
    if (oppOnline) {
        const float safeOpp = std::max(wheels_[oppId].telemetry.rmsMv, kMinPeerMedianMv);
        w.axleRatio = p.rmsMv / safeOpp;
    } else {
        w.axleRatio = w.peerRatio;
    }

    const uint8_t sideId = id ^ 0x02; // FL<->RL (0<->2), FR<->RR (1<->3)
    const bool sideOnline = (wheels_[sideId].online && wheels_[sideId].hasCoreFrame);
    float sideRatio = w.peerRatio;
    if (sideOnline) {
        const float safeSide = std::max(wheels_[sideId].telemetry.rmsMv, kMinPeerMedianMv);
        sideRatio = p.rmsMv / safeSide;
    }

    // 2. Baseline-normalized vibration intensity
    const float safeBase = std::max(w.baselineRmsMv, kMinPeerMedianMv);
    const float normRms  = p.rmsMv / safeBase;
    const float crest    = (p.rmsMv > 0.5f) ? (p.peakMv / p.rmsMv) : 1.0f;

    // 3. Build 10-element feature vector matching ml_trainer/train_classifier.py
    w.features[0] = std::log1p(std::max(0.0f, normRms));
    w.features[1] = std::min(w.peerRatio, 10.0f);
    w.features[2] = std::min(w.axleRatio, 10.0f);
    w.features[3] = std::min(std::max(crest, 1.0f), 12.0f);
    w.features[4] = std::min(std::max(p.kurtosis, 1.0f), 16.0f);
    w.features[5] = p.bandLowRatio;
    w.features[6] = p.bandMidRatio;
    w.features[7] = p.bandHighRatio;
    w.features[8] = static_cast<float>(p.spectralCentroidHz) / 5000.0f;
    w.features[9] = std::min(std::max(p.tonalityRatio, 1.0f), 16.0f);

    // 4. Optional thermal fusion
    w.thermalOverheat = false;
    w.tempDeltaC      = 0.0f;
    if (p.statusFlags & can::FLAG_TEMP_VALID) {
        if (hasPeerTemp) {
            w.tempDeltaC = p.tempC - peerMedianTemp;
        }
        if (p.tempC >= kTempOverheatAbsC ||
            (hasPeerTemp && w.tempDeltaC >= kTempDeltaOverPeerC && p.tempC >= 55.0f)) {
            w.thermalOverheat = true;
        }
    }

    // 5. Vehicle standstill (traffic light / parked): freeze fault accumulation so idle noise never false-triggers
    if (allStandstill) {
        w.predictedClass = CLASS_NORMAL;
        w.probs[CLASS_NORMAL]         = 1.0f;
        w.probs[CLASS_BAD_ROAD]       = 0.0f;
        w.probs[CLASS_POTHOLE_IMPACT] = 0.0f;
        w.probs[CLASS_ANOMALY_FAULT]  = 0.0f;

        if (!w.thermalOverheat && !w.faultConfirmed) {
            // Very slow decay so transient pre-stop noise fades without wiping a half-confirmed fault at a red light
            const uint32_t slowDecay = dtMs / 4U;
            w.anomalyAccumMs = (w.anomalyAccumMs > slowDecay) ? (w.anomalyAccumMs - slowDecay) : 0U;
        } else if (w.thermalOverheat) {
            w.anomalyAccumMs = std::min<uint32_t>(w.anomalyAccumMs + dtMs * 2U, kFaultConfirmDurationMs + 2000U);
            if (w.anomalyAccumMs >= kFaultConfirmDurationMs) {
                w.faultConfirmed = true;
            }
        }
        return;
    }

    // 6. TinyML MLP Neural Network forward pass
    w.predictedClass = runMlpInference(w.features, w.probs);

    // 7. Real-world Automotive Contextual Guards (Potholes, Axle Cobblestone Transitions, Rumble Strips)

    // 7a. BAT54S clamping spike / extreme transient shock -> guard against flat-top clipped pothole misread
    const bool extremeBrakeSqueal = (p.bandHighRatio > 0.65f && p.tonalityRatio > 7.0f);
    if ((p.statusFlags & can::FLAG_SURGE_CLIPPING) && !extremeBrakeSqueal &&
        (crest >= 3.3f || p.kurtosis >= 4.0f || p.bandLowRatio >= 0.30f)) {
        w.predictedClass = CLASS_POTHOLE_IMPACT;
    }

    if (w.predictedClass == CLASS_POTHOLE_IMPACT) {
        w.potholeCooldownUntilMs = std::max(w.potholeCooldownUntilMs, nowMs + kPotholeCooldownMs);
        // Cascade guard: if front wheel hit a pothole, rear wheel on same track will hit it ~100..750 ms later
        if (id == WHEEL_FL || id == WHEEL_FR) {
            const uint8_t rearId = id | 0x02;
            wheels_[rearId].potholeCooldownUntilMs =
                std::max(wheels_[rearId].potholeCooldownUntilMs, nowMs + kSideCascadeGuardMs);
        }
    }

    // 7b. Axle-Symmetric Road Transition (e.g., front axle enters cobblestones/rail crossing while rear is still on smooth asphalt)
    bool axleRoadSymmetry = false;
    if (oppOnline && !w.thermalOverheat) {
        const float oppBase = std::max(wheels_[oppId].baselineRmsMv, kMinPeerMedianMv);
        const bool bothElevated = (normRms >= 1.55f) && ((wheels_[oppId].telemetry.rmsMv / oppBase) >= 1.55f);
        const bool symOnAxle    = (w.axleRatio >= kAxleSymmetryMin && w.axleRatio <= kAxleSymmetryMax);
        const bool roadSpectrum = (p.bandLowRatio >= 0.35f && p.bandHighRatio < 0.45f);
        if (bothElevated && symOnAxle && roadSpectrum) {
            axleRoadSymmetry = true;
            w.predictedClass = CLASS_BAD_ROAD;
            w.roadSuppressed = true;
        }
    }

    // 7c. One-side Rumble Strip / Shoulder Guard (both FL+RL or FR+RR vibrating symmetrically in low band)
    bool sideTrackRoad = false;
    if (!axleRoadSymmetry && activeCount >= 3U && sideOnline && !w.thermalOverheat) {
        const float sideBase = std::max(wheels_[sideId].baselineRmsMv, kMinPeerMedianMv);
        const bool bothSideUp    = (normRms >= 1.55f) && ((wheels_[sideId].telemetry.rmsMv / sideBase) >= 1.55f);
        const bool symOnSide     = (sideRatio >= kAxleSymmetryMin && sideRatio <= kAxleSymmetryMax);
        const bool lowBandRumble = (p.bandLowRatio >= 0.40f && p.bandHighRatio < 0.35f && p.tonalityRatio < 5.2f);
        if (bothSideUp && symOnSide && lowBandRumble) {
            sideTrackRoad    = true;
            w.predictedClass = CLASS_BAD_ROAD;
            w.roadSuppressed = true;
        }
    }

    // 7d. 10-km Cobblestone Context Guard (elevate local fault threshold while entire road is rough)
    const bool inCobblestoneCtx =
        (otherRoughCount >= 2U) ||
        (activeCount == 2U && otherRoughCount >= 1U &&
         peerMedianRms >= kDefaultBaselineRmsMv * kBadRoadFloorRatio);

    bool cobblestoneUnevenSuppressed = false;
    if (inCobblestoneCtx && !w.thermalOverheat &&
        p.bandLowRatio >= 0.45f && p.bandHighRatio < 0.25f &&
        p.tonalityRatio < 4.5f && w.peerRatio < 2.30f) {
        cobblestoneUnevenSuppressed = true;
        w.predictedClass = CLASS_BAD_ROAD;
        w.roadSuppressed = true;
    }

    const bool inPotholeCooldown =
        (w.potholeCooldownUntilMs > nowMs) && !w.thermalOverheat && !extremeBrakeSqueal;
    if (inPotholeCooldown && w.predictedClass != CLASS_POTHOLE_IMPACT) {
        w.roadSuppressed = true;
    }

    // 8. Temporal Persistence & Anti-Pothole Hysteresis FSM (Section 5.2: > 3 seconds)
    const float reqPeerRatio = inCobblestoneCtx ? kFaultOnBadRoadPeerRatioMin : kFaultPeerRatioMin;
    const bool mlFault = (!axleRoadSymmetry && !sideTrackRoad && !cobblestoneUnevenSuppressed &&
                          !inPotholeCooldown &&
                          w.predictedClass == CLASS_ANOMALY_FAULT &&
                          w.probs[CLASS_ANOMALY_FAULT] >= kFaultProbThreshold &&
                          w.peerRatio >= reqPeerRatio);

    if (mlFault || w.thermalOverheat) {
        const uint32_t step = w.thermalOverheat ? (dtMs * 2U) : dtMs;
        w.anomalyAccumMs = std::min<uint32_t>(w.anomalyAccumMs + step,
                                              kFaultConfirmDurationMs + 2000U);
    } else if (w.predictedClass == CLASS_POTHOLE_IMPACT) {
        // Record transient shock without triggering false brake/bearing fault
        if (nowMs - w.lastPotholeMs > 400U) {
            ++w.potholeCount;
            w.lastPotholeMs = nowMs;
        }
        // Slow decay on pothole so a real ongoing fault isn't erased by hitting a bump
        const uint32_t decay = dtMs / 2U;
        w.anomalyAccumMs = (w.anomalyAccumMs > decay) ? (w.anomalyAccumMs - decay) : 0U;
    } else if (inPotholeCooldown) {
        // Freeze accumulation during post-pothole suspension ringing
        const uint32_t decay = dtMs / 4U;
        w.anomalyAccumMs = (w.anomalyAccumMs > decay) ? (w.anomalyAccumMs - decay) : 0U;
    } else {
        // Rapid decay during normal driving or uniform bad road / cobblestone
        const uint32_t decay = dtMs * 2U;
        w.anomalyAccumMs = (w.anomalyAccumMs > decay) ? (w.anomalyAccumMs - decay) : 0U;
    }

    if (w.anomalyAccumMs >= kFaultConfirmDurationMs) {
        w.faultConfirmed = true;
    } else if (w.anomalyAccumMs == 0U) {
        w.faultConfirmed = false;
    }
}

bool WheelClassifier::update(uint32_t nowMs, bool* calibrationFinishedOut) {
    if (calibrationFinishedOut) {
        *calibrationFinishedOut = false;
    }

    uint32_t dtMs = (lastUpdateMs_ == 0 || nowMs < lastUpdateMs_) ? 50U : (nowMs - lastUpdateMs_);
    if (dtMs > 500U) dtMs = 500U;
    lastUpdateMs_ = nowMs;

    // 1. Update node online/offline status and vehicle standstill check
    uint8_t activeCount   = 0;
    uint8_t offlineMask   = 0;
    bool    allStandstill = true;

    for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
        WheelState& w = wheels_[i];
        if (w.seenEver) {
            w.online = ((nowMs - w.lastRxMs) <= kNodeTimeoutMs);
            if (!w.online) {
                offlineMask |= static_cast<uint8_t>(1U << i);
            }
        } else {
            w.online = false;
        }

        if (w.online && w.hasCoreFrame) {
            ++activeCount;
            if (w.telemetry.rmsMv >= kStandstillRmsMv) {
                allStandstill = false;
            }
        }
    }

    if (activeCount == 0U) {
        allStandstill = true;
    }

    // 2. Welford online baseline calibration if active
    bool calCompletedNow = false;
    if (calibrating_) {
        const uint32_t elapsed = nowMs - calStartMs_;
        for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
            WheelState& w = wheels_[i];
            if (w.online && w.hasCoreFrame && (nowMs - w.lastRxMs) <= 200U) {
                const double x = static_cast<double>(w.telemetry.rmsMv);
                if (w.calCount < 5 || x < w.calMean * 3.5) {
                    ++w.calCount;
                    const double delta = x - w.calMean;
                    w.calMean += delta / static_cast<double>(w.calCount);
                    const double delta2 = x - w.calMean;
                    w.calM2 += delta * delta2;
                }
            }
        }

        if (elapsed >= calDurationMs_) {
            calibrating_     = false;
            calCompletedNow  = true;
            for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
                WheelState& w = wheels_[i];
                if (w.calCount >= 5) {
                    float calRms = static_cast<float>(w.calMean);
                    if (calRms < 8.0f)   calRms = 8.0f;
                    if (calRms > 150.0f) calRms = 150.0f;
                    w.baselineRmsMv = calRms;
                }
            }
            if (calibrationFinishedOut) {
                *calibrationFinishedOut = true;
            }
        }
        summary_.calProgressPct = static_cast<uint8_t>(
            std::min<uint32_t>(100U, (elapsed * 100U) / calDurationMs_));
    } else {
        summary_.calProgressPct = 100U;
    }

    // 3. Evaluate each online wheel against peer median & road context
    uint8_t badRoadVotes   = 0;
    uint8_t warnVotes      = 0;
    uint8_t faultMask      = 0;
    uint8_t deadSensorMask = 0;

    for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
        WheelState& w = wheels_[i];
        if (!w.online || !w.hasCoreFrame) continue;

        float   otherRms[WHEEL_COUNT];
        uint8_t otherRmsCount  = 0;
        float   otherTemp[WHEEL_COUNT];
        uint8_t otherTempCount = 0;
        uint8_t otherRoughCount = 0;
        float   maxPeerRms     = 0.0f;

        for (uint8_t j = 0; j < WHEEL_COUNT; ++j) {
            if (j == i) continue;
            if (wheels_[j].online && wheels_[j].hasCoreFrame) {
                const float r = wheels_[j].telemetry.rmsMv;
                otherRms[otherRmsCount++] = r;
                if (r > maxPeerRms) {
                    maxPeerRms = r;
                }
                const float jBase = std::max(wheels_[j].baselineRmsMv, kMinPeerMedianMv);
                if (r >= jBase * kBadRoadFloorRatio) {
                    ++otherRoughCount;
                }
                if (wheels_[j].telemetry.statusFlags & can::FLAG_TEMP_VALID) {
                    otherTemp[otherTempCount++] = wheels_[j].telemetry.tempC;
                }
            }
        }

        const float peerMedianRms = (otherRmsCount > 0)
                                        ? computeMedian(otherRms, otherRmsCount)
                                        : w.baselineRmsMv;
        const bool  hasPeerTemp   = (otherTempCount > 0);
        const float peerMedTemp   = hasPeerTemp
                                        ? computeMedian(otherTemp, otherTempCount)
                                        : 0.0f;

        evaluateWheel(i, nowMs, dtMs, peerMedianRms, peerMedTemp, hasPeerTemp,
                      activeCount, otherRoughCount, allStandstill, maxPeerRms);

        if (w.sensorDead) {
            deadSensorMask |= static_cast<uint8_t>(1U << i);
        }

        if (w.faultConfirmed) {
            faultMask |= static_cast<uint8_t>(1U << i);
        } else if (w.anomalyAccumMs >= kWarningDelayMs) {
            ++warnVotes;
        } else if (w.predictedClass == CLASS_BAD_ROAD) {
            ++badRoadVotes;
        }
    }

    // Auto-unmute buzzer if a NEW wheel develops a confirmed fault (or reset mute when clear)
    if ((faultMask & ~prevFaultMask_) != 0U || faultMask == 0U) {
        buzzerMuted_ = false;
    }
    prevFaultMask_ = faultMask;

    summary_.activeWheelCount = activeCount;
    summary_.offlineWheelMask = offlineMask;
    summary_.deadSensorMask   = deadSensorMask;
    summary_.calibrating      = calibrating_;
    summary_.faultWheelMask   = faultMask;
    summary_.standstill       = allStandstill;
    summary_.badRoadActive    = (badRoadVotes >= 2U || (activeCount == 1U && badRoadVotes == 1U));
    summary_.buzzerMuted      = buzzerMuted_;

    if (faultMask != 0U) {
        summary_.alertLevel = ALERT_SERVICE_TO;
        summary_.roadState  = ROAD_SERVICE_TO;
    } else if (warnVotes > 0U) {
        summary_.alertLevel = ALERT_WARNING;
        summary_.roadState  = ROAD_FAULT_WARNING;
    } else if (summary_.badRoadActive) {
        summary_.alertLevel = ALERT_BAD_ROAD;
        summary_.roadState  = ROAD_COBBLESTONE;
    } else if (allStandstill) {
        summary_.alertLevel = ALERT_OK;
        summary_.roadState  = ROAD_STANDSTILL;
    } else {
        summary_.alertLevel = ALERT_OK;
        summary_.roadState  = ROAD_SMOOTH;
    }

    return calCompletedNow;
}

} // namespace ml
} // namespace techbit
