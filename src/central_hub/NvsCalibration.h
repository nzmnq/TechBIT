#pragma once

#include <Preferences.h>
#include <cstdio>
#include "WheelClassifier.h"
#include "techbit_config.h"

namespace techbit {

// Stores and restores calibrated per-wheel baseline RMS values in ESP32-C3 NVS Flash
// so vehicle calibration persists across ACC ignition OFF/ON cycles.
class NvsCalibration {
public:
    bool load(ml::WheelClassifier& classifier) {
        Preferences prefs;
        if (!prefs.begin("techbit_cal", true)) {
            return false;
        }

        bool anyLoaded = false;
        char key[12];
        for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
            std::snprintf(key, sizeof(key), "base_%u", i);
            float val = prefs.getFloat(key, -1.0f);
            if (val >= 5.0f && val <= 500.0f) {
                classifier.setWheelBaseline(i, val);
                anyLoaded = true;
            }
        }

        prefs.end();
        return anyLoaded;
    }

    bool save(const ml::WheelClassifier& classifier) {
        Preferences prefs;
        if (!prefs.begin("techbit_cal", false)) {
            return false;
        }

        char key[12];
        for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
            std::snprintf(key, sizeof(key), "base_%u", i);
            prefs.putFloat(key, classifier.getWheelBaseline(i));
        }

        prefs.end();
        return true;
    }
};

} // namespace techbit
