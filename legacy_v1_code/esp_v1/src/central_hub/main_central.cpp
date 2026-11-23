#include <Arduino.h>
#include <cstring>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#include "CanBusManager.h"
#include "NvsCalibration.h"
#include "WheelClassifier.h"
#include "board_pins.h"
#include "can_protocol.h"
#include "techbit_config.h"

using namespace techbit;

namespace {

enum OutputMode : uint8_t {
    OUT_HUMAN = 0,
    OUT_CSV   = 1,
    OUT_JSON  = 2
};

CanBusManager       g_can;
ml::WheelClassifier g_classifier;
NvsCalibration      g_nvs;
QueueHandle_t       g_canRxQueue     = nullptr;

OutputMode          g_outputMode     = OUT_HUMAN;
uint32_t            g_lastEvalMs     = 0;
uint32_t            g_lastPrintMs    = 0;
uint32_t            g_btnDownMs      = 0;
bool                g_btnPressed     = false;
bool                g_btnLongHandled = false;
ml::SystemAlertLevel g_prevAlert     = ml::ALERT_OK;
char                g_cmdBuf[64];
size_t              g_cmdLen         = 0;

// Core 0 FreeRTOS task: continuously drains TWAI hardware RX FIFO into lock-free queue
void canRxTask(void* /*param*/) {
    CanFrame frame{};
    for (;;) {
        while (g_can.receiveFrame(frame)) {
            if (g_canRxQueue != nullptr) {
                xQueueSend(g_canRxQueue, &frame, 0);
            }
        }
        g_can.serviceRecovery();
        vTaskDelay(pdMS_TO_TICKS(2));
    }
}

void triggerCalibration() {
    const uint32_t now = millis();
    g_classifier.startCalibration(now, kCalibrationDurationMs);

    uint8_t cmd[8] = {};
    cmd[0] = can::CMD_START_CALIB;
    g_can.sendFrame(can::kCanIdHubCommand, cmd, 8);

    Serial.printf("\n[TechBIT Hub] Started %lu-second smooth-road baseline calibration...\n",
                  static_cast<unsigned long>(kCalibrationDurationMs / 1000U));
}

void updateHardwareIndicators(const ml::SystemSummary& sum, uint32_t nowMs) {
    if (sum.calibrating) {
        // Fast alternating blink while calibrating
        bool phase = ((nowMs / 150U) % 2U) == 0U;
        digitalWrite(PIN_LED_OK, phase ? HIGH : LOW);
        digitalWrite(PIN_LED_FAULT, phase ? LOW : HIGH);
        digitalWrite(PIN_BUZZER_ALERT, LOW);
        return;
    }

    switch (sum.alertLevel) {
        case ml::ALERT_SERVICE_TO: {
            digitalWrite(PIN_LED_OK, LOW);
            digitalWrite(PIN_LED_FAULT, HIGH);
            // Pulsed warning beep (200 ms ON / 800 ms OFF) unless muted by driver
            bool beepOn = (!sum.buzzerMuted) && ((nowMs % 1000U) < 200U);
            digitalWrite(PIN_BUZZER_ALERT, beepOn ? HIGH : LOW);
            break;
        }
        case ml::ALERT_WARNING: {
            digitalWrite(PIN_LED_OK, HIGH);
            digitalWrite(PIN_LED_FAULT, ((nowMs / 250U) % 2U) == 0U ? HIGH : LOW);
            digitalWrite(PIN_BUZZER_ALERT, LOW);
            break;
        }
        case ml::ALERT_BAD_ROAD: {
            // Cobblestone / axle bump / pothole noise safely suppressed
            digitalWrite(PIN_LED_OK, HIGH);
            digitalWrite(PIN_LED_FAULT, LOW);
            digitalWrite(PIN_BUZZER_ALERT, LOW);
            break;
        }
        case ml::ALERT_OK:
        default: {
            bool sensorDegraded = (sum.offlineWheelMask != 0U || sum.deadSensorMask != 0U);
            if (sum.activeWheelCount == 0U) {
                digitalWrite(PIN_LED_OK, ((nowMs / 600U) % 2U) == 0U ? HIGH : LOW);
            } else if (sensorDegraded) {
                // Fast blink OK LED if one wheel dropped offline or has a dead piezo
                digitalWrite(PIN_LED_OK, ((nowMs / 200U) % 2U) == 0U ? HIGH : LOW);
            } else {
                digitalWrite(PIN_LED_OK, HIGH);
            }
            digitalWrite(PIN_LED_FAULT, LOW);
            digitalWrite(PIN_BUZZER_ALERT, LOW);
            break;
        }
    }
}

void printHumanDashboard(const ml::SystemSummary& sum) {
    const char* alertStr = "OK";
    if (sum.alertLevel == ml::ALERT_SERVICE_TO) alertStr = "ALERT_VISIT_TO";
    else if (sum.alertLevel == ml::ALERT_WARNING) alertStr = "WARNING_ACCUM";
    else if (sum.alertLevel == ml::ALERT_BAD_ROAD) alertStr = "BAD_ROAD_FILTERED";

    Serial.printf("[HUB] Active:%u Offline:0x%X DeadPiezo:0x%X Road:%s Status:%s%s",
                  sum.activeWheelCount,
                  sum.offlineWheelMask,
                  sum.deadSensorMask,
                  ml::roadStateName(sum.roadState),
                  alertStr,
                  sum.buzzerMuted ? " [MUTED]" : "");
    if (sum.calibrating) {
        Serial.printf(" [CAL %u%%]", sum.calProgressPct);
    }
    Serial.println();

    for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
        const ml::WheelState& w = g_classifier.wheelState(i);
        if (!w.online) {
            if (w.seenEver) {
                Serial.printf("  %s: OFFLINE (timeout!)\n", wheelName(i));
            }
            continue;
        }

        const char* faultMark = w.faultConfirmed ? " [SERVICE TO!]"
                              : (w.sensorDead ? " [DEAD PIEZO?]"
                              : (w.roadSuppressed ? " [GUARDED]" : ""));
        Serial.printf(
            "  %s: RMS=%5.1fmV (base=%4.1f peer=%.2fx axle=%.2fx) fDom=%4uHz Cent=%4uHz "
            "ML=%s(%.0f%%) Acc=%lums Potholes=%lu%s\n",
            wheelName(i),
            w.telemetry.rmsMv,
            w.baselineRmsMv,
            w.peerRatio,
            w.axleRatio,
            w.telemetry.dominantFreqHz,
            w.telemetry.spectralCentroidHz,
            ml::roadClassName(w.predictedClass),
            w.probs[w.predictedClass] * 100.0f,
            static_cast<unsigned long>(w.anomalyAccumMs),
            static_cast<unsigned long>(w.potholeCount),
            faultMark);
    }
}

