#include "LteOfflineQueue.h"

#include <Arduino.h>
#include <FS.h>
#include <LittleFS.h>
#include <cstdio>
#include <cstring>

namespace techbit {

static constexpr const char* kQueueDir     = "/lte_q";
static constexpr uint16_t    kMaxQueueSize = 48;

LteOfflineQueue::LteOfflineQueue()
    : fsReady_(false),
      modemOnline_(false),
      baseUtcEpoch_(1795455900UL), // Fallback monotonic base epoch if offline at boot
      baseMillis_(0),
      lastCheckMs_(0),
      lastFlushMs_(0),
      pendingCount_(0),
      fileSeq_(0) {
    std::snprintf(ingestUrl_, sizeof(ingestUrl_), "https://api.techbit.ua/api/ingest");
}

bool LteOfflineQueue::begin(int rxPin, int txPin, int pwrKeyPin, const char* ingestUrl) {
    if (ingestUrl && ingestUrl[0] != '\0') {
        std::snprintf(ingestUrl_, sizeof(ingestUrl_), "%s", ingestUrl);
    }

    fsReady_ = LittleFS.begin(true);
    if (fsReady_ && !LittleFS.exists(kQueueDir)) {
        LittleFS.mkdir(kQueueDir);
    }
    countPendingFiles();

    pinMode(pwrKeyPin, OUTPUT);
    digitalWrite(pwrKeyPin, HIGH);

    Serial1.begin(115200, SERIAL_8N1, rxPin, txPin);
    baseMillis_ = millis();

    modemOnline_ = sendAtCommand("AT", "OK", 300);
    if (modemOnline_) {
        sendAtCommand("ATE0", "OK", 200);
        refreshUtcFromModem(baseMillis_);
    }
    return fsReady_;
}

uint32_t LteOfflineQueue::currentUtcEpoch(uint32_t nowMs) const {
    return baseUtcEpoch_ + ((nowMs - baseMillis_) / 1000U);
}

void LteOfflineQueue::countPendingFiles() {
    pendingCount_ = 0;
    if (!fsReady_) return;
    File dir = LittleFS.open(kQueueDir);
    if (!dir || !dir.isDirectory()) return;
    File f = dir.openNextFile();
    while (f) {
        if (!f.isDirectory()) ++pendingCount_;
        f = dir.openNextFile();
    }
}

void LteOfflineQueue::enqueuePayload(const char* jsonPayload) {
    if (!jsonPayload || jsonPayload[0] == '\0') return;

    // Fast path: if modem is ready and queue is empty, try direct upload first
    if (modemOnline_ && pendingCount_ == 0U && postHttpJson(jsonPayload)) {
        return;
    }

    if (!fsReady_) return;
    if (pendingCount_ >= kMaxQueueSize) {
        // Evict oldest queued event cleanly to maintain ring guarantee
        File dir = LittleFS.open(kQueueDir);
        if (dir) {
            File oldest = dir.openNextFile();
            if (oldest) {
                String path = String(kQueueDir) + "/" + String(oldest.name());
                oldest.close();
                LittleFS.remove(path);
            }
        }
    }

    char path[40];
    std::snprintf(path, sizeof(path), "%s/evt_%06lu.json",
                  kQueueDir, static_cast<unsigned long>(++fileSeq_));
    File out = LittleFS.open(path, FILE_WRITE);
    if (out) {
        out.print(jsonPayload);
        out.close();
        countPendingFiles();
    }
}

bool LteOfflineQueue::sendAtCommand(const char* cmd, const char* expectedOk, uint32_t timeoutMs) {
    while (Serial1.available()) Serial1.read();
    Serial1.println(cmd);
    const uint32_t start = millis();
    char rxBuf[160];
    size_t pos = 0;
    while (millis() - start < timeoutMs) {
        while (Serial1.available() && pos + 1 < sizeof(rxBuf)) {
            rxBuf[pos++] = static_cast<char>(Serial1.read());
            rxBuf[pos]   = '\0';
            if (expectedOk && std::strstr(rxBuf, expectedOk) != nullptr) {
                return true;
            }
        }
        delay(5);
    }
    return false;
}

void LteOfflineQueue::refreshUtcFromModem(uint32_t nowMs) {
    // Query SIMCom/Quectel network UTC clock (AT+CCLK?)
    while (Serial1.available()) Serial1.read();
    Serial1.println("AT+CCLK?");
    const uint32_t start = millis();
    char buf[128];
    size_t pos = 0;
    while (millis() - start < 400U) {
        while (Serial1.available() && pos + 1 < sizeof(buf)) {
            buf[pos++] = static_cast<char>(Serial1.read());
            buf[pos]   = '\0';
        }
        delay(5);
    }
    if (std::strstr(buf, "+CCLK:") != nullptr) {
        baseMillis_ = nowMs;
    }
}

bool LteOfflineQueue::postHttpJson(const char* json) {
    if (!modemOnline_ || !json) return false;
    // Standard SIMCom/Quectel AT HTTP POST transaction sequence
    if (!sendAtCommand("AT+HTTPINIT", "OK", 300)) {
        return false;
    }
    char urlCmd[180];
    std::snprintf(urlCmd, sizeof(urlCmd), "AT+HTTPPARA=\"URL\",\"%s\"", ingestUrl_);
    sendAtCommand(urlCmd, "OK", 300);
    sendAtCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", "OK", 200);

    char dataCmd[48];
    const size_t len = std::strlen(json);
    std::snprintf(dataCmd, sizeof(dataCmd), "AT+HTTPDATA=%lu,3000", static_cast<unsigned long>(len));
    if (sendAtCommand(dataCmd, "DOWNLOAD", 500)) {
        Serial1.write(reinterpret_cast<const uint8_t*>(json), len);
        sendAtCommand("", "OK", 500);
    }
    const bool ok = sendAtCommand("AT+HTTPACTION=1", "+HTTPACTION:", 1500);
    sendAtCommand("AT+HTTPTERM", "OK", 200);
    return ok;
}

void LteOfflineQueue::service(uint32_t nowMs) {
    if (nowMs - lastCheckMs_ >= 15000U) {
        lastCheckMs_ = nowMs;
        modemOnline_ = sendAtCommand("AT+CGATT?", "+CGATT: 1", 250);
    }

    if (modemOnline_ && fsReady_ && pendingCount_ > 0 && (nowMs - lastFlushMs_ >= 2000U)) {
        lastFlushMs_ = nowMs;
        File dir = LittleFS.open(kQueueDir);
        if (!dir) return;
        File nextFile = dir.openNextFile();
        if (nextFile && !nextFile.isDirectory()) {
            String fullPath = String(kQueueDir) + "/" + String(nextFile.name());
            String content  = nextFile.readString();
            nextFile.close();
            if (postHttpJson(content.c_str())) {
                LittleFS.remove(fullPath);
                countPendingFiles();
            }
        }
    }
}

} // namespace techbit
