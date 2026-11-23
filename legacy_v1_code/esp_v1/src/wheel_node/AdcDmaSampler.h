#pragma once

#include <cstdint>

namespace techbit {

// Hardware continuous DMA ADC sampler for ESP32-C3 (ADC1 @ 20 kSPS).
// Supports optional second ADC1 channel for NTC thermistor inside the same DMA scan
// so analogRead() never conflicts with the hardware DMA ADC controller.
class AdcDmaSampler {
public:
    AdcDmaSampler();
    ~AdcDmaSampler();

    bool begin(int piezoGpioPin, uint32_t sampleRateHz, int ntcGpioPin = -1);
    void end();

    // Blocking read (up to timeoutMs) until `sampleCount` piezo samples are collected.
    bool readFrame(uint16_t* outSamples, uint16_t sampleCount, uint32_t timeoutMs = 100);

    float    mvPerCount() const { return mvPerCount_; }
    uint32_t droppedBytes() const { return droppedBytes_; }
    bool     hasNtc() const { return ntcEnabled_; }
    uint16_t latestNtcRaw() const { return latestNtcRaw_; }

private:
    bool     initialized_;
    uint8_t  channel_;
    bool     ntcEnabled_;
    uint8_t  ntcChannel_;
    uint16_t latestNtcRaw_;
    uint32_t sampleRateHz_;
    float    mvPerCount_;
    uint32_t droppedBytes_;
    void*    handle_;
};

} // namespace techbit
