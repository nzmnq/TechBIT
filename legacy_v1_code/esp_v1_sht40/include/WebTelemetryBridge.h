#pragma once

#if defined(ESP32) || defined(ARDUINO_ARCH_ESP32)

#include <Arduino.h>
#include <Preferences.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "VibrationDSP.h"
#include "can_protocol.h"
#include "techbit_config.h"

#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
#include <HTTPClient.h>
#include <WebServer.h>
#include <WiFi.h>
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#endif

namespace techbit {

enum BridgeSerialMode : uint8_t {
    SERIAL_MODE_JSON  = 0,
    SERIAL_MODE_HUMAN = 1,
    SERIAL_MODE_CSV   = 2
};

struct NodeWebSnapshot {
    uint8_t  wheelId;
    uint32_t tsMs;
    float    rmsMv;
    float    peakMv;
    float    dcOffsetMv;
    float    crestFactor;
    float    kurtosis;
    float    bandLowRatio;
    float    bandMidRatio;
    float    bandHighRatio;
    uint16_t dominantFreqHz;
    uint16_t spectralCentroidHz;
    float    tonalityRatio;
    float    zeroCrossingsHz;
    bool     surgeClipping;
    float    tempC;
    float    humidityPct;
    bool     sht40Ok;
    bool     canReady;
    uint32_t canTx;
    uint32_t canRx;
    uint32_t canErr;
    uint32_t canBusOff;
    uint32_t adcDropped;
    float    spectrumBins[32]; // Downsampled 0..8000 Hz (250 Hz/bucket)
};

// Computes 32 max-hold buckets across 0..8000 Hz from the 512-pt FFT magnitude array.
inline void downsampleSpectrum32(const float* mag,
                                 uint16_t halfSize,
                                 float sampleRateHz,
                                 float outBins[32]) {
    const float binWidth = sampleRateHz / static_cast<float>(halfSize * 2U);
    constexpr float kBucketWidthHz = 250.0f; // 32 * 250 = 8000 Hz

    for (uint8_t b = 0; b < 32; ++b) {
        const float fStart = static_cast<float>(b) * kBucketWidthHz;
        const float fEnd   = fStart + kBucketWidthHz;

        uint16_t kStart = static_cast<uint16_t>(std::ceil(fStart / binWidth));
        uint16_t kEnd   = static_cast<uint16_t>(std::floor(fEnd / binWidth));
        if (kStart < 1U) kStart = 1U;
        if (kEnd >= halfSize) kEnd = static_cast<uint16_t>(halfSize - 1U);

        float peak = 0.0f;
        for (uint16_t k = kStart; k <= kEnd; ++k) {
            if (mag[k] > peak) {
                peak = mag[k];
            }
        }
        outBins[b] = peak;
    }
}

class WebTelemetryBridge {
public:
    static constexpr size_t kJsonBufSize   = 2048;
    static constexpr size_t kCmdQueueCap   = 8;
    static constexpr size_t kCmdLineMax    = 192;

    WebTelemetryBridge()
        : serialMode_(SERIAL_MODE_JSON),
          serialPeriodMs_(120),
          lastSerialMs_(0),
          cmdBufLen_(0),
          cmdHead_(0),
          cmdTail_(0),
          wifiEnabled_(false),
          apMode_(false),
          wifiStarted_(false) {
        latestJson_[0] = '\0';
        wifiSsid_[0]   = '\0';
        wifiPass_[0]   = '\0';
        serverUrl_[0]  = '\0';
        cmdBuf_[0]     = '\0';
        std::memset(cmdQueue_, 0, sizeof(cmdQueue_));
#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
        mutex_    = nullptr;
        httpSrv_  = nullptr;
        wifiTask_ = nullptr;
#endif
    }

    void begin(BridgeSerialMode defaultMode = SERIAL_MODE_JSON) {
        serialMode_ = defaultMode;
        loadWifiConfig();

#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
        if (mutex_ == nullptr) {
            mutex_ = xSemaphoreCreateMutex();
        }
        if (wifiEnabled_ && (wifiSsid_[0] != '\0' || apMode_)) {
            startWifiSubsystem();
        }
#endif
    }

