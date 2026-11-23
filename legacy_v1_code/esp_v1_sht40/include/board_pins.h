#pragma once

// ============================================================================
// TechBIT Hardware Pin Mapping (ESP32-C3 SuperMini)
// ============================================================================
// Aligned with actual PCB (Scheme/kicad/Wheel_Sensor_Amplifier.kicad_pcb)
// and physical ESP32-C3 SuperMini wiring.

#if defined(TECHBIT_ROLE_WHEEL)

// ---- ESP32-C3 SuperMini (Wheel Node) ----
// ADC1 channels only (GPIO0..GPIO4). GPIO5 is ADC2 and must NOT be used for DMA ADC.
static constexpr int PIN_PIEZO_ADC       = 2;   // GPIO2 (ADC1_CH2) <- Output of MCP6002 RC LPF (R5/C4, Vref ~1.65V)
static constexpr int PIN_NTC_ADC         = 4;   // GPIO4 (ADC1_CH4) <- Optional legacy NTC divider (-DENABLE_NTC_TEMP=1)

// Temperature & Humidity Sensor GY-SHT40 (J3 connector, I2C address 0x44)
static constexpr int PIN_I2C_SDA         = 8;   // GPIO8 (ESP32-C3 pin 8) -> GY-SHT40 SDA (shared with onboard LED!)
static constexpr int PIN_I2C_SCL         = 9;   // GPIO9 (ESP32-C3 pin 9) -> GY-SHT40 SCL
static constexpr uint8_t SHT40_I2C_ADDR  = 0x44;

// TWAI (CAN Bus) -> SN65HVD230 Transceiver (MOD2)
static constexpr int PIN_CAN_TX          = 21;  // GPIO21 -> SN65HVD230 D (TXD)
static constexpr int PIN_CAN_RX          = 20;  // GPIO20 <- SN65HVD230 R (RXD)

// Optional Solder Jumpers / DIP switch to set Wheel ID (0..3) in hardware.
// Leave unconnected (pulled HIGH internally) to use compile-time WHEEL_NODE_ID or NVS override.
static constexpr int PIN_ID_BIT0         = 3;   // GPIO3 (LSB)
static constexpr int PIN_ID_BIT1         = 10;  // GPIO10 (MSB)
static constexpr int PIN_ID_ENABLE       = 1;   // GPIO1 pulled LOW externally -> enables DIP ID override

// IMPORTANT HARDWARE NUANCE:
// On ESP32-C3 SuperMini, the onboard blue LED is wired to GPIO8 — the SAME pin as I2C SDA!
// When GY-SHT40 (ENABLE_SHT40) is enabled, LED blinking MUST be disabled so SDA is not corrupted.
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
static constexpr int PIN_BTN_CALIBRATE   = 0;   // GPIO0 (BOOT button on ESP32-S3) -> Hold 1.5s to calibrate

// Optional ACC Ignition Voltage Sense (via resistor divider 12V/24V -> max 3.3V)
static constexpr int PIN_ACC_SENSE       = 1;   // GPIO1 (optional ignition monitor)

#endif
