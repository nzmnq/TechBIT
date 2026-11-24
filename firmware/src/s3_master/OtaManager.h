#pragma once

#include <Arduino.h>
#include <Update.h>
#include "esp_ota_ops.h"

namespace techbit {

// Over-The-Air update helper with ESP-IDF bootloader rollback confirmation (Software Spec 3.3 #6).
class OtaManager {
public:
    static void confirmAppValidAfterSelfTest() {
        const esp_partition_t* running = esp_ota_get_running_partition();
        esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
        if (running && esp_ota_get_state_partition(running, &state) == ESP_OK) {
            if (state == ESP_OTA_IMG_PENDING_VERIFY) {
                esp_ota_mark_app_valid_cancel_rollback();
                Serial.println("[OTA] New firmware self-test passed; rollback cancelled.");
            }
        }
    }

    static bool beginStreamedOta(size_t imageSize) {
        if (imageSize == 0) return false;
        return Update.begin(imageSize);
    }

    static bool writeChunk(uint8_t* data, size_t len) {
        return Update.write(data, len) == len;
    }

    static bool finalizeAndReboot() {
        if (Update.end(true)) {
            Serial.println("[OTA] Firmware flash complete. Rebooting...");
            delay(200);
            ESP.restart();
            return true;
        }
        return false;
    }
};

} // namespace techbit
