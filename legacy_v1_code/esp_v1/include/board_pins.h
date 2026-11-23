#pragma once

// ============================================================================
// TechBIT Hardware Pin Mapping
// ============================================================================
// Verify these pin definitions against your KiCad/breadboard wiring before flashing.

#if defined(TECHBIT_ROLE_WHEEL)

// ---- ESP32-C3 SuperMini (Wheel Node) ----
// ADC1 channels only (GPIO0..GPIO4). Do NOT use GPIO5 for continuous DMA ADC
// because GPIO5 is ADC2 on ESP32-C3.
static constexpr int PIN_PIEZO_ADC       = 3;   // GPIO3 (ADC1_CH3) <- Output of MCP6002 RC LPF (R5/C4)
static constexpr int PIN_NTC_ADC         = 4;   // GPIO4 (ADC1_CH4) <- Optional NTC temperature divider

// TWAI (CAN Bus) -> SN65HVD230 Transceiver
static constexpr int PIN_CAN_TX          = 5;   // GPIO5 -> SN65HVD230 D (TXD)
static constexpr int PIN_CAN_RX          = 6;   // GPIO6 <- SN65HVD230 R (RXD)

// Optional Solder Jumpers / DIP switch to set Wheel ID (0..3) in hardware.
// Leave unconnected (pulled HIGH internally) to use compile-time WHEEL_NODE_ID.
static constexpr int PIN_ID_BIT0         = 7;   // GPIO7 (LSB)
static constexpr int PIN_ID_BIT1         = 10;  // GPIO10 (MSB)
static constexpr int PIN_ID_ENABLE       = 2;   // GPIO2 pulled LOW externally -> enables DIP ID override

// Onboard blue LED on ESP32-C3 SuperMini is GPIO8 (active LOW)
static constexpr int PIN_STATUS_LED      = 8;
static constexpr bool STATUS_LED_ACTIVE_LOW = true;

#elif defined(TECHBIT_ROLE_CENTRAL)

// ---- ESP32-S3 (Central Hub / Analytics Controller) ----
// Safe GPIOs avoiding Octal Flash/PSRAM pins (GPIO26..37) and USB D-/D+ (GPIO19..20).

// TWAI (CAN Bus) -> SN65HVD230 Transceiver
static constexpr int PIN_CAN_TX          = 4;   // GPIO4 -> SN65HVD230 D (TXD)
static constexpr int PIN_CAN_RX          = 5;   // GPIO5 <- SN65HVD230 R (RXD)

// Driver Warning Outputs (Dashboard Indicator & Buzzer)
static constexpr int PIN_BUZZER_ALERT    = 6;   // GPIO6 -> Active buzzer / relay trigger (HIGH = alert)
static constexpr int PIN_LED_FAULT       = 7;   // GPIO7 -> Red "Check Service / ТО" warning LED
static constexpr int PIN_LED_OK          = 15;  // GPIO15 -> Green "System Normal" LED
static constexpr int PIN_BTN_CALIBRATE   = 0;   // GPIO0 (BOOT button) -> Press to start 5s calibration

// Optional ACC Ignition Voltage Sense (via resistor divider 12V/24V -> max 3.3V)
static constexpr int PIN_ACC_SENSE       = 1;   // GPIO1 (optional ignition monitor)

#endif