void printCsvTelemetry() {
    for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
        const ml::WheelState& w = g_classifier.wheelState(i);
        if (!w.online || !w.hasCoreFrame) continue;
        Serial.printf("%lu,%u,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%.4f,%u\n",
                      static_cast<unsigned long>(millis()),
                      i,
                      w.features[0], w.features[1], w.features[2], w.features[3], w.features[4],
                      w.features[5], w.features[6], w.features[7], w.features[8], w.features[9],
                      w.predictedClass);
    }
}

void printJsonTelemetry(const ml::SystemSummary& sum) {
    Serial.printf(
        "{\"ts\":%lu,\"active\":%u,\"offlineMask\":%u,\"deadMask\":%u,\"road\":\"%s\","
        "\"alert\":%u,\"faultMask\":%u,\"muted\":%s,\"cal\":%s,\"wheels\":[",
        static_cast<unsigned long>(millis()),
        sum.activeWheelCount,
        sum.offlineWheelMask,
        sum.deadSensorMask,
        ml::roadStateName(sum.roadState),
        static_cast<unsigned>(sum.alertLevel),
        sum.faultWheelMask,
        sum.buzzerMuted ? "true" : "false",
        sum.calibrating ? "true" : "false");

    bool first = true;
    for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
        const ml::WheelState& w = g_classifier.wheelState(i);
        if (!w.online) continue;
        if (!first) Serial.print(',');
        first = false;
        Serial.printf(
            "{\"id\":\"%s\",\"rms\":%.1f,\"base\":%.1f,\"peerRatio\":%.2f,\"fDom\":%u,"
            "\"cls\":\"%s\",\"prob\":%.2f,\"fault\":%s,\"potholes\":%lu}",
            wheelName(i),
            w.telemetry.rmsMv,
            w.baselineRmsMv,
            w.peerRatio,
            w.telemetry.dominantFreqHz,
            ml::roadClassName(w.predictedClass),
            w.probs[w.predictedClass],
            w.faultConfirmed ? "true" : "false",
            static_cast<unsigned long>(w.potholeCount));
    }
    Serial.println("]}");
}