    BridgeSerialMode serialMode() const { return serialMode_; }
    void setSerialMode(BridgeSerialMode mode) { serialMode_ = mode; }
    void setSerialPeriodMs(uint32_t ms) {
        serialPeriodMs_ = (ms >= 50U && ms <= 2000U) ? ms : 120U;
    }

    void formatNodeJson(const NodeWebSnapshot& s, char* out, size_t outCap) const {
        int pos = std::snprintf(
            out, outCap,
            "{\"type\":\"techbit_node\",\"mcu\":\"ESP32-C3\",\"wheelId\":%u,\"wheel\":\"%s\","
            "\"tsMs\":%lu,\"sampleRateHz\":%lu,\"fftSize\":%u,"
            "\"rmsMv\":%.2f,\"peakMv\":%.2f,\"dcOffsetMv\":%.1f,"
            "\"crestFactor\":%.2f,\"kurtosis\":%.2f,"
            "\"bandLowRatio\":%.3f,\"bandMidRatio\":%.3f,\"bandHighRatio\":%.3f,"
            "\"dominantFreqHz\":%u,\"spectralCentroidHz\":%u,"
            "\"tonalityRatio\":%.2f,\"zeroCrossingsHz\":%.1f,"
            "\"surgeClipping\":%s,\"tempC\":%.2f,\"humidityPct\":%.1f,\"sht40Ok\":%s,"
            "\"canReady\":%s,\"canTx\":%lu,\"canRx\":%lu,\"canErr\":%lu,\"canBusOff\":%lu,"
            "\"adcDropped\":%lu,\"spectrum\":[",
            s.wheelId,
            wheelName(s.wheelId),
            static_cast<unsigned long>(s.tsMs),
            static_cast<unsigned long>(kSampleRateHz),
            static_cast<unsigned>(kFftSize),
            s.rmsMv,
            s.peakMv,
            s.dcOffsetMv,
            s.crestFactor,
            s.kurtosis,
            s.bandLowRatio,
            s.bandMidRatio,
            s.bandHighRatio,
            s.dominantFreqHz,
            s.spectralCentroidHz,
            s.tonalityRatio,
            s.zeroCrossingsHz,
            s.surgeClipping ? "true" : "false",
            s.tempC,
            s.humidityPct,
            s.sht40Ok ? "true" : "false",
            s.canReady ? "true" : "false",
            static_cast<unsigned long>(s.canTx),
            static_cast<unsigned long>(s.canRx),
            static_cast<unsigned long>(s.canErr),
            static_cast<unsigned long>(s.canBusOff),
            static_cast<unsigned long>(s.adcDropped));

        if (pos < 0 || static_cast<size_t>(pos) >= outCap) {
            out[outCap - 1] = '\0';
            return;
        }

        for (uint8_t i = 0; i < 32; ++i) {
            int n = std::snprintf(
                out + pos,
                outCap - static_cast<size_t>(pos),
                "%s%.1f",
                (i == 0) ? "" : ",",
                s.spectrumBins[i]);
            if (n < 0) break;
            pos += n;
            if (static_cast<size_t>(pos) + 4 >= outCap) break;
        }

        std::snprintf(out + pos, outCap - static_cast<size_t>(pos), "]}");
    }

    // Updates latest JSON snapshot for Wi-Fi push and emits JSON over USB Serial at configured rate.
    void publishJsonLine(const char* jsonLine, uint32_t nowMs) {
        if (!jsonLine || jsonLine[0] == '\0') return;

#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
        if (mutex_ != nullptr && xSemaphoreTake(mutex_, pdMS_TO_TICKS(5)) == pdTRUE) {
            std::strncpy(latestJson_, jsonLine, kJsonBufSize - 1);
            latestJson_[kJsonBufSize - 1] = '\0';
            xSemaphoreGive(mutex_);
        }
#else
        std::strncpy(latestJson_, jsonLine, kJsonBufSize - 1);
        latestJson_[kJsonBufSize - 1] = '\0';
#endif

        if (serialMode_ == SERIAL_MODE_JSON && (nowMs - lastSerialMs_) >= serialPeriodMs_) {
            lastSerialMs_ = nowMs;
            Serial.println(jsonLine);
        }
    }

