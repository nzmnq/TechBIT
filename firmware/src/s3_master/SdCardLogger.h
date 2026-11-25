#pragma once

#include <cstdint>
#include "RuleEngine.h"

class SPIClass;

namespace techbit {

// Dedicated HSPI (SPI3) microSD card logger for continuous CSV telemetry
// (/techbit/telemetry.csv) and immediate JSON anomaly bursts
// (/techbit/events/evt_<seq>_<wheel>.json).
class SdCardLogger {
public:
    SdCardLogger();
    ~SdCardLogger();

    bool begin();
    bool remount();

    void logTelemetrySnapshot(const char* utcIso,
                              uint32_t uptimeMs,
                              const rules::CabinIndicatorState& ind,
                              const rules::TrackedAxleNode* nodes,
                              uint8_t maxNodes);

    bool saveAnomalyBurst(uint32_t seq,
                          const char* wheelCode,
                          const char* severity,
                          const char* jsonPayload);

    void refreshUsageStats();

    bool     isMounted() const { return mounted_; }
    uint32_t totalMb() const { return totalMb_; }
    uint32_t usedMb() const { return usedMb_; }
    uint32_t loggedRows() const { return loggedRows_; }
    uint32_t savedEvents() const { return savedEvents_; }

private:
    bool mountInternal();
    bool ensureDirectories();

    SPIClass* spi_;
    bool      spiStarted_;
    bool      mounted_;
    uint32_t  totalMb_;
    uint32_t  usedMb_;
    uint32_t  loggedRows_;
    uint32_t  savedEvents_;
};

} // namespace techbit
