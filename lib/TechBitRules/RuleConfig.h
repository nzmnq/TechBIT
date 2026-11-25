#pragma once

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include "techbit_config.h"

namespace techbit {
namespace rules {

// Vehicle class adapts baseline noise floor & minimum vibration scale
// while keeping domain-invariant features (kurtosis, HF energy, Z-score, L/R ratio, ΔT) universal.
enum VehicleClass : uint8_t {
    VEHICLE_CROSSOVER = 0, // e.g., Hyundai Santa Fe MVP test vehicle (quieter suspension)
    VEHICLE_TRUCK     = 1  // 40-ton commercial tractor + trailer (higher road noise floor)
};

// Cloud-configurable threshold set (loaded from NVS or updated via JSON over LTE/USB).
struct RuleConfig {
    VehicleClass vehicleClass    = VEHICLE_CROSSOVER;
    float    tempWarnC           = kDefaultTempWarnC;
    float    tempCritC           = kDefaultTempCritC;
    float    axleTempDeltaWarnC  = kDefaultAxleTempDeltaWarnC;  // 15..20°C L vs R
    float    axleTempDeltaCritC  = kDefaultAxleTempDeltaCritC;
    float    vibWarnRmsMmS       = kDefaultVibWarnRmsMmS;
    float    vibCritRmsMmS       = kDefaultVibCritRmsMmS;
    float    vibDeltaRatioWarn   = kDefaultVibDeltaRatioWarn;
    float    shadowVibRatio      = kDefaultShadowVibRatio;
    float    kurtosisWarn        = 5.5f;  // Impulsive bearing spall threshold (~3.0 normal)
    float    hfEnergyWarn        = 0.56f; // High-frequency 600..4500 Hz energy fraction
    float    zScoreWarn          = 3.5f;  // Auto-Baseline deviation (sigma above own wheel norm)
    float    zScoreCrit          = 6.0f;
    uint32_t baselineMinSamples  = 25U;   // Quiet moving frames before Auto-Baseline activates
    bool     autoBaselineEnabled = true;
    uint32_t yellowConfirmMs     = kDefaultYellowConfirmMs;     // > 60 s ignores potholes
    uint32_t redConfirmMs        = kDefaultRedConfirmMs;
    bool     shadowModeEnabled   = true;
    uint32_t configVersion       = 1;
};

namespace detail {

inline bool extractFloatField(const char* json, const char* key, float& outVal) {
    if (!json || !key) return false;
    const char* p = std::strstr(json, key);
    if (!p) return false;
    p = std::strchr(p + std::strlen(key), ':');
    if (!p) return false;
    ++p;
    while (*p == ' ' || *p == '\t') ++p;
    char* endPtr = nullptr;
    float val = std::strtof(p, &endPtr);
    if (endPtr == p) return false;
    outVal = val;
    return true;
}

inline bool extractU32Field(const char* json, const char* key, uint32_t& outVal) {
    float f = 0.0f;
    if (!extractFloatField(json, key, f) || f < 0.0f) return false;
    outVal = static_cast<uint32_t>(f + 0.5f);
    return true;
}

inline bool extractBoolField(const char* json, const char* key, bool& outVal) {
    if (!json || !key) return false;
    const char* p = std::strstr(json, key);
    if (!p) return false;
    p = std::strchr(p + std::strlen(key), ':');
    if (!p) return false;
    ++p;
    while (*p == ' ' || *p == '\t') ++p;
    if (std::strncmp(p, "true", 4) == 0) {
        outVal = true;
        return true;
    }
    if (std::strncmp(p, "false", 5) == 0) {
        outVal = false;
        return true;
    }
    return false;
}

inline bool extractStringMatch(const char* json, const char* key, const char* expected) {
    if (!json || !key || !expected) return false;
    const char* p = std::strstr(json, key);
    if (!p) return false;
    p = std::strchr(p + std::strlen(key), ':');
    if (!p) return false;
    ++p;
    while (*p == ' ' || *p == '\t' || *p == '"') ++p;
    return std::strncmp(p, expected, std::strlen(expected)) == 0;
}

} // namespace detail

// Updates only present fields from a compact cloud/USB JSON config payload (zero heap allocation).
inline bool applyJsonConfigUpdate(const char* json, RuleConfig& cfg) {
    if (!json) return false;
    bool changed = false;

    float fVal = 0.0f;
    uint32_t uVal = 0;
    bool bVal = false;

    if (detail::extractStringMatch(json, "\"vehicle_class\"", "crossover")) {
        cfg.vehicleClass = VEHICLE_CROSSOVER;
        changed = true;
    } else if (detail::extractStringMatch(json, "\"vehicle_class\"", "truck")) {
        cfg.vehicleClass = VEHICLE_TRUCK;
        changed = true;
    }
    if (detail::extractFloatField(json, "\"temp_warn_c\"", fVal) && fVal >= 40.0f && fVal <= 140.0f) {
        cfg.tempWarnC = fVal;
        changed = true;
    }
    if (detail::extractFloatField(json, "\"temp_crit_c\"", fVal) && fVal >= 60.0f && fVal <= 160.0f) {
        cfg.tempCritC = fVal;
        changed = true;
    }
    if (detail::extractFloatField(json, "\"axle_temp_delta_warn_c\"", fVal) && fVal >= 8.0f && fVal <= 60.0f) {
        cfg.axleTempDeltaWarnC = fVal;
        changed = true;
    }
    if (detail::extractFloatField(json, "\"axle_temp_delta_crit_c\"", fVal) && fVal >= 15.0f && fVal <= 80.0f) {
        cfg.axleTempDeltaCritC = fVal;
        changed = true;
    }
    if (detail::extractFloatField(json, "\"vib_warn_rms\"", fVal) && fVal >= 0.5f && fVal <= 20.0f) {
        cfg.vibWarnRmsMmS = fVal;
        changed = true;
    }
    if (detail::extractFloatField(json, "\"vib_warn_ratio\"", fVal) && fVal >= 1.3f && fVal <= 6.0f) {
        cfg.vibDeltaRatioWarn = fVal;
        changed = true;
    }
    if (detail::extractFloatField(json, "\"kurtosis_warn\"", fVal) && fVal >= 3.5f && fVal <= 15.0f) {
        cfg.kurtosisWarn = fVal;
        changed = true;
    }
    if (detail::extractFloatField(json, "\"hf_energy_warn\"", fVal) && fVal >= 0.3f && fVal <= 0.95f) {
        cfg.hfEnergyWarn = fVal;
        changed = true;
    }
    if (detail::extractFloatField(json, "\"z_score_warn\"", fVal) && fVal >= 2.0f && fVal <= 10.0f) {
        cfg.zScoreWarn = fVal;
        changed = true;
    }
    if (detail::extractBoolField(json, "\"auto_baseline_enabled\"", bVal)) {
        cfg.autoBaselineEnabled = bVal;
        changed = true;
    }
    if (detail::extractU32Field(json, "\"yellow_confirm_sec\"", uVal) && uVal >= 5U && uVal <= 300U) {
        cfg.yellowConfirmMs = uVal * 1000U;
        changed = true;
    }
    if (detail::extractBoolField(json, "\"shadow_mode_enabled\"", bVal) ||
        detail::extractBoolField(json, "\"shadow_mode\"", bVal)) {
        cfg.shadowModeEnabled = bVal;
        changed = true;
    }
    if (detail::extractU32Field(json, "\"config_version\"", uVal) && uVal > 0U) {
        cfg.configVersion = uVal;
        changed = true;
    } else if (changed) {
        ++cfg.configVersion;
    }

    return changed;
}

} // namespace rules
} // namespace techbit