void printStatusInfo() {
    Serial.println("\n=== TechBIT Central Hub Status ===");
    Serial.printf("CAN RX frames: %lu | TX frames: %lu | Bus-Off recoveries: %lu\n",
                  static_cast<unsigned long>(g_can.rxCount()),
                  static_cast<unsigned long>(g_can.txCount()),
                  static_cast<unsigned long>(g_can.busOffRecoveries()));
    for (uint8_t i = 0; i < WHEEL_COUNT; ++i) {
        const ml::WheelState& w = g_classifier.wheelState(i);
        Serial.printf("  %s: online=%s baseRMS=%.1f mV rxCount=%lu\n",
                      wheelName(i),
                      w.online ? "YES" : "NO",
                      w.baselineRmsMv,
                      static_cast<unsigned long>(w.rxPacketCount));
    }
    Serial.println("Commands: cal | reset | mute | human | csv | json | status | help\n");
}

void handleSerialCommand(const char* line) {
    if (std::strcmp(line, "cal") == 0) {
        triggerCalibration();
    } else if (std::strcmp(line, "reset") == 0) {
        g_classifier.resetFaultLatches();
        uint8_t cmd[8] = { can::CMD_RESET_FLAGS };
        g_can.sendFrame(can::kCanIdHubCommand, cmd, 8);
        Serial.println("[TechBIT Hub] Fault latches & pothole counters reset.");
    } else if (std::strcmp(line, "mute") == 0) {
        g_classifier.toggleBuzzerMute();
        Serial.printf("[TechBIT Hub] Buzzer %s\n",
                      g_classifier.summary().buzzerMuted ? "MUTED" : "UNMUTED");
    } else if (std::strcmp(line, "human") == 0) {
        g_outputMode = OUT_HUMAN;
        Serial.println("[TechBIT Hub] Output mode -> HUMAN");
    } else if (std::strcmp(line, "csv") == 0) {
        g_outputMode = OUT_CSV;
        Serial.println("ts_ms,wheel_id,f0,f1,f2,f3,f4,f5,f6,f7,f8,f9,pred_class");
    } else if (std::strcmp(line, "json") == 0) {
        g_outputMode = OUT_JSON;
    } else if (std::strcmp(line, "status") == 0 || std::strcmp(line, "help") == 0) {
        printStatusInfo();
    }
}

void pollSerialCli() {
    while (Serial.available() > 0) {
        char c = static_cast<char>(Serial.read());
        if (c == '\r' || c == '\n') {
            if (g_cmdLen > 0) {
                g_cmdBuf[g_cmdLen] = '\0';
                handleSerialCommand(g_cmdBuf);
                g_cmdLen = 0;
            }
        } else if (g_cmdLen + 1 < sizeof(g_cmdBuf)) {
            g_cmdBuf[g_cmdLen++] = c;
        }
    }
}

} // namespace

void setup() {
    pinMode(PIN_LED_OK, OUTPUT);
    pinMode(PIN_LED_FAULT, OUTPUT);
    pinMode(PIN_BUZZER_ALERT, OUTPUT);
    pinMode(PIN_BTN_CALIBRATE, INPUT_PULLUP);

    digitalWrite(PIN_LED_OK, LOW);
    digitalWrite(PIN_LED_FAULT, LOW);
    digitalWrite(PIN_BUZZER_ALERT, LOW);

    Serial.begin(115200);
    delay(400);

    Serial.println("\n=== TechBIT Central Analytics Hub (ESP32-S3) ===");

    g_classifier.init();
    g_classifier.setStartupBlanking(kStartupBlankingMs);
    if (g_nvs.load(g_classifier)) {
        Serial.println("[TechBIT Hub] Restored calibrated wheel baselines from NVS flash.");
    } else {
        Serial.printf("[TechBIT Hub] Using default baseline RMS (%.1f mV). Send 'cal' on smooth road to calibrate.\n",
                      kDefaultBaselineRmsMv);
    }

    if (!g_can.begin(PIN_CAN_TX, PIN_CAN_RX)) {
        Serial.println("[TechBIT Hub] ERROR: Failed to initialize TWAI CAN @ 500 kbps!");
    } else {
        Serial.printf("[TechBIT Hub] CAN TWAI active @ 500 kbps (TX=%d, RX=%d)\n",
                      PIN_CAN_TX, PIN_CAN_RX);
    }

    g_canRxQueue = xQueueCreate(48, sizeof(CanFrame));
    xTaskCreatePinnedToCore(canRxTask, "can_rx_task", 4096, nullptr, 3, nullptr, 0);

    printStatusInfo();
}

