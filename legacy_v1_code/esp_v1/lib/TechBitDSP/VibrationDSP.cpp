#include "VibrationDSP.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace techbit {
namespace dsp {

static constexpr float kPi = 3.14159265358979323846f;

VibrationDSP::VibrationDSP()
    : sampleRateHz_(20000.0f),
      binWidthHz_(20000.0f / static_cast<float>(kDspFftSize)),
      mvPerCount_(2550.0f / 4095.0f),
      initialized_(false) {
    std::memset(hann_, 0, sizeof(hann_));
    std::memset(twCos_, 0, sizeof(twCos_));
    std::memset(twSin_, 0, sizeof(twSin_));
    std::memset(bitRev_, 0, sizeof(bitRev_));
    std::memset(re_, 0, sizeof(re_));
    std::memset(im_, 0, sizeof(im_));
    std::memset(mag_, 0, sizeof(mag_));
}

void VibrationDSP::begin(float sampleRateHz, float adcMvPerCount) {
    sampleRateHz_ = sampleRateHz;
    binWidthHz_   = sampleRateHz_ / static_cast<float>(kDspFftSize);
    mvPerCount_   = adcMvPerCount;

    // Precompute Hann window
    for (uint16_t n = 0; n < kDspFftSize; ++n) {
        hann_[n] = 0.5f * (1.0f - std::cos((2.0f * kPi * static_cast<float>(n)) /
                                            static_cast<float>(kDspFftSize - 1)));
    }

    // Precompute FFT twiddle factors W_N^k = cos(-2*pi*k/N) + j*sin(-2*pi*k/N)
    for (uint16_t k = 0; k < kDspHalfSize; ++k) {
        float angle = -2.0f * kPi * static_cast<float>(k) / static_cast<float>(kDspFftSize);
        twCos_[k] = std::cos(angle);
        twSin_[k] = std::sin(angle);
    }

    // Precompute bit-reversal permutation table
    for (uint16_t i = 0; i < kDspFftSize; ++i) {
        uint16_t x = i;
        uint16_t r = 0;
        for (uint8_t b = 0; b < kDspLog2N; ++b) {
            r = static_cast<uint16_t>((r << 1) | (x & 1U));
            x >>= 1;
        }
        bitRev_[i] = r;
    }

    initialized_ = true;
}

void VibrationDSP::computeFftInPlace() {
    // Bit-reversal reorder
    for (uint16_t i = 0; i < kDspFftSize; ++i) {
        uint16_t j = bitRev_[i];
        if (i < j) {
            std::swap(re_[i], re_[j]);
            std::swap(im_[i], im_[j]);
        }
    }

    // Iterative Radix-2 Cooley-Tukey FFT using precomputed twiddle LUT
    for (uint16_t len = 2; len <= kDspFftSize; len <<= 1) {
        const uint16_t half = len >> 1;
        const uint16_t step = kDspFftSize / len;

        for (uint16_t base = 0; base < kDspFftSize; base += len) {
            uint16_t twIdx = 0;
            for (uint16_t j = 0; j < half; ++j) {
                const uint16_t i0 = base + j;
                const uint16_t i1 = i0 + half;

                const float wr = twCos_[twIdx];
                const float wi = twSin_[twIdx];

                const float tr = wr * re_[i1] - wi * im_[i1];
                const float ti = wr * im_[i1] + wi * re_[i1];

                re_[i1] = re_[i0] - tr;
                im_[i1] = im_[i0] - ti;
                re_[i0] += tr;
                im_[i0] += ti;

                twIdx += step;
            }
        }
    }
}

VibrationFeatures VibrationDSP::processRawFrame(const uint16_t* rawAdc,
                                                uint16_t surgeLowThresh,
                                                uint16_t surgeHighThresh) {
    if (!initialized_) {
        begin(sampleRateHz_, mvPerCount_);
    }

    float centered[kDspFftSize];
    uint32_t sumRaw = 0;
    bool clipped = false;

    for (uint16_t n = 0; n < kDspFftSize; ++n) {
        const uint16_t v = rawAdc[n];
        sumRaw += v;
        if (v <= surgeLowThresh || v >= surgeHighThresh) {
            clipped = true;
        }
    }

    const float meanCounts = static_cast<float>(sumRaw) / static_cast<float>(kDspFftSize);
    for (uint16_t n = 0; n < kDspFftSize; ++n) {
        centered[n] = (static_cast<float>(rawAdc[n]) - meanCounts) * mvPerCount_;
    }

    VibrationFeatures f = processCenteredMv(centered, clipped);
    f.dcOffsetMv = meanCounts * mvPerCount_;
    return f;
}

VibrationFeatures VibrationDSP::processCenteredMv(const float* samplesMv, bool surgeClipping) {
    if (!initialized_) {
        begin(sampleRateHz_, mvPerCount_);
    }

    VibrationFeatures out{};
    out.surgeClipping = surgeClipping;
    out.dcOffsetMv    = 0.0f;

    double sumSq   = 0.0;
    double sumQuad = 0.0;
    float  peak    = 0.0f;
    uint16_t zeroCrossings = 0;
    float  prevSample = samplesMv[0];

    // 1. Time-domain moments, peak, zero-crossings & Hann windowing into FFT buffers
    for (uint16_t n = 0; n < kDspFftSize; ++n) {
        const float s  = samplesMv[n];
        const float s2 = s * s;
        sumSq   += static_cast<double>(s2);
        sumQuad += static_cast<double>(s2 * s2);

        const float absS = std::fabs(s);
        if (absS > peak) {
            peak = absS;
        }

        if (n > 0) {
            if ((prevSample <= 0.0f && s > 0.0f) || (prevSample > 0.0f && s <= 0.0f)) {
                ++zeroCrossings;
            }
        }
        prevSample = s;

        re_[n] = s * hann_[n];
        im_[n] = 0.0f;
    }

    const float variance = static_cast<float>(sumSq / static_cast<double>(kDspFftSize));
    out.rmsMv            = std::sqrt(variance);
    out.peakMv           = peak;
    out.crestFactor      = (out.rmsMv > 0.5f) ? (peak / out.rmsMv) : 1.0f;
    out.kurtosis         = (variance > 0.25f)
                               ? static_cast<float>((sumQuad / static_cast<double>(kDspFftSize)) /
                                                    (static_cast<double>(variance) * static_cast<double>(variance)))
                               : 3.0f;
    const float frameDurationSec = static_cast<float>(kDspFftSize) / sampleRateHz_;
    out.zeroCrossingsHz  = (static_cast<float>(zeroCrossings) * 0.5f) / frameDurationSec;

    // 2. Run Radix-2 Cooley-Tukey FFT
    computeFftInPlace();

    // 3. Single-sided magnitude spectrum (compensate Hann coherent gain = 0.5, single-sided = 2.0)
    const float ampScale = 4.0f / static_cast<float>(kDspFftSize);
    mag_[0] = 0.0f; // DC removed
    for (uint16_t k = 1; k < kDspHalfSize; ++k) {
        mag_[k] = ampScale * std::sqrt(re_[k] * re_[k] + im_[k] * im_[k]);
    }

    // 4. Fourier band powers (80..600 Hz, 600..2500 Hz, 2500..8000 Hz)
    uint16_t kLowStart  = static_cast<uint16_t>(std::max(2.0f, std::ceil(80.0f / binWidthHz_)));
    uint16_t kLowEnd    = static_cast<uint16_t>(std::floor(600.0f / binWidthHz_));
    uint16_t kMidEnd    = static_cast<uint16_t>(std::floor(2500.0f / binWidthHz_));
    uint16_t kHighEnd   = static_cast<uint16_t>(
        std::min(static_cast<float>(kDspHalfSize - 2), std::floor(8000.0f / binWidthHz_)));

    float powLow  = 0.0f;
    float powMid  = 0.0f;
    float powHigh = 0.0f;
    float sumMag  = 0.0f;
    float weightedFreqSum = 0.0f;
    float maxMag  = 0.0f;
    uint16_t peakBin = kLowStart;

    for (uint16_t k = kLowStart; k <= kHighEnd; ++k) {
        const float m = mag_[k];
        const float p = m * m;
        const float fk = static_cast<float>(k) * binWidthHz_;

        sumMag += m;
        weightedFreqSum += fk * m;

        if (m > maxMag) {
            maxMag  = m;
            peakBin = k;
        }

        if (k <= kLowEnd) {
            powLow += p;
        } else if (k <= kMidEnd) {
            powMid += p;
        } else {
            powHigh += p;
        }
    }

    const float totalPow = powLow + powMid + powHigh;
    if (totalPow > 1e-6f && out.rmsMv > 0.5f) {
        out.bandLowRatio  = powLow / totalPow;
        out.bandMidRatio  = powMid / totalPow;
        out.bandHighRatio = powHigh / totalPow;
    } else {
        out.bandLowRatio  = 0.34f;
        out.bandMidRatio  = 0.33f;
        out.bandHighRatio = 0.33f;
    }

    const uint16_t activeBins = (kHighEnd >= kLowStart) ? (kHighEnd - kLowStart + 1) : 1;
    const float meanMag = sumMag / static_cast<float>(activeBins);

    if (sumMag > 1e-4f && out.rmsMv > 0.5f) {
        out.spectralCentroidHz = weightedFreqSum / sumMag;
        out.tonalityRatio      = (meanMag > 1e-5f) ? (maxMag / meanMag) : 1.0f;

        // Parabolic interpolation around peakBin for sub-bin dominant frequency accuracy
        float delta = 0.0f;
        if (peakBin > kLowStart && peakBin < kHighEnd) {
            const float y0 = mag_[peakBin - 1];
            const float y1 = mag_[peakBin];
            const float y2 = mag_[peakBin + 1];
            const float denom = y0 - 2.0f * y1 + y2;
            if (std::fabs(denom) > 1e-6f) {
                delta = 0.5f * (y0 - y2) / denom;
                if (delta > 0.5f) delta = 0.5f;
                if (delta < -0.5f) delta = -0.5f;
            }
        }
        out.dominantFreqHz = (static_cast<float>(peakBin) + delta) * binWidthHz_;
    } else {
        out.spectralCentroidHz = 0.0f;
        out.tonalityRatio      = 1.0f;
        out.dominantFreqHz     = 0.0f;
    }

    return out;
}

} // namespace dsp
} // namespace techbit