    void publishNodeSnapshot(const NodeWebSnapshot& snap, uint32_t nowMs) {
        char buf[kJsonBufSize];
        formatNodeJson(snap, buf, sizeof(buf));
        publishJsonLine(buf, nowMs);
    }

    // Polls USB Serial for commands AND returns any queued commands from Serial or Wi-Fi.
    bool pollCommand(char* outCmd, size_t outCap) {
        while (Serial.available() > 0) {
            char c = static_cast<char>(Serial.read());
            if (c == '\r' || c == '\n') {
                if (cmdBufLen_ > 0) {
                    cmdBuf_[cmdBufLen_] = '\0';
                    handleBridgeInternalCommand(cmdBuf_);
                    enqueueCommand(cmdBuf_);
                    cmdBufLen_ = 0;
                }
            } else if (cmdBufLen_ + 1 < kCmdLineMax) {
                cmdBuf_[cmdBufLen_++] = c;
            }
        }
        return dequeueCommand(outCmd, outCap);
    }

    void printNetworkStatus() const {
        Serial.printf("[TechBIT WebBridge] SerialMode=%s Period=%lums\n",
                      serialMode_ == SERIAL_MODE_JSON ? "JSON"
                      : (serialMode_ == SERIAL_MODE_CSV ? "CSV" : "HUMAN"),
                      static_cast<unsigned long>(serialPeriodMs_));
#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
        if (!wifiStarted_) {
            Serial.println("[TechBIT WebBridge] Wi-Fi inactive. Configure via: wifi <ssid> <pass> <http://PC_IP:5050/api/telemetry>");
        } else if (apMode_) {
            Serial.printf("[TechBIT WebBridge] Wi-Fi AP active: SSID=TechBIT-C3-Diag IP=%s\n",
                          WiFi.softAPIP().toString().c_str());
        } else {
            Serial.printf("[TechBIT WebBridge] Wi-Fi STA SSID=%s Connected=%s IP=%s Target=%s\n",
                          wifiSsid_,
                          WiFi.status() == WL_CONNECTED ? "YES" : "CONNECTING",
                          WiFi.localIP().toString().c_str(),
                          serverUrl_[0] ? serverUrl_ : "(none - pull only)");
        }
#else
        Serial.println("[TechBIT WebBridge] Built in USB-Serial mode (-DENABLE_WIFI_TELEMETRY=0)");
#endif
    }

    // Load/save persistent Wheel ID override in NVS so a single test node can switch FL/FR/RL/RR live.
    static int8_t loadSavedWheelId() {
        Preferences prefs;
        if (!prefs.begin("techbit_node", false)) return -1;
        int32_t val = prefs.getInt("wheel_id", -1);
        prefs.end();
        if (val >= 0 && val < WHEEL_COUNT) return static_cast<int8_t>(val);
        return -1;
    }

