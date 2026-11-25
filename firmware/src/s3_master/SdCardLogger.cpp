#include "SdCardLogger.h"

#include <Arduino.h>
#include <FS.h>
#include <SD.h>
#include <SPI.h>
#include <cctype>
#include <cstdio>
#include <cstring>

#include "board_pins.h"

namespace techbit {

namespace {

static constexpr const char* kRootDir       = "/techbit";
static constexpr const char* kEventsDir     = "/techbit/events";
static constexpr const char* kTelemetryPath = "/techbit/telemetry.csv";
static constexpr uint32_t    kSdSpiFreqHz   = 4000000UL;

const char* severityLabel(rules::AlertSeverity sev) {
    switch (sev) {
        case rules::SEV_RED:    return "RED";
        case rules::SEV_YELLOW: return "YELLOW";
        case rules::SEV_SHADOW: return "SHADOW";
        default:                return "GREEN";
    }
}

void sanitizeFilenameToken(const char* src, char* dst, size_t dstCap) {
    if (!dst || dstCap == 0U) return;
    if (!src || src[0] == '\0') {
        std::snprintf(dst, dstCap, "UNK");
        return;
    }
    size_t j = 0;
    for (size_t i = 0; src[i] != '\0' && j + 1U < dstCap; ++i) {
        const unsigned char ch = static_cast<unsigned char>(src[i]);
        if (std::isalnum(ch) || ch == '-' || ch == '_') {
            dst[j++] = static_cast<char>(ch);
        } else {
            dst[j++] = '_';
        }
    }
    dst[j] = '\0';
    if (j == 0U) {
        std::snprintf(dst, dstCap, "UNK");
    }
}

} // namespace

SdCardLogger::SdCardLogger()
    : spi_(nullptr),
      spiStarted_(false),
      mounted_(false),
      totalMb_(0),
      usedMb_(0),
      loggedRows_(0),
      savedEvents_(0) {}

SdCardLogger::~SdCardLogger() {
    if (mounted_) {
        SD.end();
        mounted_ = false;
    }
    delete spi_;
    spi_ = nullptr;
}

bool SdCardLogger::begin() {
    return mountInternal();
}

bool SdCardLogger::remount() {
    SD.end();
    mounted_ = false;
    totalMb_ = 0;
    usedMb_  = 0;
    return mountInternal();
}

bool SdCardLogger::mountInternal() {
    pinMode(PIN_SD_CS, OUTPUT);
    digitalWrite(PIN_SD_CS, HIGH);

    if (!spi_) {
        spi_ = new SPIClass(HSPI);
    }
    if (!spi_) {
        mounted_ = false;
        return false;
    }

    if (!spiStarted_) {
        spi_->begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
        spiStarted_ = true;
    }

    if (!SD.begin(PIN_SD_CS, *spi_, kSdSpiFreqHz)) {
        mounted_ = false;
        return false;
    }

    if (SD.cardType() == CARD_NONE) {
        SD.end();
        mounted_ = false;
        return false;
    }

    mounted_ = ensureDirectories();
    if (!mounted_) {
        SD.end();
        return false;
    }

    refreshUsageStats();
    return true;
}

bool SdCardLogger::ensureDirectories() {
    if (!SD.exists(kRootDir) && !SD.mkdir(kRootDir)) {
        return false;
    }
    if (!SD.exists(kEventsDir) && !SD.mkdir(kEventsDir)) {
        return false;
    }
    return true;
}

void SdCardLogger::refreshUsageStats() {
    if (!mounted_) {
        totalMb_ = 0;
        usedMb_  = 0;
        return;
    }
    totalMb_ = static_cast<uint32_t>(SD.totalBytes() / (1024ULL * 1024ULL));
    usedMb_  = static_cast<uint32_t>(SD.usedBytes() / (1024ULL * 1024ULL));
}

void SdCardLogger::logTelemetrySnapshot(const char* utcIso,
                                        uint32_t uptimeMs,
                                        const rules::CabinIndicatorState& ind,
                                        const rules::TrackedAxleNode* nodes,
                                        uint8_t maxNodes) {
    if (!mounted_ || !nodes || maxNodes == 0U) return;

    const bool needHeader = !SD.exists(kTelemetryPath);
    File f = SD.open(kTelemetryPath, needHeader ? FILE_WRITE : FILE_APPEND);
    if (!f) {
        mounted_ = false;
        return;
    }

    if (needHeader || f.size() == 0U) {
        f.println("utc_iso,uptime_ms,severity,wheel_code,node_id,slot,from_trailer,"
                  "temp_l_c,temp_r_c,vib_l_mms,vib_r_mms,freq_l_hz,freq_r_hz,flags");
    }

    const char* tsStr  = (utcIso && utcIso[0] != '\0') ? utcIso : "1970-01-01T00:00:00Z";
    const char* sevStr = severityLabel(ind.driverSeverity);
    const char* wcStr  = (ind.wheelCode[0] != '\0') ? ind.wheelCode : "OK";

    char row[192];
    for (uint8_t i = 0; i < maxNodes; ++i) {
        if (!nodes[i].used || !nodes[i].online) continue;

        char nid[12];
        can2::formatNodeIdString(nodes[i].telemetry.nodeId, nid);

        const int len = std::snprintf(
            row, sizeof(row),
            "%s,%lu,%s,%s,%s,%u,%u,%.1f,%.1f,%.2f,%.2f,%u,%u,0x%02X",
            tsStr,
            static_cast<unsigned long>(uptimeMs),
            sevStr,
            wcStr,
            nid,
            static_cast<unsigned>(nodes[i].slot),
            nodes[i].fromTrailer ? 1U : 0U,
            nodes[i].telemetry.tempLeftC,
            nodes[i].telemetry.tempRightC,
            nodes[i].telemetry.vibRmsLeft,
            nodes[i].telemetry.vibRmsRight,
            static_cast<unsigned>(nodes[i].telemetry.domFreqLeftHz),
            static_cast<unsigned>(nodes[i].telemetry.domFreqRightHz),
            static_cast<unsigned>(nodes[i].telemetry.statusFlags));

        if (len > 0) {
            if (f.println(row) == 0U) {
                f.close();
                mounted_ = false;
                return;
            }
            ++loggedRows_;
        }
    }

    f.flush();
    f.close();
}

bool SdCardLogger::saveAnomalyBurst(uint32_t seq,
                                    const char* wheelCode,
                                    const char* severity,
                                    const char* jsonPayload) {
    (void)severity;
    if (!mounted_ || !jsonPayload || jsonPayload[0] == '\0') return false;

    if (!ensureDirectories()) {
        mounted_ = false;
        return false;
    }

    char safeWheel[16];
    sanitizeFilenameToken(wheelCode, safeWheel, sizeof(safeWheel));

    char path[64];
    std::snprintf(path, sizeof(path), "%s/evt_%lu_%s.json",
                  kEventsDir,
                  static_cast<unsigned long>(seq),
                  safeWheel);

    File f = SD.open(path, FILE_WRITE);
    if (!f) {
        mounted_ = false;
        return false;
    }

    const size_t payloadLen = std::strlen(jsonPayload);
    const size_t written    = f.write(reinterpret_cast<const uint8_t*>(jsonPayload), payloadLen);
    f.println();
    f.flush();
    f.close();

    if (written != payloadLen) {
        mounted_ = false;
        return false;
    }

    ++savedEvents_;
    return true;
}

} // namespace techbit
