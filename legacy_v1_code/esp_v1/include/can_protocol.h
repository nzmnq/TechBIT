#pragma once

#include <cstdint>
#include <cstring>

namespace techbit {
namespace can {

// ============================================================================
// TechBIT CAN 2.0A Protocol (500 kbps, Standard 11-bit IDs)
// ============================================================================
// Each wheel node transmits 2 compact 8-byte frames every ~51.2 ms:
//   0x100 + wheel_id : Core vibration amplitude, peak & Fourier energy bands
//   0x110 + wheel_id : Fourier dominant frequency, spectral centroid, tonality, kurtosis & temp
//
// Central Hub transmits control commands on:
//   0x200            : Hub Command (Start calibration, reset peak/faults, heartbeat)

static constexpr uint32_t kCanIdCoreBase     = 0x100;
static constexpr uint32_t kCanIdSpectralBase = 0x110;
static constexpr uint32_t kCanIdHubCommand   = 0x200;

static constexpr int16_t  kTempNotAvailable  = 0x7FFF;

enum StatusFlagBits : uint8_t {
    FLAG_ADC_OK          = (1 << 0),
    FLAG_SURGE_CLIPPING  = (1 << 1), // Input hit BAT54S clamping rail (extreme shock)
    FLAG_TEMP_VALID      = (1 << 2), // Optional NTC temperature sensor connected
    FLAG_NODE_CALIBRATED = (1 << 3),
    FLAG_HIGH_ENERGY     = (1 << 4)
};

enum HubCommandType : uint8_t {
    CMD_PING             = 0x00,
    CMD_START_CALIB      = 0x01,
    CMD_RESET_FLAGS      = 0x02
};

// Decoded full telemetry record for one wheel
struct WheelTelemetryPacket {
    uint8_t  wheelId;
    float    rmsMv;
    float    peakMv;
    float    bandLowRatio;      // 80..600 Hz [0..1]
    float    bandMidRatio;      // 600..2500 Hz [0..1]
    float    bandHighRatio;     // 2500..8000 Hz [0..1]
    uint8_t  statusFlags;
    uint16_t dominantFreqHz;
    uint16_t spectralCentroidHz;
    float    tonalityRatio;
    float    kurtosis;
    float    tempC;             // Valid only if (statusFlags & FLAG_TEMP_VALID)
};

// ---- Helpers for little-endian packing (no unaligned-access UB) ----
inline void putU16(uint8_t* buf, uint16_t v) {
    buf[0] = static_cast<uint8_t>(v & 0xFF);
    buf[1] = static_cast<uint8_t>((v >> 8) & 0xFF);
}

inline void putI16(uint8_t* buf, int16_t v) {
    putU16(buf, static_cast<uint16_t>(v));
}

inline uint16_t getU16(const uint8_t* buf) {
    return static_cast<uint16_t>(buf[0]) | (static_cast<uint16_t>(buf[1]) << 8);
}

inline int16_t getI16(const uint8_t* buf) {
    return static_cast<int16_t>(getU16(buf));
}

inline uint8_t clampU8(float v) {
    if (v <= 0.0f) return 0;
    if (v >= 255.0f) return 255;
    return static_cast<uint8_t>(v + 0.5f);
}

inline uint16_t clampU16(float v) {
    if (v <= 0.0f) return 0;
    if (v >= 65535.0f) return 65535;
    return static_cast<uint16_t>(v + 0.5f);
}

// Pack Core Frame (0x100 + wheelId):
// [0..1] rms_x10_mv (uint16: 0.1 mV resolution -> up to 6553.5 mV)
// [2..3] peak_x10_mv (uint16: 0.1 mV resolution -> up to 6553.5 mV)
// [4]    band_low_q8 (0..255 -> 0..1.0)
// [5]    band_mid_q8 (0..255 -> 0..1.0)
// [6]    band_high_q8 (0..255 -> 0..1.0)
// [7]    status_flags
inline void packCoreFrame(const WheelTelemetryPacket& pkt, uint8_t out[8]) {
    putU16(&out[0], clampU16(pkt.rmsMv * 10.0f));
    putU16(&out[2], clampU16(pkt.peakMv * 10.0f));
    out[4] = clampU8(pkt.bandLowRatio * 255.0f);
    out[5] = clampU8(pkt.bandMidRatio * 255.0f);
    out[6] = clampU8(pkt.bandHighRatio * 255.0f);
    out[7] = pkt.statusFlags;
}

inline void unpackCoreFrame(const uint8_t in[8], WheelTelemetryPacket& pkt) {
    pkt.rmsMv         = static_cast<float>(getU16(&in[0])) * 0.1f;
    pkt.peakMv        = static_cast<float>(getU16(&in[2])) * 0.1f;
    pkt.bandLowRatio  = static_cast<float>(in[4]) / 255.0f;
    pkt.bandMidRatio  = static_cast<float>(in[5]) / 255.0f;
    pkt.bandHighRatio = static_cast<float>(in[6]) / 255.0f;
    pkt.statusFlags   = in[7];
}

// Pack Spectral Frame (0x110 + wheelId):
// [0..1] dominant_freq_hz (uint16)
// [2..3] spectral_centroid_hz (uint16)
// [4]    tonality_q4 (0..15.9375, step 0.0625 -> clamp to 255)
// [5]    kurtosis_q4 (0..15.9375, step 0.0625 -> clamp to 255)
// [6..7] temp_deci_c (int16: 0.1 C resolution, or 0x7FFF if unavailable)
inline void packSpectralFrame(const WheelTelemetryPacket& pkt, uint8_t out[8]) {
    putU16(&out[0], pkt.dominantFreqHz);
    putU16(&out[2], pkt.spectralCentroidHz);
    out[4] = clampU8(pkt.tonalityRatio * 16.0f);
    out[5] = clampU8(pkt.kurtosis * 16.0f);
    if (pkt.statusFlags & FLAG_TEMP_VALID) {
        int32_t deci = static_cast<int32_t>(pkt.tempC * 10.0f);
        if (deci > 32700) deci = 32700;
        if (deci < -32700) deci = -32700;
        putI16(&out[6], static_cast<int16_t>(deci));
    } else {
        putI16(&out[6], kTempNotAvailable);
    }
}

inline void unpackSpectralFrame(const uint8_t in[8], WheelTelemetryPacket& pkt) {
    pkt.dominantFreqHz     = getU16(&in[0]);
    pkt.spectralCentroidHz = getU16(&in[2]);
    pkt.tonalityRatio      = static_cast<float>(in[4]) / 16.0f;
    pkt.kurtosis           = static_cast<float>(in[5]) / 16.0f;
    int16_t deci           = getI16(&in[6]);
    if (deci == kTempNotAvailable) {
        pkt.tempC = 0.0f;
    } else {
        pkt.tempC = static_cast<float>(deci) * 0.1f;
    }
}

} // namespace can
} // namespace techbit