    static bool saveWheelId(uint8_t wheelId) {
        if (wheelId >= WHEEL_COUNT) return false;
        Preferences prefs;
        if (!prefs.begin("techbit_node", false)) return false;
        prefs.putInt("wheel_id", static_cast<int32_t>(wheelId));
        prefs.end();
        return true;
    }

private:
    void loadWifiConfig() {
#ifdef TECHBIT_WIFI_SSID
        std::strncpy(wifiSsid_, TECHBIT_WIFI_SSID, sizeof(wifiSsid_) - 1);
        wifiEnabled_ = (wifiSsid_[0] != '\0');
#endif
#ifdef TECHBIT_WIFI_PASS
        std::strncpy(wifiPass_, TECHBIT_WIFI_PASS, sizeof(wifiPass_) - 1);
#endif
#ifdef TECHBIT_WEB_URL
        std::strncpy(serverUrl_, TECHBIT_WEB_URL, sizeof(serverUrl_) - 1);
#endif

        Preferences prefs;
        if (prefs.begin("techbit_wifi", false)) {
            if (prefs.isKey("enabled")) {
                wifiEnabled_ = prefs.getBool("enabled", wifiEnabled_);
            }
            if (prefs.isKey("ap")) {
                apMode_ = prefs.getBool("ap", false);
            }
            if (prefs.isKey("ssid")) {
                String s = prefs.getString("ssid", "");
                if (s.length() > 0) {
                    std::strncpy(wifiSsid_, s.c_str(), sizeof(wifiSsid_) - 1);
                }
            }
            if (prefs.isKey("pass")) {
                String p = prefs.getString("pass", "");
                std::strncpy(wifiPass_, p.c_str(), sizeof(wifiPass_) - 1);
            }
            if (prefs.isKey("url")) {
                String u = prefs.getString("url", "");
                if (u.length() > 0) {
                    std::strncpy(serverUrl_, u.c_str(), sizeof(serverUrl_) - 1);
                }
            }
            prefs.end();
        }
    }

    void saveWifiConfig() const {
        Preferences prefs;
        if (!prefs.begin("techbit_wifi", false)) return;
        prefs.putBool("enabled", wifiEnabled_);
        prefs.putBool("ap", apMode_);
        prefs.putString("ssid", wifiSsid_);
        prefs.putString("pass", wifiPass_);
        prefs.putString("url", serverUrl_);
        prefs.end();
    }

    void handleBridgeInternalCommand(const char* line) {
        if (std::strcmp(line, "json") == 0) {
            serialMode_ = SERIAL_MODE_JSON;
        } else if (std::strcmp(line, "human") == 0) {
            serialMode_ = SERIAL_MODE_HUMAN;
        } else if (std::strcmp(line, "csv") == 0) {
            serialMode_ = SERIAL_MODE_CSV;
        } else if (std::strncmp(line, "rate ", 5) == 0) {
            uint32_t ms = static_cast<uint32_t>(std::atoi(line + 5));
            setSerialPeriodMs(ms);
        } else if (std::strcmp(line, "wifi_off") == 0) {
            wifiEnabled_ = false;
            apMode_      = false;
            saveWifiConfig();
#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
            WiFi.disconnect(true);
            WiFi.mode(WIFI_OFF);
            wifiStarted_ = false;
#endif
            Serial.println("[TechBIT WebBridge] Wi-Fi disabled.");
        } else if (std::strcmp(line, "wifi_ap") == 0) {
            wifiEnabled_ = true;
            apMode_      = true;
            saveWifiConfig();
#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
            startWifiSubsystem();
#endif
        } else if (std::strncmp(line, "wifi ", 5) == 0) {
            // Format: wifi <ssid> <pass> [url]
            char copy[kCmdLineMax];
            std::strncpy(copy, line + 5, sizeof(copy) - 1);
            copy[sizeof(copy) - 1] = '\0';

            char* tokSsid = std::strtok(copy, " ");
            char* tokPass = std::strtok(nullptr, " ");
            char* tokUrl  = std::strtok(nullptr, " ");
            if (tokSsid != nullptr) {
                std::strncpy(wifiSsid_, tokSsid, sizeof(wifiSsid_) - 1);
                if (tokPass != nullptr) {
                    std::strncpy(wifiPass_, (std::strcmp(tokPass, "-") == 0) ? "" : tokPass, sizeof(wifiPass_) - 1);
                }
                if (tokUrl != nullptr) {
                    std::strncpy(serverUrl_, tokUrl, sizeof(serverUrl_) - 1);
                }
                wifiEnabled_ = true;
                apMode_      = false;
                saveWifiConfig();
#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
                startWifiSubsystem();
#endif
                printNetworkStatus();
            }
        }
    }

