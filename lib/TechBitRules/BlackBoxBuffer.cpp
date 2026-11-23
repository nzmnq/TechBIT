#include "BlackBoxBuffer.h"

#include <cstdio>
#include <cstring>

namespace techbit {
namespace rules {

namespace {
constexpr char kB64Alphabet[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
}

BlackBoxBuffer::BlackBoxBuffer() : head_(0), count_(0) {
    reset();
}

void BlackBoxBuffer::reset() {
    std::memset(ring_, 0, sizeof(ring_));
    head_  = 0;
    count_ = 0;
}

void BlackBoxBuffer::pushSample(uint32_t utcEpochSec, const can2::AxleTelemetry& t) {
    BlackBoxRecord rec{};
    rec.epochSec        = utcEpochSec;
    rec.nodeId          = t.nodeId;
    rec.tempLeftX10     = can2::clampI16(t.tempLeftC * 10.0f);
    rec.tempRightX10    = can2::clampI16(t.tempRightC * 10.0f);
    rec.vibRmsLeftX100  = can2::clampU16(t.vibRmsLeft * 100.0f);
    rec.vibRmsRightX100 = can2::clampU16(t.vibRmsRight * 100.0f);
    rec.vibPeakLeftX10  = can2::clampU16(t.vibPeakLeft * 10.0f);
    rec.vibPeakRightX10 = can2::clampU16(t.vibPeakRight * 10.0f);
    rec.flags           = t.statusFlags;

    ring_[head_] = rec;
    head_ = static_cast<uint16_t>((head_ + 1U) % kBlackBoxRingCapacity);
    if (count_ < kBlackBoxRingCapacity) {
        ++count_;
    }
}

void BlackBoxBuffer::formatIsoUtc(uint32_t epochSec, char out[24]) {
    // Civil-from-days algorithm (Howard Hinnant) — works identically on embedded and host without TZ issues
    const uint32_t secOfDay = epochSec % 86400UL;
    int64_t z = static_cast<int64_t>(epochSec / 86400UL) + 719468LL;
    int64_t era = (z >= 0 ? z : z - 146096LL) / 146097LL;
    uint32_t doe = static_cast<uint32_t>(z - era * 146097LL);
    uint32_t yoe = (doe - doe / 1460U + doe / 36524U - doe / 146096U) / 365U;
    int64_t y = static_cast<int64_t>(yoe) + era * 400LL;
    uint32_t doy = doe - (365U * yoe + yoe / 4U - yoe / 100U);
    uint32_t mp = (5U * doy + 2U) / 153U;
    uint32_t d = doy - (153U * mp + 2U) / 5U + 1U;
    uint32_t m = mp + (mp < 10U ? 3U : static_cast<uint32_t>(-9));
    y += (m <= 2U ? 1 : 0);

    const uint32_t hh = secOfDay / 3600U;
    const uint32_t mm = (secOfDay % 3600U) / 60U;
    const uint32_t ss = secOfDay % 60U;

    const unsigned yy = static_cast<unsigned>((y >= 0 && y <= 9999) ? y : 1970);
    const unsigned mo = static_cast<unsigned>(m % 100U);
    const unsigned dd = static_cast<unsigned>(d % 100U);
    const unsigned h  = static_cast<unsigned>(hh % 100U);
    const unsigned mi = static_cast<unsigned>(mm % 100U);
    const unsigned s  = static_cast<unsigned>(ss % 100U);

    std::snprintf(out, 24, "%04u-%02u-%02uT%02u:%02u:%02uZ",
                  yy, mo, dd, h, mi, s);
}

void BlackBoxBuffer::makeEventUuid(uint32_t epochSec, uint32_t nodeId, uint32_t seq, char out[40]) {
    uint32_t p1 = epochSec ^ (seq * 2654435761UL);
    uint16_t p2 = static_cast<uint16_t>((nodeId >> 8) ^ (seq & 0xFFFFU));
    uint16_t p3 = static_cast<uint16_t>(0x4000U | ((nodeId ^ seq) & 0x0FFFU));
    uint16_t p4 = static_cast<uint16_t>(0x8000U | ((epochSec ^ nodeId) & 0x3FFFU));
    uint32_t p5Hi = (nodeId << 8) ^ (epochSec & 0xFFFFU);
    uint16_t p5Lo = static_cast<uint16_t>(seq & 0xFFFFU);
    std::snprintf(out, 40, "%08lx-%04x-%04x-%04x-%08lx%04x",
                  static_cast<unsigned long>(p1),
                  static_cast<unsigned>(p2),
                  static_cast<unsigned>(p3),
                  static_cast<unsigned>(p4),
                  static_cast<unsigned long>(p5Hi),
                  static_cast<unsigned>(p5Lo));
}

size_t BlackBoxBuffer::base64Encode(const uint8_t* src, size_t len, char* dst, size_t dstCap) {
    size_t outIdx = 0;
    for (size_t i = 0; i < len; i += 3) {
        if (outIdx + 5 >= dstCap) break;
        const uint32_t a = src[i];
        const uint32_t b = (i + 1 < len) ? src[i + 1] : 0;
        const uint32_t c = (i + 2 < len) ? src[i + 2] : 0;
        const uint32_t triple = (a << 16) | (b << 8) | c;

        dst[outIdx++] = kB64Alphabet[(triple >> 18) & 0x3F];
        dst[outIdx++] = kB64Alphabet[(triple >> 12) & 0x3F];
        dst[outIdx++] = (i + 1 < len) ? kB64Alphabet[(triple >> 6) & 0x3F] : '=';
        dst[outIdx++] = (i + 2 < len) ? kB64Alphabet[triple & 0x3F] : '=';
    }
    if (dstCap > 0) {
        dst[outIdx < dstCap ? outIdx : dstCap - 1] = '\0';
    }
    return outIdx;
}

static void appendSummaryArray(char* buf, size_t cap, size_t& pos,
                               const can2::AxleTelemetry* nodes, uint8_t count) {
    pos += static_cast<size_t>(std::snprintf(buf + pos, (pos < cap ? cap - pos : 0), "["));
    for (uint8_t i = 0; i < count; ++i) {
        if (pos >= cap) break;
        char nid[12];
        can2::formatNodeIdString(nodes[i].nodeId, nid);
        const float maxTemp = (nodes[i].tempLeftC > nodes[i].tempRightC)
                                  ? nodes[i].tempLeftC
                                  : nodes[i].tempRightC;
        const float maxVib = (nodes[i].vibRmsLeft > nodes[i].vibRmsRight)
                                 ? nodes[i].vibRmsLeft
                                 : nodes[i].vibRmsRight;
        const float maxPeak = (nodes[i].vibPeakLeft > nodes[i].vibPeakRight)
                                  ? nodes[i].vibPeakLeft
                                  : nodes[i].vibPeakRight;
        pos += static_cast<size_t>(std::snprintf(
            buf + pos, (pos < cap ? cap - pos : 0),
            "%s{\"node_id\":\"%s\",\"temp_c\":%.1f,\"vib_rms\":%.2f,\"vib_peak\":%.1f,\"flags\":%u}",
            (i > 0 ? "," : ""),
            nid,
            maxTemp,
            maxVib,
            maxPeak,
            static_cast<unsigned>(nodes[i].statusFlags)));
    }
    if (pos < cap) {
        pos += static_cast<size_t>(std::snprintf(buf + pos, cap - pos, "]"));
    }
}

size_t BlackBoxBuffer::buildAnomalyBurstJson(char* outBuf, size_t outCap,
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
                                             uint16_t maxBurstRecords) const {
    if (!outBuf || outCap == 0) return 0;

    char trigIdStr[12];
    can2::formatNodeIdString(triggerNodeId, trigIdStr);

    size_t pos = static_cast<size_t>(std::snprintf(
        outBuf, outCap,
        "{\"protocol_version\":%u,\"device_id\":\"%s\",\"timestamp_utc\":\"%s\","
        "\"tractor_id\":\"%s\",\"trailer_id\":\"%s\",\"packet_type\":\"ANOMALY_BURST\","
        "\"event_id\":\"%s\",\"severity\":\"%s\",\"trigger_node_id\":\"%s\","
        "\"trigger_reason\":\"%s\",\"firmware_version\":\"%s\",\"summary\":",
        static_cast<unsigned>(kProtocolVersion),
        deviceId ? deviceId : "S3_UNKNOWN",
        timestampUtc ? timestampUtc : "1970-01-01T00:00:00Z",
        tractorId ? tractorId : "TR_000",
        (trailerId && trailerId[0] != '\0') ? trailerId : "",
        eventId ? eventId : "00000000-0000-4000-8000-000000000000",
        severityStr ? severityStr : "YELLOW",
        trigIdStr,
        triggerReason ? triggerReason : "VIB_SPIKE",
        kFirmwareVersion));

    appendSummaryArray(outBuf, outCap, pos, summaryNodes, summaryCount);

    // Serialize recent ring records into compact binary slice -> Base64
    uint16_t take = (count_ < maxBurstRecords) ? count_ : maxBurstRecords;
    if (take > 32) take = 32;
    uint8_t rawSlice[32 * sizeof(BlackBoxRecord)];
    const uint16_t startIdx = (count_ == kBlackBoxRingCapacity)
                                  ? static_cast<uint16_t>((head_ + count_ - take) % kBlackBoxRingCapacity)
                                  : static_cast<uint16_t>(count_ > take ? (count_ - take) : 0);
    for (uint16_t i = 0; i < take; ++i) {
        const uint16_t slot = static_cast<uint16_t>((startIdx + i) % kBlackBoxRingCapacity);
        std::memcpy(rawSlice + i * sizeof(BlackBoxRecord), &ring_[slot], sizeof(BlackBoxRecord));
    }

    char b64Buf[1100];
    base64Encode(rawSlice, take * sizeof(BlackBoxRecord), b64Buf, sizeof(b64Buf));

    if (pos < outCap) {
        pos += static_cast<size_t>(std::snprintf(
            outBuf + pos, outCap - pos,
            ",\"burst_samples_base64\":\"%s\"}", b64Buf));
    }
    return (pos < outCap) ? pos : (outCap - 1);
}

size_t BlackBoxBuffer::buildHeartbeatJson(char* outBuf, size_t outCap,
                                          const char* deviceId,
                                          const char* tractorId,
                                          const char* trailerId,
                                          const char* timestampUtc,
                                          const can2::AxleTelemetry* summaryNodes,
                                          uint8_t summaryCount,
                                          uint32_t configVersion) const {
    if (!outBuf || outCap == 0) return 0;

    size_t pos = static_cast<size_t>(std::snprintf(
        outBuf, outCap,
        "{\"protocol_version\":%u,\"device_id\":\"%s\",\"timestamp_utc\":\"%s\","
        "\"tractor_id\":\"%s\",\"trailer_id\":\"%s\",\"packet_type\":\"HEARTBEAT\","
        "\"firmware_version\":\"%s\",\"config_version\":%lu,\"summary\":",
        static_cast<unsigned>(kProtocolVersion),
        deviceId ? deviceId : "S3_UNKNOWN",
        timestampUtc ? timestampUtc : "1970-01-01T00:00:00Z",
        tractorId ? tractorId : "TR_000",
        (trailerId && trailerId[0] != '\0') ? trailerId : "",
        kFirmwareVersion,
        static_cast<unsigned long>(configVersion)));

    appendSummaryArray(outBuf, outCap, pos, summaryNodes, summaryCount);

    if (pos < outCap) {
        pos += static_cast<size_t>(std::snprintf(outBuf + pos, outCap - pos, "}"));
    }
    return (pos < outCap) ? pos : (outCap - 1);
}

} // namespace rules
} // namespace techbit
