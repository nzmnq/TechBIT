#pragma once

#include <cstdint>

namespace techbit {
namespace dsp {

static constexpr uint16_t kDspFftSize   = 512;
static constexpr uint8_t  kDspLog2N     = 9;
static constexpr uint16_t kDspHalfSize  = kDspFftSize / 2;

struct VibrationFeatures {
    float    rmsMv;               // Root-mean-square vibration amplitude (mV)
    float    peakMv;              // Maximum absolute excursion from Vref (mV)
    float    crestFactor;         // peakMv / rmsMv (high > 4.2 for pothole shocks)
    float    kurtosis;            // Waveform kurtosis (~3.0 normal, > 5.5 impulsive)
    float    bandLowRatio;        // Energy fraction in 80..600 Hz
    float    bandMidRatio;        // Energy fraction in 600..2500 Hz
    float    bandHighRatio;       // Energy fraction in 2500..8000 Hz
    float    dominantFreqHz;      // Parabolic-interpolated dominant Fourier peak (Hz)
    float    spectralCentroidHz;  // Fourier spectral center of mass (Hz)
    float    tonalityRatio;       // Peak-to-mean spectral magnitude ratio
    float    zeroCrossingsHz;     // Time-domain zero-crossing oscillation estimate (Hz)
    bool     surgeClipping;       // True if signal hit input protection diodes
    float    dcOffsetMv;          // Measured virtual ground Vref (mV, ~1650 mV)
};

// Zero-heap-allocation DSP & Fourier Analyzer optimized for ESP32-C3 (no FPU) and ESP32-S3.
// Precomputes Hann window, bit-reversal indices, and FFT twiddle tables once at initialization.
class VibrationDSP {
public:
    VibrationDSP();

    void begin(float sampleRateHz, float adcMvPerCount);

    // Processes raw 12-bit ADC samples (length = kDspFftSize) and computes full time + Fourier features.
    VibrationFeatures processRawFrame(const uint16_t* rawAdc,
                                      uint16_t surgeLowThresh = 25,
                                      uint16_t surgeHighThresh = 4070);

    // Overload accepting already centered millivolt waveform (useful for unit testing & simulation).
    VibrationFeatures processCenteredMv(const float* samplesMv, bool surgeClipping = false);

    // Access latest computed single-sided magnitude spectrum (bins 0 .. kDspHalfSize - 1)
    const float* spectrumMagnitudesMv() const { return mag_; }

private:
    void computeFftInPlace();

    float    sampleRateHz_;
    float    binWidthHz_;
    float    mvPerCount_;
    bool     initialized_;

    // Precomputed lookup tables (eliminates expensive sin/cos calls in real-time loop)
    float    hann_[kDspFftSize];
    float    twCos_[kDspHalfSize];
    float    twSin_[kDspHalfSize];
    uint16_t bitRev_[kDspFftSize];

    // Static working buffers (zero heap fragmentation)
    float    re_[kDspFftSize];
    float    im_[kDspFftSize];
    float    mag_[kDspHalfSize];
};

} // namespace dsp
} // namespace techbit