void loop() {
    const uint32_t nowMs = millis();

    // 1. Ingest all buffered CAN frames from Core 0 RX task
    CanFrame frame{};
    while (g_canRxQueue != nullptr && xQueueReceive(g_canRxQueue, &frame, 0) == pdTRUE) {
        if (frame.id >= can::kCanIdCoreBase && frame.id < can::kCanIdCoreBase + WHEEL_COUNT) {
            const uint8_t wheelId = static_cast<uint8_t>(frame.id - can::kCanIdCoreBase);
            g_classifier.onCoreFrame(wheelId, frame.data, nowMs);
        } else if (frame.id >= can::kCanIdSpectralBase &&
                   frame.id < can::kCanIdSpectralBase + WHEEL_COUNT) {
            const uint8_t wheelId = static_cast<uint8_t>(frame.id - can::kCanIdSpectralBase);
            g_classifier.onSpectralFrame(wheelId, frame.data, nowMs);
        }
    }

    // 2. Smart BOOT button:
    //    - During SERVICE_TO alert: short tap mutes/unmutes buzzer (fault LED stays ON);
    //      holding >= 1.5 s starts 5 s calibration.
    //    - During normal driving: short tap or hold starts 5 s calibration.
    const bool isDownNow = (digitalRead(PIN_BTN_CALIBRATE) == LOW);
    if (isDownNow && !g_btnPressed && (nowMs - g_btnDownMs > 80U)) {
        g_btnPressed     = true;
        g_btnLongHandled = false;
        g_btnDownMs      = nowMs;
    } else if (isDownNow && g_btnPressed && !g_btnLongHandled &&
               (nowMs - g_btnDownMs >= kLongPressCalibMs)) {
        g_btnLongHandled = true;
        triggerCalibration();
    } else if (!isDownNow && g_btnPressed) {
        g_btnPressed = false;
        if (!g_btnLongHandled && (nowMs - g_btnDownMs >= 40U)) {
            if (g_classifier.summary().alertLevel == ml::ALERT_SERVICE_TO) {
                g_classifier.toggleBuzzerMute();
                Serial.printf("[TechBIT Hub] Buzzer %s (short tap)\n",
                              g_classifier.summary().buzzerMuted ? "MUTED" : "UNMUTED");
            } else {
                triggerCalibration();
            }
        }
    }

    pollSerialCli();

    // 3. Run cross-wheel fusion, TinyML MLP inference & 3s hysteresis FSM every 50 ms
    if (nowMs - g_lastEvalMs >= 50U) {
        g_lastEvalMs = nowMs;

        bool calJustFinished = false;
        g_classifier.update(nowMs, &calJustFinished);

        if (calJustFinished) {
            g_nvs.save(g_classifier);
            Serial.println("[TechBIT Hub] Calibration complete and saved to NVS flash!");
        }

        const ml::SystemSummary& sum = g_classifier.summary();
        updateHardwareIndicators(sum, nowMs);

        // Immediate alert notification when transitioning into SERVICE TO fault state
        if (sum.alertLevel == ml::ALERT_SERVICE_TO && g_prevAlert != ml::ALERT_SERVICE_TO) {
            Serial.println("\n!!! WARNING: SUSTAINED WHEEL ANOMALY DETECTED (>3s) - SERVICE CHECK REQUIRED (TO) !!!");
            printHumanDashboard(sum);
        }
        g_prevAlert = sum.alertLevel;

        const uint32_t printPeriod = (g_outputMode == OUT_CSV) ? 100U
                                   : (g_outputMode == OUT_JSON) ? 250U : 500U;
        if (nowMs - g_lastPrintMs >= printPeriod) {
            g_lastPrintMs = nowMs;
            if (g_outputMode == OUT_HUMAN) {
                if (sum.activeWheelCount > 0 || sum.offlineWheelMask != 0) {
                    printHumanDashboard(sum);
                }
            } else if (g_outputMode == OUT_CSV) {
                printCsvTelemetry();
            } else {
                printJsonTelemetry(sum);
            }
        }
    }

    delay(5);
}
