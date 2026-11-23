#pragma once

// ============================================================================
// TechBIT Hardware Architecture Pinout (Hardware Spec v2.0 — 24V Automotive)
// ============================================================================

#if defined(TECHBIT_ROLE_C3_NODE)

// ---- ESP32-C3 Unified Axle Sensor Node ----
// All 4 analog inputs strictly on ADC1 (GPIO0, GPIO1, GPIO3, GPIO4),
// leaving GPIO2/GPIO8/GPIO9 strapping safely free and GPIO5/GPIO6 for CAN.
static constexpr int PIN_VIB_LEFT_ADC    = 0;   // ADC1_CH0 <- Left wheel piezo/accelerometer AFE
static constexpr int PIN_VIB_RIGHT_ADC   = 1;   // ADC1_CH1 <- Right wheel piezo/accelerometer AFE
static constexpr int PIN_TEMP_LEFT_ADC   = 3;   // ADC1_CH3 <- Left wheel NTC temperature divider
static constexpr int PIN_TEMP_RIGHT_ADC  = 4;   // ADC1_CH4 <- Right wheel NTC temperature divider

// CAN Transceiver (TJA1051 / MCP2562 / SN65HVD230 with 24V & ESD protection)
static constexpr int PIN_CAN_TX          = 5;
static constexpr int PIN_CAN_RX          = 6;

// Status LED (active LOW on SuperMini)
static constexpr int  PIN_STATUS_LED     = 8;
static constexpr bool STATUS_LED_ACTIVE_LOW = true;

#elif defined(TECHBIT_ROLE_C3_BRIDGE)

// ---- ESP32-C3 Trailer Wireless Bridge (Front wall of trailer) ----
static constexpr int PIN_CAN_TX          = 5;   // Trailer CAN bus TX
static constexpr int PIN_CAN_RX          = 6;   // Trailer CAN bus RX
static constexpr int PIN_BTN_PAIR        = 9;   // Press to force discovery/pairing beacon
static constexpr int PIN_STATUS_LED      = 8;
static constexpr bool STATUS_LED_ACTIVE_LOW = true;

#elif defined(TECHBIT_ROLE_S3_MASTER)

// ---- ESP32-S3 Master & Black Box (Strictly in Cab, NO direct analog sensors!) ----
// Avoids GPIO19..20 (USB D-/D+) and GPIO26..37 (Octal Flash / PSRAM).

// Tractor CAN bus (receives Tractor Front + Rear C3 Nodes)
static constexpr int PIN_CAN_TX          = 4;
static constexpr int PIN_CAN_RX          = 5;

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
static constexpr int PIN_BTN_SERVICE     = 0;

#endif