    void enqueueCommand(const char* cmd) {
        if (!cmd || cmd[0] == '\0') return;
#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
        if (mutex_ != nullptr && xSemaphoreTake(mutex_, pdMS_TO_TICKS(10)) != pdTRUE) {
            return;
        }
#endif
        size_t nextTail = (cmdTail_ + 1U) % kCmdQueueCap;
        if (nextTail != cmdHead_) {
            std::strncpy(cmdQueue_[cmdTail_], cmd, kCmdLineMax - 1);
            cmdQueue_[cmdTail_][kCmdLineMax - 1] = '\0';
            cmdTail_ = nextTail;
        }
#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
        if (mutex_ != nullptr) {
            xSemaphoreGive(mutex_);
        }
#endif
    }

    bool dequeueCommand(char* outCmd, size_t outCap) {
        bool has = false;
#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
        if (mutex_ != nullptr && xSemaphoreTake(mutex_, pdMS_TO_TICKS(5)) != pdTRUE) {
            return false;
        }
#endif
        if (cmdHead_ != cmdTail_) {
            std::strncpy(outCmd, cmdQueue_[cmdHead_], outCap - 1);
            outCmd[outCap - 1] = '\0';
            cmdHead_ = (cmdHead_ + 1U) % kCmdQueueCap;
            has      = true;
        }
#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
        if (mutex_ != nullptr) {
            xSemaphoreGive(mutex_);
        }
#endif
        return has;
    }

#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
    void startWifiSubsystem() {
        if (apMode_) {
            WiFi.mode(WIFI_AP);
            WiFi.softAP("TechBIT-C3-Diag", "techbit1234");
        } else if (wifiSsid_[0] != '\0') {
            WiFi.mode(WIFI_STA);
            WiFi.setSleep(false); // Prevent Wi-Fi modem sleep spikes on ADC/CAN
            WiFi.begin(wifiSsid_, wifiPass_);
        }

        if (httpSrv_ == nullptr) {
            httpSrv_ = new WebServer(80);
            httpSrv_->on("/api/telemetry", HTTP_GET, [this]() {
                httpSrv_->sendHeader("Access-Control-Allow-Origin", "*");
                char snap[kJsonBufSize];
                snap[0] = '\0';
                if (mutex_ != nullptr && xSemaphoreTake(mutex_, pdMS_TO_TICKS(10)) == pdTRUE) {
                    std::strncpy(snap, latestJson_, sizeof(snap) - 1);
                    snap[sizeof(snap) - 1] = '\0';
                    xSemaphoreGive(mutex_);
                }
                if (snap[0] == '\0') {
                    httpSrv_->send(200, "application/json", "{\"status\":\"waiting\"}");
                } else {
                    httpSrv_->send(200, "application/json", snap);
                }
            });

            httpSrv_->on("/api/command", HTTP_OPTIONS, [this]() {
                httpSrv_->sendHeader("Access-Control-Allow-Origin", "*");
                httpSrv_->sendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
                httpSrv_->sendHeader("Access-Control-Allow-Headers", "Content-Type");
                httpSrv_->send(204);
            });

            httpSrv_->on("/api/command", HTTP_POST, [this]() {
                httpSrv_->sendHeader("Access-Control-Allow-Origin", "*");
                String body = httpSrv_->arg("plain");
                body.trim();
                if (body.length() > 0) {
                    // Support either plain command string or {"cmd":"cal"}
                    if (body.startsWith("{")) {
                        int idx = body.indexOf("\"cmd\"");
                        if (idx >= 0) {
                            int q1 = body.indexOf('"', idx + 5);
                            int q2 = (q1 >= 0) ? body.indexOf('"', q1 + 1) : -1;
                            if (q1 >= 0 && q2 > q1) {
                                String c = body.substring(q1 + 1, q2);
                                handleBridgeInternalCommand(c.c_str());
                                enqueueCommand(c.c_str());
                            }
                        }
                    } else {
                        handleBridgeInternalCommand(body.c_str());
                        enqueueCommand(body.c_str());
                    }
                }
                httpSrv_->send(200, "application/json", "{\"ok\":true}");
            });

            httpSrv_->begin();
        }

        if (wifiTask_ == nullptr) {
            // Single networking task owns WebServer + HTTPClient so ADC DMA never stalls
            xTaskCreate(wifiTaskEntry, "techbit_wifi", 6144, this, 1, &wifiTask_);
        }
        wifiStarted_ = true;
    }

