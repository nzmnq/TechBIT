#pragma once

#include <cstdint>

namespace techbit {

// Continuous 4-channel ADC1 DMA sampler for unified ESP32-C3 Axle Node:
// Scans Left Vib (GPIO0), Right Vib (GPIO1), Left Temp (GPIO3), Right Temp (GPIO4)
// in one hardware DMA stream without channel switching glitches.
class MultiAdcDmaSampler {
public:
    MultiAdcDmaSampler();
    ~MultiAdcDmaSampler();

    bool begin(uint32_t perChannelRateHz = 10000);
    void end();

    // Reads `sampleCount` samples for BOTH Left and Right vibration channels
    // while updating smoothed raw NTC counts for both Left and Right temperatures.
    bool readAxleFrame(uint16_t* outVibLeft,
                       uint16_t* outVibRight,
                       uint16_t sampleCount,
                       uint32_t timeoutMs = 100);

    float    mvPerCount() const { return mvPerCount_; }
    uint16_t tempLeftRaw() const { return tempLeftRaw_; }
    uint16_t tempRightRaw() const { return tempRightRaw_; }

private:
    bool     initialized_;
    float    mvPerCount_;
    uint16_t tempLeftRaw_;
    uint16_t tempRightRaw_;
    void*    handle_;
};

} // namespace techbit
