#include "AdcDmaSampler.h"

#include <Arduino.h>
#include "esp_idf_version.h"
#include "techbit_config.h"

#if ESP_IDF_VERSION_MAJOR >= 5
#include "esp_adc/adc_continuous.h"
#else
#include "driver/adc.h"
#include "esp_adc_cal.h"
#endif

namespace techbit {

static constexpr size_t kDmaReadChunkBytes = 1024; // 256 results * 4 bytes

AdcDmaSampler::AdcDmaSampler()
    : initialized_(false),
      channel_(3),
      ntcEnabled_(false),
      ntcChannel_(4),
      latestNtcRaw_(0),
      sampleRateHz_(20000),
      mvPerCount_(kAdcFullScaleMv / static_cast<float>(kAdcMaxCounts)),
      droppedBytes_(0),
      handle_(nullptr) {}

AdcDmaSampler::~AdcDmaSampler() {
    end();
}

bool AdcDmaSampler::begin(int piezoGpioPin, uint32_t sampleRateHz, int ntcGpioPin) {
    if (initialized_) {
        end();
    }

    // On ESP32-C3, ADC1 channels 0..4 correspond directly to GPIO0..GPIO4.
    if (piezoGpioPin < 0 || piezoGpioPin > 4) {
        return false;
    }

    channel_      = static_cast<uint8_t>(piezoGpioPin);
    ntcEnabled_   = (ntcGpioPin >= 0 && ntcGpioPin <= 4 && ntcGpioPin != piezoGpioPin);
    ntcChannel_   = ntcEnabled_ ? static_cast<uint8_t>(ntcGpioPin) : 0;
    sampleRateHz_ = sampleRateHz;
    droppedBytes_ = 0;

    const uint8_t  patternCount  = ntcEnabled_ ? 2 : 1;
    const uint32_t totalScanFreq = sampleRateHz_ * patternCount;

#if ESP_IDF_VERSION_MAJOR >= 5
    adc_continuous_handle_cfg_t handleCfg = {};
    handleCfg.max_store_buf_size = 4096;
    handleCfg.conv_frame_size    = kDmaReadChunkBytes;

    adc_continuous_handle_t handle = nullptr;
    if (adc_continuous_new_handle(&handleCfg, &handle) != ESP_OK) {
        return false;
    }

    adc_digi_pattern_config_t patterns[2] = {};
    patterns[0].atten     = ADC_ATTEN_DB_12;
    patterns[0].channel   = channel_;
    patterns[0].unit      = ADC_UNIT_1;
    patterns[0].bit_width = SOC_ADC_DIGI_MAX_BITWIDTH;

    if (ntcEnabled_) {
        patterns[1].atten     = ADC_ATTEN_DB_12;
        patterns[1].channel   = ntcChannel_;
        patterns[1].unit      = ADC_UNIT_1;
        patterns[1].bit_width = SOC_ADC_DIGI_MAX_BITWIDTH;
    }

    adc_continuous_config_t digCfg = {};
    digCfg.sample_freq_hz = totalScanFreq;
    digCfg.conv_mode      = ADC_CONV_SINGLE_UNIT_1;
    digCfg.format         = ADC_DIGI_OUTPUT_FORMAT_TYPE2;
    digCfg.pattern_num    = patternCount;
    digCfg.adc_pattern    = patterns;

    if (adc_continuous_config(handle, &digCfg) != ESP_OK) {
        adc_continuous_del_handle(handle);
        return false;
    }

    if (adc_continuous_start(handle) != ESP_OK) {
        adc_continuous_del_handle(handle);
        return false;
    }

    handle_      = handle;
    mvPerCount_  = kAdcFullScaleMv / static_cast<float>(kAdcMaxCounts);
    initialized_ = true;
    return true;
#else
    adc_digi_init_config_t initCfg = {};
    initCfg.max_store_buf_size = 4096;
    initCfg.conv_num_each_intr = kDmaReadChunkBytes;
    initCfg.adc1_chan_mask     = BIT(channel_) | (ntcEnabled_ ? BIT(ntcChannel_) : 0);
    initCfg.adc2_chan_mask     = 0;

    if (adc_digi_initialize(&initCfg) != ESP_OK) {
        return false;
    }

    // In ESP-IDF 4.4 (Arduino-ESP32 2.x), ADC_UNIT_1 enum is 1, but
    // adc_digi_pattern_config_t.unit uses a 0-based index (0 = ADC1, 1 = ADC2).
    adc_digi_pattern_config_t patterns[2] = {};
    patterns[0].atten     = ADC_ATTEN_DB_12;
    patterns[0].channel   = channel_;
    patterns[0].unit      = 0;
    patterns[0].bit_width = SOC_ADC_DIGI_MAX_BITWIDTH;

    if (ntcEnabled_) {
        patterns[1].atten     = ADC_ATTEN_DB_12;
        patterns[1].channel   = ntcChannel_;
        patterns[1].unit      = 0;
        patterns[1].bit_width = SOC_ADC_DIGI_MAX_BITWIDTH;
    }

    adc_digi_configuration_t digCfg = {};
    digCfg.conv_limit_en  = false;
    digCfg.conv_limit_num = 250;
    digCfg.pattern_num    = patternCount;
    digCfg.adc_pattern    = patterns;
    digCfg.sample_freq_hz = totalScanFreq;
    digCfg.conv_mode      = ADC_CONV_SINGLE_UNIT_1;
    digCfg.format         = ADC_DIGI_OUTPUT_FORMAT_TYPE2;

    if (adc_digi_controller_configure(&digCfg) != ESP_OK) {
        adc_digi_deinitialize();
        return false;
    }

    if (adc_digi_start() != ESP_OK) {
        adc_digi_deinitialize();
        return false;
    }

    esp_adc_cal_characteristics_t calChars = {};
    esp_adc_cal_value_t calType = esp_adc_cal_characterize(
        ADC_UNIT_1, ADC_ATTEN_DB_12, ADC_WIDTH_BIT_12, 1100, &calChars);
    if (calType != ESP_ADC_CAL_VAL_NOT_SUPPORTED) {
        uint32_t mvLow  = esp_adc_cal_raw_to_voltage(1000, &calChars);
        uint32_t mvHigh = esp_adc_cal_raw_to_voltage(3000, &calChars);
        if (mvHigh > mvLow) {
            mvPerCount_ = static_cast<float>(mvHigh - mvLow) / 2000.0f;
        }
    }

    initialized_ = true;
    return true;
#endif
}

void AdcDmaSampler::end() {
    if (!initialized_) return;

#if ESP_IDF_VERSION_MAJOR >= 5
    adc_continuous_handle_t handle = static_cast<adc_continuous_handle_t>(handle_);
    if (handle) {
        adc_continuous_stop(handle);
        adc_continuous_del_handle(handle);
        handle_ = nullptr;
    }
#else
    adc_digi_stop();
    adc_digi_deinitialize();
#endif

    initialized_ = false;
}

bool AdcDmaSampler::readFrame(uint16_t* outSamples, uint16_t sampleCount, uint32_t timeoutMs) {
    if (!initialized_ || !outSamples || sampleCount == 0) {
        return false;
    }

    uint8_t  dmaBuf[kDmaReadChunkBytes];
    uint16_t collected = 0;
    uint32_t ntcSum    = 0;
    uint16_t ntcCount  = 0;
    const uint32_t startMs = millis();

    while (collected < sampleCount) {
        uint32_t elapsed = millis() - startMs;
        if (elapsed >= timeoutMs) {
            return false;
        }

        uint32_t outLen = 0;
        const uint32_t remMs = timeoutMs - elapsed;

#if ESP_IDF_VERSION_MAJOR >= 5
        esp_err_t res = adc_continuous_read(
            static_cast<adc_continuous_handle_t>(handle_),
            dmaBuf,
            sizeof(dmaBuf),
            &outLen,
            remMs);
#else
        esp_err_t res = adc_digi_read_bytes(
            dmaBuf,
            sizeof(dmaBuf),
            &outLen,
            pdMS_TO_TICKS(remMs));
#endif

        if (res == ESP_OK || res == ESP_ERR_INVALID_STATE) {
            if (res == ESP_ERR_INVALID_STATE) {
                ++droppedBytes_;
            }

            const size_t step = SOC_ADC_DIGI_RESULT_BYTES;
            for (size_t i = 0; i + step <= outLen && collected < sampleCount; i += step) {
                const auto* p = reinterpret_cast<const adc_digi_output_data_t*>(&dmaBuf[i]);
                if (p->type2.channel == channel_) {
                    outSamples[collected++] = static_cast<uint16_t>(p->type2.data & 0x0FFFU);
                } else if (ntcEnabled_ && p->type2.channel == ntcChannel_) {
                    ntcSum += static_cast<uint16_t>(p->type2.data & 0x0FFFU);
                    ++ntcCount;
                }
            }
        } else if (res == ESP_ERR_TIMEOUT) {
            return false;
        }
    }

    if (ntcEnabled_ && ntcCount > 0) {
        latestNtcRaw_ = static_cast<uint16_t>(ntcSum / ntcCount);
    }

    return true;
}

} // namespace techbit
