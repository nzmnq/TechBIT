#pragma once

#include <cstdint>
#include "RuleEngine.h"

namespace techbit {

// Installer-Only Web Bluetooth Service Mode (Software Spec Section 3.3 #5).
// Strictly OFF during normal driving so ESP-NOW runs cleanly and driver has NO BLE access.
// Enabled by holding/pressing the enclosure Service Button; auto-disables after 15 minutes.
class InstallerBleService {
public:
    InstallerBleService();

    void enableFor15Min(uint32_t nowMs, rules::RuleEngine* engine);
    void disable();
    void service(uint32_t nowMs);

    bool     isActive() const { return active_; }
    uint32_t remainingSec(uint32_t nowMs) const;

    bool     consumePendingConfigSave() {
        bool v = pendingNvsSave_;
        pendingNvsSave_ = false;
        return v;
    }
    bool consumeLedTestRequest() {
        bool v = ledTestRequested_;
        ledTestRequested_ = false;
        return v;
    }

private:
    bool               active_;
    uint32_t           expiresAtMs_;
    uint32_t           lastRefreshMs_;
    rules::RuleEngine* engine_;
    bool               pendingNvsSave_;
    bool               ledTestRequested_;
};

} // namespace techbit
