#pragma once

#include <cstdint>

namespace techbit {

// LTE Cat-1 / Cat-M1 Modem AT Interface (SIMCom / Quectel) + LittleFS Persistent Offline Queue
// Ensures zero lost ANOMALY_BURST black-box events when a truck leaves mobile coverage.
class LteOfflineQueue {
public:
    LteOfflineQueue();

    bool begin(int rxPin, int txPin, int pwrKeyPin, const char* ingestUrl);
    void enqueuePayload(const char* jsonPayload);
    void service(uint32_t nowMs);

    uint32_t currentUtcEpoch(uint32_t nowMs) const;
    bool     isModemOnline() const { return modemOnline_; }
    uint16_t pendingCount() const { return pendingCount_; }

private:
    bool sendAtCommand(const char* cmd, const char* expectedOk, uint32_t timeoutMs = 800);
    bool postHttpJson(const char* json);
    void refreshUtcFromModem(uint32_t nowMs);
    void countPendingFiles();

    bool     fsReady_;
    bool     modemOnline_;
    uint32_t baseUtcEpoch_;
    uint32_t baseMillis_;
    uint32_t lastCheckMs_;
    uint32_t lastFlushMs_;
    uint16_t pendingCount_;
    uint32_t fileSeq_;
    char     ingestUrl_[128];
};

} // namespace techbit
