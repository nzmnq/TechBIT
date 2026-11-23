#pragma once

#include <cstdint>

namespace techbit {

// ============================================================================
// Versioning & Protocol Identity (Software Spec Section 6.4)
// ============================================================================
static constexpr uint8_t     kProtocolVersion    = 1;
static constexpr const char* kFirmwareVersion    = "2.0.0-mvp";

// ============================================================================
// CAN Bus & ESP-NOW Link Configuration (Hardware Spec Section 2)
// ============================================================================
static constexpr uint32_t kCanBitrateBps          = 500000;
static constexpr uint8_t  kEspNowChannel          = 6;      // Fixed channel (no Wi-Fi router needed)
static constexpr bool     kEspNowUseLongRange     = true;   // 802.11 LR mode for metal truck resilience
static constexpr bool     kEspNowEnableEncryption = true;   // Hardware AES-128 CCMP encryption
static constexpr uint32_t kNodeOfflineTimeoutMs   = 5000;   // Detect cut/unplugged C3 harness on STO

// Shared AES-128 Primary Master Key (PMK) & Local Master Key (LMK) for fleet pairing
// In production, provision per-organization keys during factory/BLE setup.
static constexpr uint8_t kEspNowPmk[16] = {
    'T','e','c','h','B','I','T','_','P','M','K','_','2','0','2','6'
};
static constexpr uint8_t kEspNowLmk[16] = {
    'T','e','c','h','B','I','T','_','A','E','S','1','2','8','K','Y'
};

// ============================================================================
// Edge Acquisition & DSP on ESP32-C3 Axle Nodes
// ============================================================================
static constexpr uint32_t kAdcPerChannelVibHz     = 10000;  // 10 kSPS per L/R vibration channel
static constexpr uint16_t kDspFftSize             = 256;    // 256 pts @ 10 kSPS = 25.6 ms (~39.06 Hz/bin)
static constexpr uint32_t kNodeTelemetryPeriodMs  = 1000;   // 1 Hz normal telemetry over CAN
static constexpr uint32_t kNodeHeartbeatPeriodMs  = 2500;   // 2.5 s node health heartbeat
static constexpr float    kAdcFullScaleMv         = 2550.0f;
static constexpr uint16_t kAdcMaxCounts           = 4095;
static constexpr uint8_t  kC3BurstRingFrames      = 24;     // Short local C3 burst ring buffer

// ============================================================================
// Default Cloud-Configurable Physical Thresholds (MVP Rule-Based Engine)
// All thresholds are metric SI (°C, mm/s, g) and timestamps strictly UTC.
// ============================================================================
static constexpr float    kDefaultTempWarnC            = 70.0f;  // Absolute warning temp
static constexpr float    kDefaultTempCritC            = 95.0f;  // RED critical overheating threshold
static constexpr float    kDefaultAxleTempDeltaWarnC   = 18.0f;  // L vs R delta (Spec: 15..20°C)
static constexpr float    kDefaultAxleTempDeltaCritC   = 35.0f;  // Critical L vs R delta
static constexpr float    kDefaultVibWarnRmsMmS        = 3.50f;  // Sustained vibration warning (mm/s)
static constexpr float    kDefaultVibCritRmsMmS        = 6.50f;  // Critical vibration (mm/s)
static constexpr float    kDefaultVibDeltaRatioWarn    = 2.20f;  // L vs R or peer axle ratio
static constexpr float    kDefaultShadowVibRatio       = 1.65f;  // Earlier shadow logging sensitivity
static constexpr uint32_t kDefaultYellowConfirmMs      = 60000;  // > 60 s sustained to ignore potholes
static constexpr uint32_t kDefaultRedConfirmMs         = 5000;   // 5 s confirmation for RED critical

// ============================================================================
// S3 Black Box, Cloud Telemetry & Installer BLE Service Mode
// ============================================================================
static constexpr uint8_t  kMaxTrackedNodes        = 12;     // Up to 12 C3 axle nodes (~24 wheels)
static constexpr uint16_t kBlackBoxRingCapacity   = 180;    // 3 minutes @ 1 snapshot/sec
static constexpr uint32_t kLteHeartbeatPeriodMs   = 60000;  // 1-min lightweight summary (saves SIM traffic)
static constexpr uint32_t kBleServiceTimeoutMs    = 900000; // 15-min installer BLE auto-shutoff

} // namespace techbit
