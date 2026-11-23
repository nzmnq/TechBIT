#include "CanBusManager.h"

#if defined(ESP32) || defined(ARDUINO_ARCH_ESP32)

#include <Arduino.h>
#include <cstring>
#include "driver/twai.h"

namespace techbit {

CanBusManager::CanBusManager()
    : ready_(false),
      recovering_(false),
      txCount_(0),
      rxCount_(0),
      txErrorCount_(0),
      busOffRecoveries_(0) {}

bool CanBusManager::begin(int txPin, int rxPin, bool noAckLoopback) {
    if (ready_) {
        end();
    }

    twai_general_config_t gCfg = TWAI_GENERAL_CONFIG_DEFAULT(
        static_cast<gpio_num_t>(txPin),
        static_cast<gpio_num_t>(rxPin),
        noAckLoopback ? TWAI_MODE_NO_ACK : TWAI_MODE_NORMAL);

    gCfg.rx_queue_len = 24;
    gCfg.tx_queue_len = 12;

    twai_timing_config_t tCfg = TWAI_TIMING_CONFIG_500KBITS();
    twai_filter_config_t fCfg = TWAI_FILTER_CONFIG_ACCEPT_ALL();

    if (twai_driver_install(&gCfg, &tCfg, &fCfg) != ESP_OK) {
        return false;
    }

    if (twai_start() != ESP_OK) {
        twai_driver_uninstall();
        return false;
    }

    ready_      = true;
    recovering_ = false;
    return true;
}

void CanBusManager::end() {
    if (!ready_) return;
    twai_stop();
    twai_driver_uninstall();
    ready_      = false;
    recovering_ = false;
}

bool CanBusManager::sendFrame(uint32_t stdId, const uint8_t data[8], uint8_t dlc) {
    if (!ready_) return false;

    twai_message_t msg = {};
    msg.identifier       = stdId & 0x7FFU;
    msg.extd             = 0;
    msg.rtr              = 0;
    msg.ss               = 1; // Single-shot avoids blocking retry flood if peer is temporarily offline
    msg.data_length_code = (dlc > 8) ? 8 : dlc;
    std::memcpy(msg.data, data, msg.data_length_code);

    if (twai_transmit(&msg, 0) == ESP_OK) {
        ++txCount_;
        return true;
    }

    ++txErrorCount_;
    return false;
}

bool CanBusManager::receiveFrame(CanFrame& outFrame) {
    if (!ready_) return false;

    twai_message_t msg = {};
    if (twai_receive(&msg, 0) != ESP_OK) {
        return false;
    }

    if (msg.extd || msg.rtr) {
        return false;
    }

    outFrame.id  = msg.identifier;
    outFrame.dlc = msg.data_length_code;
    std::memset(outFrame.data, 0, sizeof(outFrame.data));
    if (msg.data_length_code > 0) {
        const uint8_t copyLen = (msg.data_length_code > 8) ? 8 : msg.data_length_code;
        std::memcpy(outFrame.data, msg.data, copyLen);
    }

    ++rxCount_;
    return true;
}

void CanBusManager::serviceRecovery() {
    if (!ready_) return;

    twai_status_info_t st = {};
    if (twai_get_status_info(&st) != ESP_OK) {
        return;
    }

    if (st.state == TWAI_STATE_BUS_OFF && !recovering_) {
        if (twai_initiate_recovery() == ESP_OK) {
            recovering_ = true;
        }
    } else if (st.state == TWAI_STATE_STOPPED) {
        if (twai_start() == ESP_OK) {
            recovering_ = false;
            ++busOffRecoveries_;
        }
    } else if (st.state == TWAI_STATE_RUNNING) {
        recovering_ = false;
    }
}

} // namespace techbit

#endif // ESP32
