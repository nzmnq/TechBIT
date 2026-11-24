#pragma once

#include <cstddef>
#include <cstdint>
#include "can_protocol_v2.h"
#include "techbit_config.h"

namespace techbit {
namespace rules {

#pragma pack(push, 1)
struct BlackBoxRecord {
    uint32_t epochSec;
    uint32_t nodeId;
    int16_t  tempLeftX10;
    int16_t  tempRightX10;
    uint16_t vibRmsLeftX100;
    uint16_t vibRmsRightX100;
    uint16_t vibPeakLeftX10;
    uint16_t vibPeakRightX10;
    uint8_t  flags;
};
#pragma pack(pop)

// Circular "Black Box" buffer keeping recent 3-5 minutes of multi-node raw summaries
// and exporting exact JSON packets compliant with Software Spec Section 4.2.
class BlackBoxBuffer {
public:
    BlackBoxBuffer();

    void reset();
    void pushSample(uint32_t utcEpochSec, const can2::AxleTelemetry& t);

    uint16_t size() const { return count_; }

    // Format ISO-8601 UTC timestamp e.g. "2026-11-23T17:45:00Z"
    static void formatIsoUtc(uint32_t epochSec, char out[24]);

    // Generate deterministic/seeded UUID v4-like string e.g. "550e8400-e29b-41d4-a716-..."
    static void makeEventUuid(uint32_t epochSec, uint32_t nodeId, uint32_t seq, char out[40]);

    // Serializes ANOMALY_BURST JSON contract (Software Spec 4.2) into caller buffer.
    // Returns bytes written (excluding NUL).
    size_t buildAnomalyBurstJson(char* outBuf, size_t outCap,
                                 const char* deviceId,
                                 const char* tractorId,
                                 const char* trailerId,
                                 const char* timestampUtc,
                                 const char* eventId,
                                 const char* severityStr,
                                 uint32_t triggerNodeId,
                                 const char* triggerReason,
                                 const can2::AxleTelemetry* summaryNodes,
                                 uint8_t summaryCount,
                                 uint16_t maxBurstRecords = 32) const;

    // Lightweight periodic heartbeat JSON (every 1-5 min to save LTE SIM data)
    size_t buildHeartbeatJson(char* outBuf, size_t outCap,
                              const char* deviceId,
                              const char* tractorId,
                              const char* trailerId,
                              const char* timestampUtc,
                              const can2::AxleTelemetry* summaryNodes,
                              uint8_t summaryCount,
                              uint32_t configVersion) const;

private:
    static size_t base64Encode(const uint8_t* src, size_t len, char* dst, size_t dstCap);

    BlackBoxRecord ring_[kBlackBoxRingCapacity];
    uint16_t       head_;
    uint16_t       count_;
};

} // namespace rules
} // namespace techbit
