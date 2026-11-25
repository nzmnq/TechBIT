#pragma once

#include <cstdint>
#include <cstdio>

namespace techbit {
namespace can2 {

// ============================================================================
// TechBIT Extended 29-bit CAN Protocol (500 kbps)
// CAN ID layout: [28..24: MsgType (5 bits)] | [23..0: NodeId (low 3 bytes MAC)]
// Allows multiple unified C3 Axle Nodes on the same bus with zero manual DIPs.
// ============================================================================

enum CanMsgType : uint8_t {
    MSG_AXLE_VIB         = 0x01, // L & R vibration RMS (mm/s), peak, crest factor
    MSG_AXLE_TEMP_META   = 0x02, // L & R temperatures (0.1°C), dominant FFT freq, flags
    MSG_HEARTBEAT        = 0x03, // Node health, FW version, uptime
    MSG_RAW_BURST_CHUNK  = 0x04, // Detailed sample/frame chunk requested on anomaly
    MSG_AXLE_ML_FEATURES = 0x05, // Domain-invariant ML features: kurtosis, HF energy, tonality, bandLow
    MSG_MASTER_CMD       = 0x10  // S3/Bridge -> C3 Node command
};

enum MasterCommandCode : uint8_t {
    CMD_HEARTBEAT_REQ     = 0x01,
    CMD_REQUEST_RAW_BURST = 0x02,
    CMD_IDENTIFY_LED      = 0x03
};

enum NodeStatusFlags : uint8_t {
    FLAG_LEFT_OK        = (1 << 0),
    FLAG_RIGHT_OK       = (1 << 1),
    FLAG_LEFT_CLIP      = (1 << 2),
    FLAG_RIGHT_CLIP     = (1 << 3),
    FLAG_LEFT_OPEN      = (1 << 4), // Broken piezo/NTC harness detected
    FLAG_RIGHT_OPEN     = (1 << 5),
    FLAG_LOCAL_SPIKE    = (1 << 6)
};

struct AxleTelemetry {
    uint32_t nodeId        = 0;     // 24-bit hardware MAC identifier (e.g. 0x998877 -> "C3_998877")
    float    tempLeftC     = 25.0f; // °C (SI)
    float    tempRightC    = 25.0f; // °C (SI)
    float    vibRmsLeft    = 0.0f;  // mm/s equivalent / calibrated intensity
    float    vibRmsRight   = 0.0f;  // mm/s
    float    vibPeakLeft   = 0.0f;
    float    vibPeakRight  = 0.0f;
    float    crestLeft     = 1.0f;
    float    crestRight    = 1.0f;
    uint16_t domFreqLeftHz = 0;
    uint16_t domFreqRightHz = 0;
    uint8_t  statusFlags   = 0;
    uint8_t  seq           = 0;

