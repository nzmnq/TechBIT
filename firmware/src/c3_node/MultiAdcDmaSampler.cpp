#include "MultiAdcDmaSampler.h"

#include <Arduino.h>
#include "esp_idf_version.h"
#include "board_pins.h"
#include "techbit_config.h"

#if ESP_IDF_VERSION_MAJOR >= 5
#include "esp_adc/adc_continuous.h"
#else
#include "driver/adc.h"
#include "esp_adc_cal.h"
#endif

namespace techbit {

static constexpr size_t kDmaReadChunkBytes = 1024;

MultiAdcDmaSampler::MultiAdcDmaSampler()
    : initialized_(false),
      mvPerCount_(kAdcFullScaleMv / static_cast<float>(kAdcMaxCounts)),
      tempLeftRaw_(2048),
      tempRightRaw_(2048),
      handle_(nullptr) {}

MultiAdcDmaSampler::~MultiAdcDmaSampler() {
    end();
}

bool MultiAdcDmaSampler::begin(uint32_t perChannelRateHz) {
    if (initialized_) {
        end();
    }

    const uint32_t totalScanFreq = perChannelRateHz * 4U; // 4 interleaved ADC1 channels

#if ESP_IDF_VERSION_MAJOR >= 5
    adc_continuous_handle_cfg_t handleCfg = {};
    handleCfg.max_store_buf_size = 4096;
    handleCfg.conv_frame_size    = kDmaReadChunkBytes;

    adc_continuous_handle_t handle = nullptr;
    if (adc_continuous_new_handle(&handleCfg, &handle) != ESP_OK) {
        return false;
    }

    // In ESP-IDF 4.4 (Arduino-ESP32 2.x), ADC_UNIT_1 enum is 1, but
    // adc_digi_pattern_config_t.unit uses a 0-based index (0 = ADC1, 1 = ADC2).
    const int pins[4] = { PIN_VIB_LEFT_ADC, PIN_VIB_RIGHT_ADC, PIN_TEMP_LEFT_ADC, PIN_TEMP_RIGHT_ADC };
    adc_digi_pattern_config_t patterns[4] = {};
    for (int i = 0; i < 4; ++i) {
        patterns[i].atten     = ADC_ATTEN_DB_12;
        patterns[i].channel   = static_cast<uint8_t>(pins[i]);
        patterns[i].unit      = 0;
        patterns[i].bit_width = SOC_ADC_DIGI_MAX_BITWIDTH;
    }

    adc_continuous_config_t digCfg = {};
    digCfg.sample_freq_hz = totalScanFreq;
    digCfg.conv_mode      = ADC_CONV_SINGLE_UNIT_1;
    digCfg.format         = ADC_DIGI_OUTPUT_FORMAT_TYPE2;
    digCfg.pattern_num    = 4;
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
    initCfg.adc1_chan_mask     = BIT(PIN_VIB_LEFT_ADC) | BIT(PIN_VIB_RIGHT_ADC) |
                                 BIT(PIN_TEMP_LEFT_ADC) | BIT(PIN_TEMP_RIGHT_ADC);
    initCfg.adc2_chan_mask     = 0;

    if (adc_digi_initialize(&initCfg) != ESP_OK) {
        return false;
    }

    // In ESP-IDF 4.4 (Arduino-ESP32 2.x), ADC_UNIT_1 enum is 1, but
    // adc_digi_pattern_config_t.unit uses a 0-based index (0 = ADC1, 1 = ADC2).
    const int pins[4] = { PIN_VIB_LEFT_ADC, PIN_VIB_RIGHT_ADC, PIN_TEMP_LEFT_ADC, PIN_TEMP_RIGHT_ADC };
    adc_digi_pattern_config_t patterns[4] = {};
    for (int i = 0; i < 4; ++i) {
        patterns[i].atten     = ADC_ATTEN_DB_12;
        patterns[i].channel   = static_cast<uint8_t>(pins[i]);
        patterns[i].unit      = 0;
        patterns[i].bit_width = SOC_ADC_DIGI_MAX_BITWIDTH;
    }

    adc_digi_configuration_t digCfg = {};
    digCfg.conv_limit_en  = false;
    digCfg.conv_limit_num = 250;
    digCfg.pattern_num    = 4;
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

void MultiAdcDmaSampler::end() {
    if (!initialized_) return;
#if ESP_IDF_VERSION_MAJOR >= 5
    adc_continuous_handle_t handle = static_cast<adc_continuous_handle_t>(handle_);
    if (handle != nullptr) {
        adc_continuous_stop(handle);
        adc_continuous_deinitialize(handle);
        adc_continuous_del_handle(handle);
    }
    handle_ = nullptr;
#else
    adc_digi_stop();
    adc_digi_deinitialize();
#endif
    initialized_ = false;
}

bool MultiAdcDmaSampler::readAxleFrame(uint16_t* outVibLeft,
                                       uint16_t* outVibRight,
                                       uint16_t sampleCount,
                                       uint32_t timeoutMs) {
    if (!initialized_ || !outVibLeft || !outVibRight || sampleCount == 0) {
        return false;
    }

    uint16_t countL = 0;
    uint16_t countR = 0;
    const uint32_t startMs = millis();
    uint8_t dmaBuf[kDmaReadChunkBytes];

    while (countL < sampleCount || countR < sampleCount) {
        const uint32_t elapsed = millis() - startMs;
        if (elapsed >= timeoutMs) {
            return false;
        }

        uint32_t bytesRead = 0;
        const uint32_t waitLeft = timeoutMs - elapsed;

#if ESP_IDF_VERSION_MAJOR >= 5
        adc_continuous_handle_t handle = static_cast<adc_continuous_handle_t>(handle_);
        esp_err_t err = adc_continuous_read(handle, dmaBuf, sizeof(dmaBuf), &bytesRead, waitLeft);
#else
        esp_err_t err = adc_digi_read_bytes(dmaBuf, sizeof(dmaBuf), &bytesRead,
                                            pdMS_TO_TICKS(waitLeft > 25 ? 25 : waitLeft));
#endif
        if (err != ESP_OK && err != ESP_ERR_TIMEOUT) {
            return false;
        }

        const size_t numItems = bytesRead / SOC_ADC_DIGI_RESULT_BYTES;
        for (size_t i = 0; i < numItems; ++i) {
            const auto* item = reinterpret_cast<const adc_digi_output_data_t*>(
                &dmaBuf[i * SOC_ADC_DIGI_RESULT_BYTES]);
            const uint8_t ch   = item->type2.channel;
            const uint16_t val = static_cast<uint16_t>(item->type2.data & 0x0FFFU);

            if (ch == static_cast<uint8_t>(PIN_VIB_LEFT_ADC) && countL < sampleCount) {
                outVibLeft[countL++] = val;
            } else if (ch == static_cast<uint8_t>(PIN_VIB_RIGHT_ADC) && countR < sampleCount) {
                outVibRight[countR++] = val;
            } else if (ch == static_cast<uint8_t>(PIN_TEMP_LEFT_ADC)) {
                tempLeftRaw_ = static_cast<uint16_t>((tempLeftRaw_ * 7U + val) / 8U);
            } else if (ch == static_cast<uint8_t>(PIN_TEMP_RIGHT_ADC)) {
                tempRightRaw_ = static_cast<uint16_t>((tempRightRaw_ * 7U + val) / 8U);
            }
        }
    }

    return true;
}

} // namespace techbit
