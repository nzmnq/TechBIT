#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <cstdint>

namespace techbit {

// Non-blocking I2C driver for Sensirion SHT40 (GY-SHT40 module, default addr 0x44).
// Uses a state machine (trigger 0xFD -> wait 12 ms -> read 6 bytes + CRC-8 check)
// so it never stalls the 20 kSPS DMA ADC vibration sampling loop.
class Sht40Sensor {
public:
    Sht40Sensor()
        : addr_(0x44),
          pollIntervalMs_(500),
          initialized_(false),
          measuring_(false),
          valid_(false),
          tempC_(0.0f),
          humidityPct_(0.0f),
          lastPollMs_(0),
          measureStartMs_(0),
          lastSuccessMs_(0),
          okCount_(0),
          errCount_(0),
          consecutiveErrors_(0),
          lastErrorCode_(0) {}

    bool begin(int sdaPin, int sclPin, uint8_t i2cAddr = 0x44, uint32_t pollIntervalMs = 500) {
        addr_           = i2cAddr;
        pollIntervalMs_ = (pollIntervalMs >= 50U) ? pollIntervalMs : 50U;
        measuring_      = false;
        valid_          = false;
        lastPollMs_     = 0;
        consecutiveErrors_ = 0;

        if (!Wire.begin(sdaPin, sclPin)) {
            initialized_   = false;
            lastErrorCode_ = 10;
            return false;
        }
        Wire.setClock(100000U); // 100 kHz standard I2C for reliable cable runs to J3
        Wire.setTimeOut(15);    // Prevent I2C lockups from stalling ADC DMA

        // Quick probe to verify sensor presence on bus
        Wire.beginTransmission(addr_);
        uint8_t err = Wire.endTransmission();
        lastErrorCode_ = err;
        initialized_   = true;
        return (err == 0);
    }

    void update(uint32_t nowMs) {
        if (!initialized_) return;

        if (!measuring_) {
            if (lastPollMs_ == 0 || (nowMs - lastPollMs_) >= pollIntervalMs_) {
                lastPollMs_ = nowMs;
                Wire.beginTransmission(addr_);
                Wire.write(0xFD); // High-precision measurement (no heater)
                uint8_t err = Wire.endTransmission();
                if (err == 0) {
                    measuring_      = true;
                    measureStartMs_ = nowMs;
                } else {
                    recordError(err);
                }
            }
        } else if ((nowMs - measureStartMs_) >= 12U) {
            measuring_ = false;
            uint8_t got = Wire.requestFrom(addr_, static_cast<uint8_t>(6));
            if (got != 6) {
                recordError(11);
                return;
            }

            uint8_t buf[6];
            for (uint8_t i = 0; i < 6; ++i) {
                buf[i] = static_cast<uint8_t>(Wire.read());
            }

            if (crc8(buf, 2) != buf[2] || crc8(&buf[3], 2) != buf[5]) {
                recordError(12); // CRC mismatch
                return;
            }

            const uint16_t rawT  = (static_cast<uint16_t>(buf[0]) << 8) | buf[1];
            const uint16_t rawRh = (static_cast<uint16_t>(buf[3]) << 8) | buf[4];

            tempC_ = -45.0f + 175.0f * (static_cast<float>(rawT) / 65535.0f);
            float rh = -6.0f + 125.0f * (static_cast<float>(rawRh) / 65535.0f);
            if (rh < 0.0f) rh = 0.0f;
            if (rh > 100.0f) rh = 100.0f;
            humidityPct_ = rh;

            valid_             = true;
            lastSuccessMs_     = nowMs;
            consecutiveErrors_ = 0;
            lastErrorCode_     = 0;
            ++okCount_;
        }

        // Expire stale reading if sensor disconnected > 3 s
        if (valid_ && (nowMs - lastSuccessMs_) > 3000U) {
            valid_ = false;
        }
    }

    bool     isInitialized() const { return initialized_; }
    bool     isValid() const { return valid_; }
    float    tempC() const { return tempC_; }
    float    humidityPct() const { return humidityPct_; }
    uint32_t okCount() const { return okCount_; }
    uint32_t errCount() const { return errCount_; }
    uint8_t  lastError() const { return lastErrorCode_; }

private:
    static uint8_t crc8(const uint8_t* data, uint8_t len) {
        uint8_t crc = 0xFF;
        for (uint8_t i = 0; i < len; ++i) {
            crc ^= data[i];
            for (uint8_t b = 0; b < 8; ++b) {
                crc = (crc & 0x80U) ? static_cast<uint8_t>((crc << 1) ^ 0x31U)
                                    : static_cast<uint8_t>(crc << 1);
            }
        }
        return crc;
    }

    void recordError(uint8_t code) {
        lastErrorCode_ = code;
        ++errCount_;
        ++consecutiveErrors_;
        if (consecutiveErrors_ >= 3) {
            valid_ = false;
        }
    }

    uint8_t  addr_;
    uint32_t pollIntervalMs_;
    bool     initialized_;
    bool     measuring_;
    bool     valid_;
    float    tempC_;
    float    humidityPct_;
    uint32_t lastPollMs_;
    uint32_t measureStartMs_;
    uint32_t lastSuccessMs_;
    uint32_t okCount_;
    uint32_t errCount_;
    uint8_t  consecutiveErrors_;
    uint8_t  lastErrorCode_;
};

} // namespace techbit
