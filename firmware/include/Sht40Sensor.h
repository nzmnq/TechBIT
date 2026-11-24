#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <cstdint>

namespace techbit {

// Non-blocking I2C driver for Sensirion SHT40/SHT4x and SHT30/SHT3x modules.
// Automatically probes:
//   1. Both pin orientations: normal (SDA=GPIO8, SCL=GPIO9) and swapped (SDA=GPIO9, SCL=GPIO8),
//      since many 4-pin GY-SHT40/SHT30 breakouts order pins as VIN-GND-SCL-SDA while J3 is 3V3-GND-SDA-SCL.
//   2. Both standard I2C addresses: 0x44 and 0x45.
//   3. Both command protocols: SHT4x (0xFD, 12 ms) and SHT3x (0x24 0x00, 18 ms).
class Sht40Sensor {
public:
    Sht40Sensor()
        : primarySdaPin_(8),
          primarySclPin_(9),
          activeSdaPin_(8),
          activeSclPin_(9),
          pinsSwapped_(false),
          useSht3xCmd_(false),
          addr_(0x44),
          scanFoundAddr_(0),
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
          reprobeStep_(0),
          lastErrorCode_(0) {}

    bool begin(int sdaPin, int sclPin, uint8_t i2cAddr = 0x44, uint32_t pollIntervalMs = 500) {
        primarySdaPin_     = sdaPin;
        primarySclPin_     = sclPin;
        addr_              = i2cAddr;
        pollIntervalMs_    = (pollIntervalMs >= 50U) ? pollIntervalMs : 50U;
        measuring_         = false;
        valid_             = false;
        lastPollMs_        = 0;
        consecutiveErrors_ = 0;
        reprobeStep_       = 0;
        initialized_       = true;

        // 1. Try normal pinout (SDA=sdaPin, SCL=sclPin)
        if (probeBusOrientation(primarySdaPin_, primarySclPin_, false)) {
            return true;
        }
        // 2. Try swapped SDA/SCL pinout (SDA=sclPin, SCL=sdaPin)
        if (probeBusOrientation(primarySclPin_, primarySdaPin_, true)) {
            return true;
        }

        // Restore normal pinout as default until background reprobe runs
        configureWirePins(primarySdaPin_, primarySclPin_, false);
        return false;
    }

    void update(uint32_t nowMs) {
        if (!initialized_) return;

        if (!measuring_) {
            if (lastPollMs_ == 0 || (nowMs - lastPollMs_) >= pollIntervalMs_) {
                lastPollMs_ = nowMs;

                // If sensor has not produced valid data yet (or failed >= 2 times in a row),
                // cycle through normal/swapped pins, 0x44/0x45 addresses, and SHT4x/SHT3x commands.
                if (!valid_ && consecutiveErrors_ >= 2) {
                    autoReprobe();
                }

                Wire.beginTransmission(addr_);
                if (useSht3xCmd_) {
                    Wire.write(0x24); // SHT3x single-shot high repeatability, no clock stretching
                    Wire.write(0x00);
                } else {
                    Wire.write(0xFD); // SHT4x high-precision measurement (no heater)
                }
                uint8_t err = Wire.endTransmission();
                if (err == 0) {
                    measuring_      = true;
                    measureStartMs_ = nowMs;
                } else {
                    // If address ACKed during scan but rejected 0xFD, toggle SHT3x/SHT4x protocol immediately
                    useSht3xCmd_ = !useSht3xCmd_;
                    recordError(err);
                }
            }
        } else {
            const uint32_t waitMs = useSht3xCmd_ ? 18U : 12U;
            if ((nowMs - measureStartMs_) >= waitMs) {
                measuring_ = false;
                uint8_t got = Wire.requestFrom(addr_, static_cast<uint8_t>(6));
                if (got != 6) {
                    useSht3xCmd_ = !useSht3xCmd_;
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
                float rh = (useSht3xCmd_ ? 0.0f : -6.0f) +
                           (useSht3xCmd_ ? 100.0f : 125.0f) * (static_cast<float>(rawRh) / 65535.0f);
                if (rh < 0.0f) rh = 0.0f;
                if (rh > 100.0f) rh = 100.0f;
                humidityPct_ = rh;

                valid_             = true;
                lastSuccessMs_     = nowMs;
                consecutiveErrors_ = 0;
                lastErrorCode_     = 0;
                ++okCount_;
            }
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
    int      activeSdaPin() const { return activeSdaPin_; }
    int      activeSclPin() const { return activeSclPin_; }
    bool     pinsSwapped() const { return pinsSwapped_; }
    uint8_t  activeAddress() const { return addr_; }
    uint8_t  scanFoundAddress() const { return scanFoundAddr_; }
    const char* protocolName() const { return useSht3xCmd_ ? "SHT3x" : "SHT4x"; }

private:
    bool configureWirePins(int sda, int scl, bool swapped) {
        Wire.end();
        pinMode(sda, INPUT_PULLUP);
        pinMode(scl, INPUT_PULLUP);
        delayMicroseconds(100);
        if (!Wire.begin(sda, scl, 100000U)) {
            lastErrorCode_ = 10;
            return false;
        }
        Wire.setTimeOut(15);
        activeSdaPin_ = sda;
        activeSclPin_ = scl;
        pinsSwapped_  = swapped;
        return true;
    }

    bool probeAddress(uint8_t candidate) {
        Wire.beginTransmission(candidate);
        uint8_t err = Wire.endTransmission();
        lastErrorCode_ = err;
        return (err == 0);
    }

    bool probeBusOrientation(int sda, int scl, bool swapped) {
        if (!configureWirePins(sda, scl, swapped)) {
            return false;
        }
        const uint8_t candidates[2] = {0x44, 0x45};
        for (uint8_t c : candidates) {
            if (probeAddress(c)) {
                addr_          = c;
                scanFoundAddr_ = c;
                return true;
            }
        }
        // Quick scan across standard I2C range to help diagnose other connected sensors
        for (uint8_t a = 0x08; a <= 0x77; ++a) {
            if (probeAddress(a)) {
                scanFoundAddr_ = a;
                break;
            }
        }
        return false;
    }

    void autoReprobe() {
        // Alternate between normal (SDA=8,SCL=9) and swapped (SDA=9,SCL=8) every failed cycle
        ++reprobeStep_;
        const bool trySwapped = (reprobeStep_ & 1U) != 0U;
        const int  sda        = trySwapped ? primarySclPin_ : primarySdaPin_;
        const int  scl        = trySwapped ? primarySdaPin_ : primarySclPin_;
        probeBusOrientation(sda, scl, trySwapped);
    }

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
        if (consecutiveErrors_ < 250) {
            ++consecutiveErrors_;
        }
        if (consecutiveErrors_ >= 3) {
            valid_ = false;
        }
    }

    int      primarySdaPin_;
    int      primarySclPin_;
    int      activeSdaPin_;
    int      activeSclPin_;
    bool     pinsSwapped_;
    bool     useSht3xCmd_;
    uint8_t  addr_;
    uint8_t  scanFoundAddr_;
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
    uint8_t  reprobeStep_;
    uint8_t  lastErrorCode_;
};

} // namespace techbit
