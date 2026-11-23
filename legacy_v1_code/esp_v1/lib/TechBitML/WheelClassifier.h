#pragma once

#include <cstdint>
#include "can_protocol.h"
#include "ml_model_weights.h"
#include "techbit_config.h"

namespace techbit {
namespace ml {

enum RoadClass : uint8_t {
    CLASS_NORMAL         = 0,
    CLASS_BAD_ROAD       = 1,
    CLASS_POTHOLE_IMPACT = 2,
    CLASS_ANOMALY_FAULT  = 3
};

inline const char* roadClassName(uint8_t cls) {
    switch (cls) {
        case CLASS_NORMAL:         return "NORMAL";
        case CLASS_BAD_ROAD:       return "BAD_ROAD";
        case CLASS_POTHOLE_IMPACT: return "POTHOLE";
        case CLASS_ANOMALY_FAULT:  return "ANOMALY";
        default:                   return "UNKNOWN";
    }
}

enum SystemAlertLevel : uint8_t {
    ALERT_OK          = 0, // All active wheels healthy (or normal bad-road filtering)
    ALERT_BAD_ROAD    = 1, // Rough road / cobblestone / axle bump filtered safely
    ALERT_WARNING     = 2, // Sustained anomaly accumulating (1.8s .. 3.0s)
    ALERT_SERVICE_TO  = 3  // Confirmed fault > 3.0s -> Driver warning: Visit service (TO)!
};

enum VehicleRoadState : uint8_t {
    ROAD_STANDSTILL    = 0, // Vehicle parked / stopped at traffic light
    ROAD_SMOOTH        = 1, // Smooth asphalt driving
    ROAD_COBBLESTONE   = 2, // Rough road / cobblestones / rumble strips (suppressed)
    ROAD_FAULT_WARNING = 3, // Pre-confirmation local fault accumulating
    ROAD_SERVICE_TO    = 4  // Confirmed wheel fault (> 3s)
};

inline const char* roadStateName(VehicleRoadState st) {
    switch (st) {
        case ROAD_STANDSTILL:    return "STANDSTILL";
        case ROAD_SMOOTH:        return "SMOOTH";
        case ROAD_COBBLESTONE:   return "COBBLESTONE";
        case ROAD_FAULT_WARNING: return "WARNING";
        case ROAD_SERVICE_TO:    return "SERVICE_TO";
        default:                 return "UNKNOWN";
    }
}

struct WheelState {
    bool     seenEver;
    bool     online;
    uint32_t lastRxMs;
    uint32_t lastSeqMs;
    uint32_t rxPacketCount;
    bool     hasCoreFrame;
    bool     hasSpectralFrame;

    can::WheelTelemetryPacket telemetry;

    // Calibration (Welford online baseline)
    float    baselineRmsMv;
    double   calMean;
    double   calM2;
    uint32_t calCount;

    // Extracted normalized ML input vector (10 features)
    float    features[kNumFeatures];
    float    probs[kNumClasses];
    uint8_t  predictedClass;

    // Cross-wheel metrics
    float    peerRatio;
    float    axleRatio;
    float    tempDeltaC;

    // Temporal persistence, pothole guard & fault state
    uint32_t anomalyAccumMs;
    bool     faultConfirmed;
    bool     thermalOverheat;
    bool     roadSuppressed;        // Axle/side symmetry or pothole cooldown suppressed false alarm
    bool     sensorDead;            // True if open piezo suspected while peers are moving
    uint32_t potholeCount;
    uint32_t lastPotholeMs;
    uint32_t potholeCooldownUntilMs;
    uint32_t lowSignalMs;
};

struct SystemSummary {
    uint8_t          activeWheelCount;
    uint8_t          offlineWheelMask;  // Wheels previously seen that timed out on CAN
    uint8_t          deadSensorMask;    // Online nodes whose piezo output stuck near zero while driving
    SystemAlertLevel alertLevel;
    VehicleRoadState roadState;
    bool             calibrating;
    uint8_t          calProgressPct;
    uint8_t          faultWheelMask;    // Bitmask of wheels in confirmed fault state
    bool             badRoadActive;
    bool             standstill;
    bool             buzzerMuted;
};

// Multi-wheel telemetry fusion + TinyML MLP Neural Network + Anti-Pothole / Cobblestone / 3s FSM.
// 100% pure C++17 (no Arduino/IDF dependencies) so it executes identically on ESP32-S3 and native tests.
class WheelClassifier {
public:
    WheelClassifier();

    void init();

    // Optional startup blanking window after ACC power-on (avoids Vref charging & cranking noise)
    void setStartupBlanking(uint32_t untilMs);

    // Driver anti-fatigue buzzer mute (leaves fault LED ON until reset)
    void setBuzzerMuted(bool muted);
    void toggleBuzzerMute();

    // Load/read persistent baseline per wheel (e.g. from ESP32 NVS Flash)
    void  setWheelBaseline(uint8_t wheelId, float baselineRmsMv);
    float getWheelBaseline(uint8_t wheelId) const;

    // Ingest CAN frames as they arrive
    void onCoreFrame(uint8_t wheelId, const uint8_t data[8], uint32_t nowMs);
    void onSpectralFrame(uint8_t wheelId, const uint8_t data[8], uint32_t nowMs);

    // Direct packet injection (handy for bench testing / unit tests)
    void onTelemetryPacket(const can::WheelTelemetryPacket& pkt, uint32_t nowMs);

    // Run cross-wheel normalization, MLP inference, and 3s hysteresis FSM.
    // Returns true if calibration just completed (so caller can save baselines to NVS).
    bool update(uint32_t nowMs, bool* calibrationFinishedOut = nullptr);

    void startCalibration(uint32_t nowMs, uint32_t durationMs = kCalibrationDurationMs);
    void resetFaultLatches();

    const WheelState&    wheelState(uint8_t wheelId) const { return wheels_[wheelId & 0x03]; }
    const SystemSummary& summary() const { return summary_; }

    // Pure neural network forward pass exposed for diagnostics & unit testing
    static uint8_t runMlpInference(const float rawFeatures[kNumFeatures],
                                   float outProbs[kNumClasses]);

private:
    void  evaluateWheel(uint8_t id, uint32_t nowMs, uint32_t dtMs,
                        float peerMedianRms, float peerMedianTemp, bool hasPeerTemp,
                        uint8_t activeCount, uint8_t otherRoughCount,
                        bool allStandstill, float maxPeerRms);
    float computeMedian(float* values, uint8_t count) const;

    WheelState    wheels_[WHEEL_COUNT];
    SystemSummary summary_;
    uint32_t      lastUpdateMs_;
    uint32_t      startupBlankingUntilMs_;
    bool          calibrating_;
    uint32_t      calStartMs_;
    uint32_t      calDurationMs_;
    bool          buzzerMuted_;
    uint8_t       prevFaultMask_;
};

} // namespace ml
} // namespace techbit
