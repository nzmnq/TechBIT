#pragma once

// ============================================================================
// TechBIT Hardware Architecture Pinout (v2.0 — Aligned with KiCad PCB & S3 Cab)
// ============================================================================

#if defined(TECHBIT_ROLE_C3_NODE)

// ---- ESP32-C3 Unified Axle Sensor Node ----
// Matched to Wheel_Sensor_Amplifier KiCad PCB (GPIO2 primary piezo + GPIO8/9 SHT40 + GPIO21/20 CAN):
// All 4 analog channels sit strictly on ADC1 (GPIO0..GPIO4).
static constexpr int PIN_VIB_LEFT_ADC    = 2;   // GPIO2 (ADC1_CH2) <- Left piezo MCP6002 output (KiCad PCB)
static constexpr int PIN_VIB_RIGHT_ADC   = 3;   // GPIO3 (ADC1_CH3) <- Right wheel piezo AFE (2nd wheel on axle)
static constexpr int PIN_TEMP_LEFT_ADC   = 0;   // GPIO0 (ADC1_CH0) <- Optional NTC L fallback
static constexpr int PIN_TEMP_RIGHT_ADC  = 4;   // GPIO4 (ADC1_CH4) <- Optional NTC R fallback

// Temperature & Humidity I2C Sensor GY-SHT40 (J3 connector on PCB, 0x44 / 0x45)
static constexpr int PIN_I2C_SDA         = 8;   // GPIO8 (shared with SuperMini blue LED!)
static constexpr int PIN_I2C_SCL         = 9;   // GPIO9
static constexpr uint8_t SHT40_I2C_ADDR  = 0x44;

// CAN Transceiver (SN65HVD230 / TJA1051 / MCP2562)
static constexpr int PIN_CAN_TX          = 21;  // GPIO21 -> CAN TXD (KiCad PCB)
static constexpr int PIN_CAN_RX          = 20;  // GPIO20 <- CAN RXD (KiCad PCB)

// Note: Do NOT blink GPIO8 when ENABLE_SHT40=1 because GPIO8 is shared with I2C SDA!
static constexpr int  PIN_STATUS_LED     = 8;
static constexpr bool STATUS_LED_ACTIVE_LOW = true;

#elif defined(TECHBIT_ROLE_C3_BRIDGE)

// ---- ESP32-C3 Trailer Wireless Bridge (Front wall of trailer) ----
static constexpr int PIN_CAN_TX          = 21;  // Trailer CAN bus TX
static constexpr int PIN_CAN_RX          = 20;  // Trailer CAN bus RX
static constexpr int PIN_BTN_PAIR        = 9;   // Press to force discovery/pairing beacon
static constexpr int PIN_STATUS_LED      = 8;
static constexpr bool STATUS_LED_ACTIVE_LOW = true;

#elif defined(TECHBIT_ROLE_S3_MASTER)

// ---- ESP32-S3 Master & Black Box (Strictly in Cab, NO direct analog sensors!) ----
// Avoids GPIO19..20 (USB D-/D+) and GPIO26..37 (Octal Flash / PSRAM).

// Tractor CAN bus (receives Tractor Front + Rear C3 Nodes)
static constexpr int PIN_CAN_TX          = 4;   // GPIO4 -> CAN TXD
static constexpr int PIN_CAN_RX          = 5;   // GPIO5 <- CAN RXD

// LTE Cat-1 / Cat-M1 Modem UART (SIMCom / Quectel)
static constexpr int PIN_LTE_TX          = 17;
static constexpr int PIN_LTE_RX          = 18;
static constexpr int PIN_LTE_PWRKEY      = 16;
static constexpr int PIN_LTE_RESET       = 21;

// Cabin Mini LED Indicator (Yellow / Red / Green + Wheel Code Display — NO OLED)
static constexpr int PIN_LED_GREEN       = 15;  // Normal system indicator
static constexpr int PIN_LED_YELLOW      = 7;   // Yellow pre-warning (> 60s)
static constexpr int PIN_LED_RED         = 6;   // Critical Red hazard
static constexpr int PIN_BUZZER          = 14;  // Optional critical buzzer (RED state)
static constexpr int PIN_DISP_CLK        = 12;  // Wheel code LED module (e.g. "P2-L") Clock
static constexpr int PIN_DISP_DIO        = 13;  // Wheel code LED module Data

// Service Button on S3 enclosure: enables BLE Installer Service Mode for 15 minutes
static constexpr int PIN_BTN_SERVICE     = 0;   // GPIO0 (BOOT button on S3)

#endif
