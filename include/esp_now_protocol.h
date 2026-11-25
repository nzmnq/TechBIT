#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include "can_protocol_v2.h"
#include "techbit_config.h"

namespace techbit {
namespace espnow2 {

// ============================================================================
// Trailer <-> Tractor ESP-NOW Packet Codec (max 250 bytes per ESP-NOW frame)
// Encrypted in hardware via ESP-NOW AES-128 CCMP when paired with LMK.
// ============================================================================

static constexpr uint8_t kMagicByte0 = 0x54; // 'T'
static constexpr uint8_t kMagicByte1 = 0x42; // 'B'
static constexpr uint8_t kMaxNodesPerBridgePacket = 4; // Up to 4 axles (8 wheels) on trailer

enum EspNowPacketType : uint8_t {
    PKT_TELEMETRY  = 1,
    PKT_DISCOVERY  = 2,
    PKT_BURST_DATA = 3,
    PKT_PAIR_ACK   = 4
};

#pragma pack(push, 1)
struct CompactNodeRecord {
    uint32_t nodeId;
    int16_t  tempLeftX10;
    int16_t  tempRightX10;
    uint16_t vibRmsLeftX100;
    uint16_t vibRmsRightX100;
    uint16_t vibPeakLeftX10;
    uint16_t vibPeakRightX10;
    uint8_t  kurtosisLeftX10;
    uint8_t  kurtosisRightX10;
    uint8_t  hfEnergyLeftX250;
    uint8_t  hfEnergyRightX250;
    uint8_t  statusFlags;
    uint8_t  seq;
};

struct TrailerTelemetryPacket {
    uint8_t  magic0;
    uint8_t  magic1;
    uint8_t  protocolVersion;
    uint8_t  packetType;
    char     trailerId[12];
    uint16_t sequence;
    uint8_t  nodeCount;
    CompactNodeRecord nodes[kMaxNodesPerBridgePacket];
    uint16_t crc16;
};

struct TrailerDiscoveryPacket {
    uint8_t  magic0;
    uint8_t  magic1;
    uint8_t  protocolVersion;
    uint8_t  packetType;
    char     trailerId[12];
    uint8_t  bridgeMac[6];
    uint16_t crc16;
};
#pragma pack(pop)

inline uint16_t crc16Ccitt(const uint8_t* data, size_t len) {
    uint16_t crc = 0xFFFFU;
    for (size_t i = 0; i < len; ++i) {
        crc ^= static_cast<uint16_t>(data[i]) << 8;
        for (uint8_t b = 0; b < 8; ++b) {
            if (crc & 0x8000U) {
                crc = static_cast<uint16_t>((crc << 1) ^ 0x1021U);
            } else {
                crc = static_cast<uint16_t>(crc << 1);
            }
        }
    }
    return crc;
}

inline void finalizeTelemetryCrc(TrailerTelemetryPacket& pkt) {
    pkt.magic0          = kMagicByte0;
    pkt.magic1          = kMagicByte1;
    pkt.protocolVersion = kProtocolVersion;
    pkt.packetType      = PKT_TELEMETRY;
    pkt.crc16 = crc16Ccitt(reinterpret_cast<const uint8_t*>(&pkt),
                           sizeof(TrailerTelemetryPacket) - sizeof(uint16_t));
}

inline bool validateTelemetryPacket(const uint8_t* raw, size_t len, TrailerTelemetryPacket& out) {
    if (!raw || len != sizeof(TrailerTelemetryPacket)) {
        return false;
    }
    std::memcpy(&out, raw, sizeof(TrailerTelemetryPacket));
    if (out.magic0 != kMagicByte0 || out.magic1 != kMagicByte1 || out.packetType != PKT_TELEMETRY) {
        return false;
    }
    if (out.nodeCount > kMaxNodesPerBridgePacket) {
        return false;
    }
    const uint16_t expected = crc16Ccitt(reinterpret_cast<const uint8_t*>(&out),
                                         sizeof(TrailerTelemetryPacket) - sizeof(uint16_t));
    return (expected == out.crc16);
}

inline CompactNodeRecord toCompactRecord(const can2::AxleTelemetry& t) {
    CompactNodeRecord r{};
    r.nodeId           = t.nodeId;
    r.tempLeftX10      = can2::clampI16(t.tempLeftC * 10.0f);
    r.tempRightX10     = can2::clampI16(t.tempRightC * 10.0f);
    r.vibRmsLeftX100   = can2::clampU16(t.vibRmsLeft * 100.0f);
    r.vibRmsRightX100  = can2::clampU16(t.vibRmsRight * 100.0f);
    r.vibPeakLeftX10   = can2::clampU16(t.vibPeakLeft * 10.0f);
    r.vibPeakRightX10  = can2::clampU16(t.vibPeakRight * 10.0f);
    r.kurtosisLeftX10  = can2::clampU8(t.kurtosisLeft * 10.0f);
    r.kurtosisRightX10 = can2::clampU8(t.kurtosisRight * 10.0f);
    r.hfEnergyLeftX250 = can2::clampU8(t.hfEnergyLeft * 250.0f);
    r.hfEnergyRightX250 = can2::clampU8(t.hfEnergyRight * 250.0f);
    r.statusFlags      = t.statusFlags;
    r.seq              = t.seq;
    return r;
}

inline can2::AxleTelemetry fromCompactRecord(const CompactNodeRecord& r) {
    can2::AxleTelemetry t{};
    t.nodeId        = r.nodeId;
    t.tempLeftC     = static_cast<float>(r.tempLeftX10) * 0.1f;
    t.tempRightC    = static_cast<float>(r.tempRightX10) * 0.1f;
    t.vibRmsLeft    = static_cast<float>(r.vibRmsLeftX100) * 0.01f;
    t.vibRmsRight   = static_cast<float>(r.vibRmsRightX100) * 0.01f;
    t.vibPeakLeft   = static_cast<float>(r.vibPeakLeftX10) * 0.1f;
    t.vibPeakRight  = static_cast<float>(r.vibPeakRightX10) * 0.1f;
    t.kurtosisLeft  = (r.kurtosisLeftX10 > 0) ? (static_cast<float>(r.kurtosisLeftX10) * 0.1f) : 3.0f;
    t.kurtosisRight = (r.kurtosisRightX10 > 0) ? (static_cast<float>(r.kurtosisRightX10) * 0.1f) : 3.0f;
    t.hfEnergyLeft  = static_cast<float>(r.hfEnergyLeftX250) / 250.0f;
    t.hfEnergyRight = static_cast<float>(r.hfEnergyRightX250) / 250.0f;
    t.statusFlags   = r.statusFlags;
    t.seq           = r.seq;
    return t;
}

} // namespace espnow2
} // namespace techbit
