#pragma once

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include "techbit_config.h"

namespace techbit {
namespace rules {

// Cloud-configurable threshold set (loaded from NVS or updated via JSON over LTE).
struct RuleConfig {
    float    tempWarnC           = kDefaultTempWarnC;
    float    tempCritC           = kDefaultTempCritC;
    float    axleTempDeltaWarnC  = kDefaultAxleTempDeltaWarnC;  // 15..20°C L vs R
    float    axleTempDeltaCritC  = kDefaultAxleTempDeltaCritC;
    float    vibWarnRmsMmS       = kDefaultVibWarnRmsMmS;
    float    vibCritRmsMmS       = kDefaultVibCritRmsMmS;
    float    vibDeltaRatioWarn   = kDefaultVibDeltaRatioWarn;
    float    shadowVibRatio      = kDefaultShadowVibRatio;
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

} // namespace detail

// Updates only present fields from a compact cloud JSON config payload (zero heap allocation).
inline bool applyJsonConfigUpdate(const char* json, RuleConfig& cfg) {
    if (!json) return false;
    bool changed = false;

    float fVal = 0.0f;
    uint32_t uVal = 0;
    bool bVal = false;

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
    if (detail::extractFloatField(json, "\"vib_warn_rms\"", fVal) && fVal >= 1.0f && fVal <= 20.0f) {
        cfg.vibWarnRmsMmS = fVal;
        changed = true;
    }
    if (detail::extractFloatField(json, "\"vib_warn_ratio\"", fVal) && fVal >= 1.3f && fVal <= 6.0f) {
        cfg.vibDeltaRatioWarn = fVal;
        changed = true;
    }
    if (detail::extractU32Field(json, "\"yellow_confirm_sec\"", uVal) && uVal >= 5U && uVal <= 300U) {
        cfg.yellowConfirmMs = uVal * 1000U;
        changed = true;
    }
    if (detail::extractBoolField(json, "\"shadow_mode_enabled\"", bVal)) {
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
