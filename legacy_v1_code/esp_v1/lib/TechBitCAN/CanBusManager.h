#pragma once

#include <cstdint>

namespace techbit {

struct CanFrame {
    uint32_t id;
    uint8_t  dlc;
    uint8_t  data[8];
};

// Hardware TWAI (CAN 2.0A @ 500 kbps) wrapper for ESP32-C3 and ESP32-S3
// wired to SN65HVD230 CAN transceivers. Includes automatic bus-off recovery.
class CanBusManager {
public:
    CanBusManager();

    bool begin(int txPin, int rxPin, bool noAckLoopback = false);
    void end();

    // Non-blocking send (returns true if queued into TWAI hardware FIFO)
    bool sendFrame(uint32_t stdId, const uint8_t data[8], uint8_t dlc = 8);

    // Non-blocking receive
    bool receiveFrame(CanFrame& outFrame);

    // Must be called periodically to recover automatically from CAN Bus-Off states
    void serviceRecovery();

    bool     isReady() const { return ready_; }
    uint32_t txCount() const { return txCount_; }
    uint32_t rxCount() const { return rxCount_; }
    uint32_t txErrors() const { return txErrorCount_; }
    uint32_t busOffRecoveries() const { return busOffRecoveries_; }

private:
    bool     ready_;
    bool     recovering_;
    uint32_t txCount_;
    uint32_t rxCount_;
    uint32_t txErrorCount_;
    uint32_t busOffRecoveries_;
};

} // namespace techbit