    // Domain-invariant ML features (work identically on Hyundai Santa Fe & 40t trucks!)
    float    kurtosisLeft  = 3.0f;  // ~3.0 normal Gaussian noise, > 5.5 impulsive bearing spall
    float    kurtosisRight = 3.0f;
    float    hfEnergyLeft  = 0.25f; // Fraction of FFT energy in 600..4500 Hz (0..1)
    float    hfEnergyRight = 0.25f;
    float    tonalityLeft  = 1.0f;  // Spectral peak-to-mean ratio
    float    tonalityRight = 1.0f;
    float    bandLowLeft   = 0.50f; // Fraction of FFT energy in 80..600 Hz (road band)
    float    bandLowRight  = 0.50f;
};

struct NodeHeartbeat {
    uint32_t nodeId;
    uint8_t  fwMajor;
    uint8_t  fwMinor;
    uint8_t  fwPatch;
    uint32_t uptimeSec;
    uint8_t  healthFlags;
};

struct RawBurstChunk {
    uint32_t nodeId;
    uint16_t chunkIndex;
    uint16_t totalChunks;
    uint16_t sampleVibLeftX100;
    uint16_t sampleTempLeftX10;
};

inline uint32_t makeExtId(uint8_t msgType, uint32_t nodeId24) {
    return (static_cast<uint32_t>(msgType & 0x1FU) << 24) | (nodeId24 & 0x00FFFFFFU);
}

inline uint8_t extractMsgType(uint32_t extId) {
    return static_cast<uint8_t>((extId >> 24) & 0x1FU);
}

inline uint32_t extractNodeId(uint32_t extId) {
    return extId & 0x00FFFFFFU;
}

inline void formatNodeIdString(uint32_t nodeId, char out[12]) {
    std::snprintf(out, 12, "C3_%06X", static_cast<unsigned>(nodeId & 0xFFFFFFU));
}

inline void putU16(uint8_t* p, uint16_t v) {
    p[0] = static_cast<uint8_t>(v & 0xFFU);
    p[1] = static_cast<uint8_t>((v >> 8) & 0xFFU);
}

inline uint16_t getU16(const uint8_t* p) {
    return static_cast<uint16_t>(p[0]) | (static_cast<uint16_t>(p[1]) << 8);
}

inline int16_t getI16(const uint8_t* p) {
    return static_cast<int16_t>(getU16(p));
}

inline uint16_t clampU16(float v) {
    if (v <= 0.0f) return 0;
    if (v >= 65535.0f) return 65535;
    return static_cast<uint16_t>(v + 0.5f);
}

inline uint8_t clampU8(float v) {
    if (v <= 0.0f) return 0;
    if (v >= 255.0f) return 255;
    return static_cast<uint8_t>(v + 0.5f);
}

inline int16_t clampI16(float v) {
    if (v <= -32767.0f) return -32767;
    if (v >= 32767.0f) return 32767;
    return static_cast<int16_t>(v >= 0.0f ? (v + 0.5f) : (v - 0.5f));
}

// Frame 1 (MSG_AXLE_VIB):
inline void packAxleVibFrame(const AxleTelemetry& t, uint8_t out[8]) {
    putU16(&out[0], clampU16(t.vibRmsLeft * 100.0f));
    putU16(&out[2], clampU16(t.vibRmsRight * 100.0f));
    out[4] = clampU8(t.vibPeakLeft * 10.0f);
    out[5] = clampU8(t.vibPeakRight * 10.0f);
    out[6] = clampU8(t.crestLeft * 10.0f);
    out[7] = clampU8(t.crestRight * 10.0f);
}

inline void unpackAxleVibFrame(const uint8_t in[8], AxleTelemetry& t) {
    t.vibRmsLeft   = static_cast<float>(getU16(&in[0])) * 0.01f;
    t.vibRmsRight  = static_cast<float>(getU16(&in[2])) * 0.01f;
    t.vibPeakLeft  = static_cast<float>(in[4]) * 0.1f;
    t.vibPeakRight = static_cast<float>(in[5]) * 0.1f;
    t.crestLeft    = static_cast<float>(in[6]) * 0.1f;
    t.crestRight   = static_cast<float>(in[7]) * 0.1f;
}

// Frame 2 (MSG_AXLE_TEMP_META):
inline void packAxleTempFrame(const AxleTelemetry& t, uint8_t out[8]) {
    putU16(&out[0], static_cast<uint16_t>(clampI16(t.tempLeftC * 10.0f)));
    putU16(&out[2], static_cast<uint16_t>(clampI16(t.tempRightC * 10.0f)));
    out[4] = clampU8(static_cast<float>(t.domFreqLeftHz) / 20.0f);
    out[5] = clampU8(static_cast<float>(t.domFreqRightHz) / 20.0f);
    out[6] = t.statusFlags;
    out[7] = t.seq;
}

inline void unpackAxleTempFrame(const uint8_t in[8], AxleTelemetry& t) {
    t.tempLeftC      = static_cast<float>(getI16(&in[0])) * 0.1f;
    t.tempRightC     = static_cast<float>(getI16(&in[2])) * 0.1f;
    t.domFreqLeftHz  = static_cast<uint16_t>(in[4]) * 20U;
    t.domFreqRightHz = static_cast<uint16_t>(in[5]) * 20U;
    t.statusFlags    = in[6];
    t.seq            = in[7];
}

// Frame 3 (MSG_AXLE_ML_FEATURES):
// [0] kurtosis_L * 10 (0..25.5)
// [1] kurtosis_R * 10
// [2] hf_energy_L * 250 (0..1.0 -> 600..4500 Hz ratio)
// [3] hf_energy_R * 250
// [4] tonality_L * 10 (0..25.5)
// [5] tonality_R * 10
// [6] band_low_L * 250 (0..1.0 -> 80..600 Hz ratio)
// [7] band_low_R * 250
inline void packAxleMlFeaturesFrame(const AxleTelemetry& t, uint8_t out[8]) {
    out[0] = clampU8(t.kurtosisLeft * 10.0f);
    out[1] = clampU8(t.kurtosisRight * 10.0f);
    out[2] = clampU8(t.hfEnergyLeft * 250.0f);
    out[3] = clampU8(t.hfEnergyRight * 250.0f);
    out[4] = clampU8(t.tonalityLeft * 10.0f);
    out[5] = clampU8(t.tonalityRight * 10.0f);
    out[6] = clampU8(t.bandLowLeft * 250.0f);
    out[7] = clampU8(t.bandLowRight * 250.0f);
}

inline void unpackAxleMlFeaturesFrame(const uint8_t in[8], AxleTelemetry& t) {
    t.kurtosisLeft  = static_cast<float>(in[0]) * 0.1f;
    t.kurtosisRight = static_cast<float>(in[1]) * 0.1f;
    t.hfEnergyLeft  = static_cast<float>(in[2]) / 250.0f;
    t.hfEnergyRight = static_cast<float>(in[3]) / 250.0f;
    t.tonalityLeft  = static_cast<float>(in[4]) * 0.1f;
    t.tonalityRight = static_cast<float>(in[5]) * 0.1f;
    t.bandLowLeft   = static_cast<float>(in[6]) / 250.0f;
    t.bandLowRight  = static_cast<float>(in[7]) / 250.0f;
}

// Frame 4 (MSG_HEARTBEAT):
inline void packHeartbeatFrame(const NodeHeartbeat& hb, uint8_t out[8]) {
    out[0] = hb.fwMajor;
    out[1] = hb.fwMinor;
    out[2] = hb.fwPatch;
    out[3] = static_cast<uint8_t>(hb.uptimeSec & 0xFFU);
    out[4] = static_cast<uint8_t>((hb.uptimeSec >> 8) & 0xFFU);
    out[5] = static_cast<uint8_t>((hb.uptimeSec >> 16) & 0xFFU);
    out[6] = static_cast<uint8_t>((hb.uptimeSec >> 24) & 0xFFU);
    out[7] = hb.healthFlags;
}

inline void unpackHeartbeatFrame(const uint8_t in[8], NodeHeartbeat& hb) {
    hb.fwMajor     = in[0];
    hb.fwMinor     = in[1];
    hb.fwPatch     = in[2];
    hb.uptimeSec   = static_cast<uint32_t>(in[3]) |
                     (static_cast<uint32_t>(in[4]) << 8) |
                     (static_cast<uint32_t>(in[5]) << 16) |
                     (static_cast<uint32_t>(in[6]) << 24);
    hb.healthFlags = in[7];
}

inline void packBurstChunkFrame(const RawBurstChunk& c, uint8_t out[8]) {
    putU16(&out[0], c.chunkIndex);
    putU16(&out[2], c.totalChunks);
    putU16(&out[4], c.sampleVibLeftX100);
    putU16(&out[6], c.sampleTempLeftX10);
}

inline void unpackBurstChunkFrame(const uint8_t in[8], RawBurstChunk& c) {
    c.chunkIndex        = getU16(&in[0]);
    c.totalChunks       = getU16(&in[2]);
    c.sampleVibLeftX100 = getU16(&in[4]);
    c.sampleTempLeftX10 = getU16(&in[6]);
}

inline void packMasterCmdFrame(uint8_t cmdCode, uint32_t targetNodeId, uint8_t out[8]) {
    out[0] = cmdCode;
    out[1] = static_cast<uint8_t>(targetNodeId & 0xFFU);
    out[2] = static_cast<uint8_t>((targetNodeId >> 8) & 0xFFU);
    out[3] = static_cast<uint8_t>((targetNodeId >> 16) & 0xFFU);
    out[4] = 0;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
}

} // namespace can2
} // namespace techbit
