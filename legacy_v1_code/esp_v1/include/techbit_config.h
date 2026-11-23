#pragma once

#include <cstdint>

namespace techbit {

// Wheel node identifiers (match physical wheel corners)
enum WheelId : uint8_t {
    WHEEL_FL = 0, // Переднє ліве (Front-Left)
    WHEEL_FR = 1, // Переднє праве (Front-Right)
    WHEEL_RL = 2, // Заднє ліве (Rear-Left)
    WHEEL_RR = 3, // Заднє праве (Rear-Right)
    WHEEL_COUNT = 4
};

inline const char* wheelName(uint8_t id) {
    switch (id) {
        case WHEEL_FL: return "FL";
        case WHEEL_FR: return "FR";
        case WHEEL_RL: return "RL";
        case WHEEL_RR: return "RR";
        default:       return "??";
    }
}

// ============================================================================
// Signal Acquisition & Fourier Transform (FFT) Parameters
// ============================================================================
static constexpr uint32_t kSampleRateHz       = 20000;  // 20 kSPS continuous DMA ADC
static constexpr uint16_t kFftSize            = 512;    // 512 samples = 25.6 ms window (~39.06 Hz/bin)
static constexpr uint8_t  kFramesPerCanReport = 2;      // Aggregate 2 FFT windows (~51.2 ms) per CAN report

// Analog Front-End (MCP6002-I/P + BAT54S + 100k/100k Vref)
static constexpr float    kAdcFullScaleMv     = 2550.0f; // ESP32-C3 ADC_ATTEN_DB_11 linear range (~2.55V)
static constexpr uint16_t kAdcMaxCounts       = 4095;    // 12-bit ADC
static constexpr uint16_t kAdcSurgeLowThresh  = 25;      // Clamping diode low saturation check
static constexpr uint16_t kAdcSurgeHighThresh = 4070;    // Clamping diode high saturation check

// Fourier Frequency Bands (at 20 kSPS / 512 = 39.0625 Hz per bin)
// Bin k corresponds to k * 39.0625 Hz
static constexpr uint16_t kBandLowMinHz       = 80;      // Suspension & rough road rumble
static constexpr uint16_t kBandLowMaxHz       = 600;
static constexpr uint16_t kBandMidMinHz       = 600;     // Hub bearing defects (BPFO/BPFI/BSF) & knock
static constexpr uint16_t kBandMidMaxHz       = 2500;
static constexpr uint16_t kBandHighMinHz      = 2500;    // Brake pad drag, caliper chatter & spalling
static constexpr uint16_t kBandHighMaxHz      = 8000;    // Well below 10 kHz Nyquist & 15.9 kHz AFE LPF

// ============================================================================
// CAN Bus (TWAI @ 500 kbps)
// ============================================================================
static constexpr uint32_t kCanBitrateBps      = 500000;
static constexpr uint32_t kNodeTimeoutMs      = 1200;    // Mark wheel node offline if silent > 1.2 s

// ============================================================================
// Machine Learning, Road Context & Fault Confirmation (Central ESP32-S3)
// ============================================================================
static constexpr float    kDefaultBaselineRmsMv       = 28.0f;  // Fallback RMS before calibration
static constexpr float    kMinPeerMedianMv            = 6.0f;   // Floor to avoid division by tiny noise
static constexpr float    kFaultProbThreshold         = 0.65f;  // Softmax confidence required to accumulate fault
static constexpr float    kFaultPeerRatioMin          = 1.50f;  // Must exceed peer wheels by >= 1.5x (smooth road)
static constexpr float    kFaultOnBadRoadPeerRatioMin = 1.90f;  // Stricter threshold while driving on cobblestone
static constexpr float    kBadRoadFloorRatio          = 1.85f;  // Peer median > 1.85x baseline = rough road context
static constexpr float    kAxleSymmetryMin            = 0.60f;  // Both wheels on same axle rising together
static constexpr float    kAxleSymmetryMax            = 1.65f;
static constexpr float    kStandstillRmsMv            = 7.0f;   // Below this RMS, vehicle is practically stopped
static constexpr uint32_t kWarningDelayMs             = 1800;   // Silent visual warning after 1.8 s (skips short braking)
static constexpr uint32_t kFaultConfirmDurationMs     = 3000;   // Must persist > 3.0 seconds (anti-pothole guard)
static constexpr uint32_t kPotholeCooldownMs          = 900;    // Post-impact suspension settle guard
static constexpr uint32_t kSideCascadeGuardMs         = 750;    // Front wheel pothole shields rear wheel on same side
static constexpr uint32_t kStartupBlankingMs          = 2000;   // Ignore ACC power-on / starter transient
static constexpr uint32_t kDeadSensorTimeoutMs        = 5000;   // Detect open piezo sensor while vehicle moves
static constexpr float    kDeadSensorRmsMv            = 1.8f;   // Near-zero AC signal while peer >= 20 mV
static constexpr float    kDeadSensorPeerMinMv        = 20.0f;
static constexpr uint32_t kCalibrationDurationMs      = 5000;   // 5-second smooth-driving auto-calibration window
static constexpr uint32_t kLongPressCalibMs           = 1500;   // Hold BOOT button >= 1.5 s to calibrate (tap = mute)
static constexpr float    kTempOverheatAbsC           = 75.0f;  // Optional thermal sensor absolute alarm
static constexpr float    kTempDeltaOverPeerC         = 18.0f;  // Optional wheel thermal delta over peers

} // namespace techbit