    static void wifiTaskEntry(void* param) {
        auto* self = static_cast<WebTelemetryBridge*>(param);
        self->runWifiTaskLoop();
    }

    void runWifiTaskLoop() {
        uint32_t lastPushMs = 0;
        char payload[kJsonBufSize];

        for (;;) {
            if (httpSrv_ != nullptr) {
                httpSrv_->handleClient();
            }

            const uint32_t now = millis();
            if (!apMode_ && wifiEnabled_ && serverUrl_[0] != '\0' &&
                WiFi.status() == WL_CONNECTED && (now - lastPushMs) >= 160U) {
                lastPushMs = now;
                payload[0] = '\0';

                if (mutex_ != nullptr && xSemaphoreTake(mutex_, pdMS_TO_TICKS(10)) == pdTRUE) {
                    std::strncpy(payload, latestJson_, sizeof(payload) - 1);
                    payload[sizeof(payload) - 1] = '\0';
                    xSemaphoreGive(mutex_);
                }

                if (payload[0] != '\0') {
                    HTTPClient http;
                    http.setConnectTimeout(300);
                    http.setTimeout(350);
                    if (http.begin(serverUrl_)) {
                        http.addHeader("Content-Type", "application/json");
                        int code = http.POST(reinterpret_cast<uint8_t*>(payload), std::strlen(payload));
                        if (code == 200) {
                            String resp = http.getString();
                            parseServerResponseCommands(resp);
                        }
                        http.end();
                    }
                }
            }

            vTaskDelay(pdMS_TO_TICKS(20));
        }
    }

    void parseServerResponseCommands(const String& resp) {
        // Lightweight parser for {"ok":true,"commands":["cal","wheel 1"]}
        int arrStart = resp.indexOf("\"commands\"");
        if (arrStart < 0) return;
        int lb = resp.indexOf('[', arrStart);
        if (lb < 0) return;
        int rb = resp.indexOf(']', lb);
        if (rb <= lb) return;

        int pos = lb + 1;
        while (pos < rb) {
            int q1 = resp.indexOf('"', pos);
            if (q1 < 0 || q1 >= rb) break;
            int q2 = resp.indexOf('"', q1 + 1);
            if (q2 < 0 || q2 >= rb) break;
            String cmd = resp.substring(q1 + 1, q2);
            if (cmd.length() > 0) {
                handleBridgeInternalCommand(cmd.c_str());
                enqueueCommand(cmd.c_str());
            }
            pos = q2 + 1;
        }
    }
#endif

    BridgeSerialMode serialMode_;
    uint32_t         serialPeriodMs_;
    uint32_t         lastSerialMs_;

    char   latestJson_[kJsonBufSize];
    char   wifiSsid_[64];
    char   wifiPass_[64];
    char   serverUrl_[160];
    char   cmdBuf_[kCmdLineMax];
    size_t cmdBufLen_;

    char   cmdQueue_[kCmdQueueCap][kCmdLineMax];
    size_t cmdHead_;
    size_t cmdTail_;

    bool wifiEnabled_;
    bool apMode_;
    bool wifiStarted_;

#if defined(ENABLE_WIFI_TELEMETRY) && (ENABLE_WIFI_TELEMETRY == 1)
    SemaphoreHandle_t mutex_;
    WebServer*        httpSrv_;
    TaskHandle_t      wifiTask_;
#endif
};

} // namespace techbit

#endif // ESP32
