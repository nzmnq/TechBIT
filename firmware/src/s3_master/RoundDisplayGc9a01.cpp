#include "RoundDisplayGc9a01.h"

#include <Arduino.h>
#include <SPI.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "board_pins.h"
#include "esp32-hal-ledc.h"
#include "esp32-hal-psram.h"
#include "esp32-hal-spi.h"

namespace techbit {

namespace {

static constexpr uint8_t  kBacklightLedcChannel = 0;
static constexpr uint32_t kBacklightPwmFreqHz   = 5000;
static constexpr uint8_t  kBacklightPwmResBits  = 8;
static constexpr uint32_t kTftSpiFreqHz         = 40000000UL;

// RGB565 automotive cockpit palette
static constexpr uint16_t kColBg         = 0x0841; // Deep obsidian
static constexpr uint16_t kColCardBg     = 0x10A3; // Dark steel card
static constexpr uint16_t kColCardBorder = 0x31A7; // Muted slate border
static constexpr uint16_t kColDivider    = 0x2945;
static constexpr uint16_t kColWhite      = 0xFFFF;
static constexpr uint16_t kColMuted      = 0x9CF3;
static constexpr uint16_t kColDim        = 0x6B4D;
static constexpr uint16_t kColDarkPill   = 0x18E4;
static constexpr uint16_t kColGreen      = 0x07E0;
static constexpr uint16_t kColGreenDark  = 0x0280;
static constexpr uint16_t kColAmber      = 0xFD20;
static constexpr uint16_t kColAmberDark  = 0x5180;
static constexpr uint16_t kColRed        = 0xF800;
static constexpr uint16_t kColRedDim     = 0x7800;
static constexpr uint16_t kColCyan       = 0x07FF;
static constexpr uint16_t kColCyanDark   = 0x0250;

// Built-in 5x7 ASCII bitmap font (0x20..0x7E) + glyph 95 for degree symbol (°)
static constexpr uint8_t kFont5x7[][5] = {
    {0x00, 0x00, 0x00, 0x00, 0x00}, // 0x20 ' '
    {0x00, 0x00, 0x5F, 0x00, 0x00}, // 0x21 '!'
    {0x00, 0x07, 0x00, 0x07, 0x00}, // 0x22 '"'
    {0x14, 0x7F, 0x14, 0x7F, 0x14}, // 0x23 '#'
    {0x24, 0x2A, 0x7F, 0x2A, 0x12}, // 0x24 '$'
    {0x23, 0x13, 0x08, 0x64, 0x62}, // 0x25 '%'
    {0x36, 0x49, 0x55, 0x22, 0x50}, // 0x26 '&'
    {0x00, 0x05, 0x03, 0x00, 0x00}, // 0x27 '''
    {0x00, 0x1C, 0x22, 0x41, 0x00}, // 0x28 '('
    {0x00, 0x41, 0x22, 0x1C, 0x00}, // 0x29 ')'
    {0x08, 0x2A, 0x1C, 0x2A, 0x08}, // 0x2A '*'
    {0x08, 0x08, 0x3E, 0x08, 0x08}, // 0x2B '+'
    {0x00, 0x50, 0x30, 0x00, 0x00}, // 0x2C ','
    {0x08, 0x08, 0x08, 0x08, 0x08}, // 0x2D '-'
    {0x00, 0x60, 0x60, 0x00, 0x00}, // 0x2E '.'
    {0x20, 0x10, 0x08, 0x04, 0x02}, // 0x2F '/'
    {0x3E, 0x51, 0x49, 0x45, 0x3E}, // 0x30 '0'
    {0x00, 0x42, 0x7F, 0x40, 0x00}, // 0x31 '1'
    {0x42, 0x61, 0x51, 0x49, 0x46}, // 0x32 '2'
    {0x21, 0x41, 0x45, 0x4B, 0x31}, // 0x33 '3'
    {0x18, 0x14, 0x12, 0x7F, 0x10}, // 0x34 '4'
    {0x27, 0x45, 0x45, 0x45, 0x39}, // 0x35 '5'
    {0x3C, 0x4A, 0x49, 0x49, 0x30}, // 0x36 '6'
    {0x01, 0x71, 0x09, 0x05, 0x03}, // 0x37 '7'
    {0x36, 0x49, 0x49, 0x49, 0x36}, // 0x38 '8'
    {0x06, 0x49, 0x49, 0x29, 0x1E}, // 0x39 '9'
    {0x00, 0x36, 0x36, 0x00, 0x00}, // 0x3A ':'
    {0x00, 0x56, 0x36, 0x00, 0x00}, // 0x3B ';'
    {0x00, 0x08, 0x14, 0x22, 0x41}, // 0x3C '<'
    {0x14, 0x14, 0x14, 0x14, 0x14}, // 0x3D '='
    {0x41, 0x22, 0x14, 0x08, 0x00}, // 0x3E '>'
    {0x02, 0x01, 0x51, 0x09, 0x06}, // 0x3F '?'
    {0x32, 0x49, 0x79, 0x41, 0x3E}, // 0x40 '@'
    {0x7E, 0x11, 0x11, 0x11, 0x7E}, // 0x41 'A'
    {0x7F, 0x49, 0x49, 0x49, 0x36}, // 0x42 'B'
    {0x3E, 0x41, 0x41, 0x41, 0x22}, // 0x43 'C'
    {0x7F, 0x41, 0x41, 0x22, 0x1C}, // 0x44 'D'
    {0x7F, 0x49, 0x49, 0x49, 0x41}, // 0x45 'E'
    {0x7F, 0x09, 0x09, 0x01, 0x01}, // 0x46 'F'
    {0x3E, 0x41, 0x41, 0x51, 0x32}, // 0x47 'G'
    {0x7F, 0x08, 0x08, 0x08, 0x7F}, // 0x48 'H'
    {0x00, 0x41, 0x7F, 0x41, 0x00}, // 0x49 'I'
    {0x20, 0x40, 0x41, 0x3F, 0x01}, // 0x4A 'J'
    {0x7F, 0x08, 0x14, 0x22, 0x41}, // 0x4B 'K'
    {0x7F, 0x40, 0x40, 0x40, 0x40}, // 0x4C 'L'
    {0x7F, 0x02, 0x04, 0x02, 0x7F}, // 0x4D 'M'
    {0x7F, 0x04, 0x08, 0x10, 0x7F}, // 0x4E 'N'
    {0x3E, 0x41, 0x41, 0x41, 0x3E}, // 0x4F 'O'
    {0x7F, 0x09, 0x09, 0x09, 0x06}, // 0x50 'P'
    {0x3E, 0x41, 0x51, 0x21, 0x5E}, // 0x51 'Q'
    {0x7F, 0x09, 0x19, 0x29, 0x46}, // 0x52 'R'
    {0x46, 0x49, 0x49, 0x49, 0x31}, // 0x53 'S'
    {0x01, 0x01, 0x7F, 0x01, 0x01}, // 0x54 'T'
    {0x3F, 0x40, 0x40, 0x40, 0x3F}, // 0x55 'U'
    {0x1F, 0x20, 0x40, 0x20, 0x1F}, // 0x56 'V'
    {0x7F, 0x20, 0x18, 0x20, 0x7F}, // 0x57 'W'
    {0x63, 0x14, 0x08, 0x14, 0x63}, // 0x58 'X'
    {0x03, 0x04, 0x78, 0x04, 0x03}, // 0x59 'Y'
    {0x61, 0x51, 0x49, 0x45, 0x43}, // 0x5A 'Z'
    {0x00, 0x00, 0x7F, 0x41, 0x41}, // 0x5B '['
    {0x02, 0x04, 0x08, 0x10, 0x20}, // 0x5C '\'
    {0x41, 0x41, 0x7F, 0x00, 0x00}, // 0x5D ']'
    {0x04, 0x02, 0x01, 0x02, 0x04}, // 0x5E '^'
    {0x40, 0x40, 0x40, 0x40, 0x40}, // 0x5F '_'
    {0x00, 0x01, 0x02, 0x04, 0x00}, // 0x60 '`'
    {0x20, 0x54, 0x54, 0x54, 0x78}, // 0x61 'a'
    {0x7F, 0x48, 0x44, 0x44, 0x38}, // 0x62 'b'
    {0x38, 0x44, 0x44, 0x44, 0x20}, // 0x63 'c'
    {0x38, 0x44, 0x44, 0x48, 0x7F}, // 0x64 'd'
    {0x38, 0x54, 0x54, 0x54, 0x18}, // 0x65 'e'
    {0x08, 0x7E, 0x09, 0x01, 0x02}, // 0x66 'f'
    {0x08, 0x14, 0x54, 0x54, 0x3C}, // 0x67 'g'
    {0x7F, 0x08, 0x04, 0x04, 0x78}, // 0x68 'h'
    {0x00, 0x44, 0x7D, 0x40, 0x00}, // 0x69 'i'
    {0x20, 0x40, 0x44, 0x3D, 0x00}, // 0x6A 'j'
    {0x00, 0x7F, 0x10, 0x28, 0x44}, // 0x6B 'k'
    {0x00, 0x41, 0x7F, 0x40, 0x00}, // 0x6C 'l'
    {0x7C, 0x04, 0x18, 0x04, 0x78}, // 0x6D 'm'
    {0x7C, 0x08, 0x04, 0x04, 0x78}, // 0x6E 'n'
    {0x38, 0x44, 0x44, 0x44, 0x38}, // 0x6F 'o'
    {0x7C, 0x14, 0x14, 0x14, 0x08}, // 0x70 'p'
    {0x08, 0x14, 0x14, 0x18, 0x7C}, // 0x71 'q'
    {0x7C, 0x08, 0x04, 0x04, 0x08}, // 0x72 'r'
    {0x48, 0x54, 0x54, 0x54, 0x20}, // 0x73 's'
    {0x04, 0x3F, 0x44, 0x40, 0x20}, // 0x74 't'
    {0x3C, 0x40, 0x40, 0x20, 0x7C}, // 0x75 'u'
    {0x1C, 0x20, 0x40, 0x20, 0x1C}, // 0x76 'v'
    {0x3C, 0x40, 0x30, 0x40, 0x3C}, // 0x77 'w'
    {0x44, 0x28, 0x10, 0x28, 0x44}, // 0x78 'x'
    {0x0C, 0x50, 0x50, 0x50, 0x3C}, // 0x79 'y'
    {0x44, 0x64, 0x54, 0x4C, 0x44}, // 0x7A 'z'
    {0x00, 0x08, 0x36, 0x41, 0x00}, // 0x7B '{'
    {0x00, 0x00, 0x7F, 0x00, 0x00}, // 0x7C '|'
    {0x00, 0x41, 0x36, 0x08, 0x00}, // 0x7D '}'
    {0x08, 0x08, 0x2A, 0x1C, 0x08}, // 0x7E '~'
    {0x06, 0x09, 0x09, 0x06, 0x00}  // 0x7F degree symbol '°'
};

static constexpr uint8_t kDegreeGlyphIdx = 95;

uint8_t nextGlyph(const char*& p) {
    const uint8_t c = static_cast<uint8_t>(*p);
    if (c == 0xC2 && static_cast<uint8_t>(p[1]) == 0xB0) {
        p += 2;
        return kDegreeGlyphIdx;
    }
    ++p;
    if (c >= 0x20 && c <= 0x7E) {
        return static_cast<uint8_t>(c - 0x20);
    }
    return 0; // Space fallback
}

const char* slotShortLabel(rules::WheelSlot slot) {
    switch (slot) {
        case rules::SLOT_TRACTOR_A1: return "T1";
        case rules::SLOT_TRACTOR_A2: return "T2";
        case rules::SLOT_TRAILER_A1: return "P1";
        case rules::SLOT_TRAILER_A2: return "P2";
        case rules::SLOT_TRAILER_A3: return "P3";
        default:                     return "UN";
    }
}

uint16_t metricColor(float ratio) {
    if (ratio >= 1.0f) return kColRed;
    if (ratio >= 0.72f) return kColAmber;
    return kColGreen;
}

uint16_t wheelColorWheel(uint8_t idx) {
    static constexpr uint16_t kPalette[6] = {
        kColRed, kColAmber, kColGreen, kColCyan, 0x001F, 0xF81F
    };
    return kPalette[idx % 6U];
}

// Fast integer 0..359 deg approximation using atan2f (only used for partial arcs)
int16_t angleDegFromCenter(int16_t dx, int16_t dy) {
    float rad = std::atan2(static_cast<float>(dy), static_cast<float>(dx));
    int16_t deg = static_cast<int16_t>(rad * (180.0f / 3.14159265f) + 90.0f);
    if (deg < 0) deg += 360;
    if (deg >= 360) deg -= 360;
    return deg;
}

} // namespace

RoundDisplayGc9a01::RoundDisplayGc9a01()
    : spi_(nullptr),
      buf_(nullptr),
      bandY0_(0),
      bandH_(kHeight),
      brightness_(225),
      ready_(false),
      usingPsram_(false) {}

RoundDisplayGc9a01::~RoundDisplayGc9a01() {
    if (buf_) {
        std::free(buf_);
        buf_ = nullptr;
    }
    delete spi_;
    spi_ = nullptr;
}

bool RoundDisplayGc9a01::begin() {
    pinMode(PIN_TFT_CS, OUTPUT);
    digitalWrite(PIN_TFT_CS, HIGH);
    pinMode(PIN_TFT_DC, OUTPUT);
    digitalWrite(PIN_TFT_DC, HIGH);
    pinMode(PIN_TFT_RES, OUTPUT);
    digitalWrite(PIN_TFT_RES, HIGH);

    // Core 2.x LEDC backlight PWM on PIN_TFT_LED
    ledcSetup(kBacklightLedcChannel, kBacklightPwmFreqHz, kBacklightPwmResBits);
    ledcAttachPin(PIN_TFT_LED, kBacklightLedcChannel);
    ledcWrite(kBacklightLedcChannel, 0);

    if (!buf_) {
        const size_t fullBytes = static_cast<size_t>(kWidth) * static_cast<size_t>(kHeight) * sizeof(uint16_t);
        if (psramFound()) {
            buf_ = static_cast<uint16_t*>(ps_malloc(fullBytes));
        }
        if (buf_ != nullptr) {
            usingPsram_ = true;
        } else {
            usingPsram_ = false;
            const size_t bandBytes = static_cast<size_t>(kWidth) * static_cast<size_t>(kBandLines) * sizeof(uint16_t);
            buf_ = static_cast<uint16_t*>(std::malloc(bandBytes));
        }
    }
    if (!buf_) {
        return false;
    }

    if (!spi_) {
        spi_ = new SPIClass(FSPI);
    }
    if (!spi_) {
        return false;
    }

    spi_->begin(PIN_TFT_SCK, -1, PIN_TFT_MOSI, -1);
    // On ESP32-S3 FSPI, passing miso=-1 defaults MISO to GPIO13; detach it cleanly since GC9A01 is write-only,
    // and ensure SCK output routing remains attached to PIN_TFT_SCK.
    if (spi_->bus()) {
        spiDetachMISO(spi_->bus(), 13);
        spiAttachSCK(spi_->bus(), PIN_TFT_SCK);
    }

    hardwareReset();
    initController();

    ready_ = true;
    renderAndFlush([this]() { drawSplashScene(); });
    setBrightness(brightness_);
    return true;
}

void RoundDisplayGc9a01::setBrightness(uint8_t level) {
    brightness_ = level;
    ledcWrite(kBacklightLedcChannel, brightness_);
}

void RoundDisplayGc9a01::hardwareReset() {
    digitalWrite(PIN_TFT_RES, HIGH);
    delay(5);
    digitalWrite(PIN_TFT_RES, LOW);
    delay(15);
    digitalWrite(PIN_TFT_RES, HIGH);
    delay(120);
}

void RoundDisplayGc9a01::writeCmdData(uint8_t cmd, const uint8_t* data, uint16_t len) {
    const SPISettings settings(kTftSpiFreqHz, MSBFIRST, SPI_MODE0);
    spi_->beginTransaction(settings);
    digitalWrite(PIN_TFT_CS, LOW);
    digitalWrite(PIN_TFT_DC, LOW);
    spi_->transfer(cmd);
    if (data != nullptr && len > 0U) {
        digitalWrite(PIN_TFT_DC, HIGH);
        spi_->writeBytes(data, len);
    }
    digitalWrite(PIN_TFT_CS, HIGH);
    spi_->endTransaction();
}

void RoundDisplayGc9a01::initController() {
    struct CmdEntry {
        uint8_t cmd;
        uint8_t len;
        uint8_t data[12];
    };

    static constexpr CmdEntry kInitSeq[] = {
        {0xEF, 0, {}},
        {0xEB, 1, {0x14}},
        {0xFE, 0, {}},
        {0xEF, 0, {}},
        {0xEB, 1, {0x14}},
        {0x84, 1, {0x40}},
        {0x85, 1, {0xFF}},
        {0x86, 1, {0xFF}},
        {0x87, 1, {0xFF}},
        {0x88, 1, {0x0A}},
        {0x89, 1, {0x21}},
        {0x8A, 1, {0x00}},
        {0x8B, 1, {0x80}},
        {0x8C, 1, {0x01}},
        {0x8D, 1, {0x01}},
        {0x8E, 1, {0xFF}},
        {0x8F, 1, {0xFF}},
        {0xB6, 2, {0x00, 0x20}},
        {0x36, 1, {0x08}},       // MADCTL: BGR order, upright
        {0x3A, 1, {0x05}},       // COLMOD: 16-bit RGB565
        {0x90, 4, {0x08, 0x08, 0x08, 0x08}},
        {0xBD, 1, {0x06}},
        {0xBC, 1, {0x00}},
        {0xFF, 3, {0x60, 0x01, 0x04}},
        {0xC3, 1, {0x13}},
        {0xC4, 1, {0x13}},
        {0xC9, 1, {0x22}},
        {0xBE, 1, {0x11}},
        {0xE1, 2, {0x10, 0x0E}},
        {0xDF, 3, {0x21, 0x0C, 0x02}},
        {0xF0, 6, {0x45, 0x09, 0x08, 0x08, 0x26, 0x2A}},
        {0xF1, 6, {0x43, 0x70, 0x72, 0x36, 0x37, 0x6F}},
        {0xF2, 6, {0x45, 0x09, 0x08, 0x08, 0x26, 0x2A}},
        {0xF3, 6, {0x43, 0x70, 0x72, 0x36, 0x37, 0x6F}},
        {0xED, 2, {0x1B, 0x0B}},
        {0xAE, 1, {0x77}},
        {0xCD, 1, {0x63}},
        {0x70, 9, {0x07, 0x07, 0x04, 0x0E, 0x0F, 0x09, 0x07, 0x08, 0x03}},
        {0xE8, 1, {0x34}},
        {0x62, 12, {0x18, 0x0D, 0x71, 0xED, 0x70, 0x70, 0x18, 0x0F, 0x71, 0xEF, 0x70, 0x70}},
        {0x63, 12, {0x18, 0x11, 0x71, 0xF1, 0x70, 0x70, 0x18, 0x13, 0x71, 0xF3, 0x70, 0x70}},
        {0x64, 7, {0x28, 0x29, 0xF1, 0x01, 0xF1, 0x00, 0x07}},
        {0x66, 10, {0x3C, 0x00, 0xCD, 0x67, 0x45, 0x45, 0x10, 0x00, 0x00, 0x00}},
        {0x67, 10, {0x00, 0x3C, 0x00, 0x00, 0x00, 0x01, 0x54, 0x10, 0x32, 0x98}},
        {0x74, 7, {0x10, 0x85, 0x80, 0x00, 0x00, 0x4E, 0x00}},
        {0x98, 2, {0x3E, 0x07}},
        {0x35, 0, {}},
        {0x21, 0, {}}, // Display inversion ON (required for GC9A01 IPS)
    };

    for (const auto& e : kInitSeq) {
        writeCmdData(e.cmd, e.len > 0 ? e.data : nullptr, e.len);
    }

    writeCmdData(0x11, nullptr, 0); // Sleep Out
    delay(120);
    writeCmdData(0x29, nullptr, 0); // Display On
    delay(20);
}

void RoundDisplayGc9a01::flushWindow(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1, uint32_t byteCount) {
    const uint8_t caset[4] = {
        static_cast<uint8_t>(x0 >> 8), static_cast<uint8_t>(x0 & 0xFFU),
        static_cast<uint8_t>(x1 >> 8), static_cast<uint8_t>(x1 & 0xFFU)
    };
    const uint8_t raset[4] = {
        static_cast<uint8_t>(y0 >> 8), static_cast<uint8_t>(y0 & 0xFFU),
        static_cast<uint8_t>(y1 >> 8), static_cast<uint8_t>(y1 & 0xFFU)
    };

    const SPISettings settings(kTftSpiFreqHz, MSBFIRST, SPI_MODE0);
    spi_->beginTransaction(settings);
    digitalWrite(PIN_TFT_CS, LOW);

    digitalWrite(PIN_TFT_DC, LOW);
    spi_->transfer(0x2A);
    digitalWrite(PIN_TFT_DC, HIGH);
    spi_->writeBytes(caset, 4);

    digitalWrite(PIN_TFT_DC, LOW);
    spi_->transfer(0x2B);
    digitalWrite(PIN_TFT_DC, HIGH);
    spi_->writeBytes(raset, 4);

    digitalWrite(PIN_TFT_DC, LOW);
    spi_->transfer(0x2C);
    digitalWrite(PIN_TFT_DC, HIGH);
    spi_->writePixels(buf_, byteCount);

    digitalWrite(PIN_TFT_CS, HIGH);
    spi_->endTransaction();
}

template <typename DrawFn>
void RoundDisplayGc9a01::renderAndFlush(DrawFn&& drawFn) {
    if (!ready_ || !buf_) return;

    if (usingPsram_) {
        bandY0_ = 0;
        bandH_  = kHeight;
        drawFn();
        flushWindow(0, 0, kWidth - 1, kHeight - 1,
                    static_cast<uint32_t>(kWidth) * static_cast<uint32_t>(kHeight) * 2U);
    } else {
        for (int16_t y0 = 0; y0 < kHeight; y0 += kBandLines) {
            bandY0_ = y0;
            bandH_  = (y0 + kBandLines <= kHeight) ? kBandLines : (kHeight - y0);
            drawFn();
            flushWindow(0, static_cast<uint16_t>(y0), kWidth - 1, static_cast<uint16_t>(y0 + bandH_ - 1),
                        static_cast<uint32_t>(kWidth) * static_cast<uint32_t>(bandH_) * 2U);
        }
    }
}

void RoundDisplayGc9a01::clear(uint16_t color) {
    const size_t n = static_cast<size_t>(kWidth) * static_cast<size_t>(bandH_);
    std::fill_n(buf_, n, color);
}

void RoundDisplayGc9a01::drawPixel(int16_t x, int16_t y, uint16_t color) {
    if (x < 0 || x >= kWidth || y < bandY0_ || y >= (bandY0_ + bandH_)) {
        return;
    }
    const int32_t dx = x - kCenterX;
    const int32_t dy = y - kCenterY;
    if ((dx * dx + dy * dy) > (kCenterX * kCenterX)) {
        return;
    }
    buf_[static_cast<size_t>(y - bandY0_) * kWidth + static_cast<size_t>(x)] = color;
}

void RoundDisplayGc9a01::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
    if (w <= 0 || h <= 0) return;
    const int16_t yStart = std::max<int16_t>(y, bandY0_);
    const int16_t yEnd   = std::min<int16_t>(y + h, bandY0_ + bandH_);
    const int16_t xStart = std::max<int16_t>(x, 0);
    const int16_t xEnd   = std::min<int16_t>(x + w, kWidth);
    for (int16_t py = yStart; py < yEnd; ++py) {
        for (int16_t px = xStart; px < xEnd; ++px) {
            drawPixel(px, py, color);
        }
    }
}

void RoundDisplayGc9a01::drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
    if (w <= 0 || h <= 0) return;
    fillRect(x, y, w, 1, color);
    fillRect(x, y + h - 1, w, 1, color);
    fillRect(x, y, 1, h, color);
    fillRect(x + w - 1, y, 1, h, color);
}

void RoundDisplayGc9a01::fillRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
    if (w <= 0 || h <= 0) return;
    r = std::min<int16_t>(r, std::min<int16_t>(w / 2, h / 2));
    if (r <= 0) {
        fillRect(x, y, w, h, color);
        return;
    }
    const int16_t yStart = std::max<int16_t>(y, bandY0_);
    const int16_t yEnd   = std::min<int16_t>(y + h, bandY0_ + bandH_);
    const int32_t r2     = static_cast<int32_t>(r) * r;
    for (int16_t py = yStart; py < yEnd; ++py) {
        for (int16_t px = x; px < x + w; ++px) {
            int16_t cx = px;
            int16_t cy = py;
            if (px < x + r) cx = x + r;
            else if (px >= x + w - r) cx = x + w - r - 1;
            if (py < y + r) cy = y + r;
            else if (py >= y + h - r) cy = y + h - r - 1;
            const int32_t dx = px - cx;
            const int32_t dy = py - cy;
            if ((dx * dx + dy * dy) <= r2) {
                drawPixel(px, py, color);
            }
        }
    }
}

void RoundDisplayGc9a01::drawRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color) {
    if (w <= 2 || h <= 2) return;
    r = std::min<int16_t>(r, std::min<int16_t>(w / 2, h / 2));
    if (r <= 0) {
        drawRect(x, y, w, h, color);
        return;
    }
    const int16_t yStart = std::max<int16_t>(y, bandY0_);
    const int16_t yEnd   = std::min<int16_t>(y + h, bandY0_ + bandH_);
    const int32_t rOut2  = static_cast<int32_t>(r) * r;
    const int32_t rIn2   = static_cast<int32_t>(r - 1) * (r - 1);
    for (int16_t py = yStart; py < yEnd; ++py) {
        for (int16_t px = x; px < x + w; ++px) {
            const bool inCornerX = (px < x + r) || (px >= x + w - r);
            const bool inCornerY = (py < y + r) || (py >= y + h - r);
            if (!inCornerX && !inCornerY) continue;
            if (inCornerX && inCornerY) {
                const int16_t cx = (px < x + r) ? (x + r) : (x + w - r - 1);
                const int16_t cy = (py < y + r) ? (y + r) : (y + h - r - 1);
                const int32_t d2 = static_cast<int32_t>(px - cx) * (px - cx) +
                                   static_cast<int32_t>(py - cy) * (py - cy);
                if (d2 <= rOut2 && d2 >= rIn2) {
                    drawPixel(px, py, color);
                }
            } else if (px == x || px == x + w - 1 || py == y || py == y + h - 1) {
                drawPixel(px, py, color);
            }
        }
    }
}

void RoundDisplayGc9a01::fillCircle(int16_t cx, int16_t cy, int16_t r, uint16_t color) {
    if (r <= 0) return;
    const int32_t r2     = static_cast<int32_t>(r) * r;
    const int16_t yStart = std::max<int16_t>(cy - r, bandY0_);
    const int16_t yEnd   = std::min<int16_t>(cy + r + 1, bandY0_ + bandH_);
    for (int16_t py = yStart; py < yEnd; ++py) {
        const int32_t dy = py - cy;
        for (int16_t px = cx - r; px <= cx + r; ++px) {
            const int32_t dx = px - cx;
            if ((dx * dx + dy * dy) <= r2) {
                drawPixel(px, py, color);
            }
        }
    }
}

void RoundDisplayGc9a01::drawCircle(int16_t cx, int16_t cy, int16_t r, uint16_t color) {
    drawRing(cx, cy, r, 1, color);
}

void RoundDisplayGc9a01::drawRing(int16_t cx, int16_t cy, int16_t rOuter, int16_t thickness, uint16_t color) {
    if (rOuter <= 0 || thickness <= 0) return;
    const int16_t rInner = std::max<int16_t>(0, rOuter - thickness);
    const int32_t rOut2  = static_cast<int32_t>(rOuter) * rOuter;
    const int32_t rIn2   = static_cast<int32_t>(rInner) * rInner;
    const int16_t yStart = std::max<int16_t>(cy - rOuter, bandY0_);
    const int16_t yEnd   = std::min<int16_t>(cy + rOuter + 1, bandY0_ + bandH_);
    for (int16_t py = yStart; py < yEnd; ++py) {
        const int32_t dy = py - cy;
        const int32_t dy2 = dy * dy;
        for (int16_t px = cx - rOuter; px <= cx + rOuter; ++px) {
            const int32_t dx = px - cx;
            const int32_t d2 = dx * dx + dy2;
            if (d2 <= rOut2 && d2 >= rIn2) {
                drawPixel(px, py, color);
            }
        }
    }
}

void RoundDisplayGc9a01::drawRingSegment(int16_t cx, int16_t cy, int16_t rOuter, int16_t thickness,
                                          int16_t startDeg, int16_t spanDeg, uint16_t color) {
    if (rOuter <= 0 || thickness <= 0 || spanDeg <= 0) return;
    if (spanDeg >= 360) {
        drawRing(cx, cy, rOuter, thickness, color);
        return;
    }
    const int16_t rInner = std::max<int16_t>(0, rOuter - thickness);
    const int32_t rOut2  = static_cast<int32_t>(rOuter) * rOuter;
    const int32_t rIn2   = static_cast<int32_t>(rInner) * rInner;
    int16_t normStart    = startDeg % 360;
    if (normStart < 0) normStart += 360;

    const int16_t yStart = std::max<int16_t>(cy - rOuter, bandY0_);
    const int16_t yEnd   = std::min<int16_t>(cy + rOuter + 1, bandY0_ + bandH_);
    for (int16_t py = yStart; py < yEnd; ++py) {
        const int16_t dy  = py - cy;
        const int32_t dy2 = static_cast<int32_t>(dy) * dy;
        for (int16_t px = cx - rOuter; px <= cx + rOuter; ++px) {
            const int16_t dx = px - cx;
            const int32_t d2 = static_cast<int32_t>(dx) * dx + dy2;
            if (d2 <= rOut2 && d2 >= rIn2) {
                int16_t deg = angleDegFromCenter(dx, dy) - normStart;
                if (deg < 0) deg += 360;
                if (deg <= spanDeg) {
                    drawPixel(px, py, color);
                }
            }
        }
    }
}

void RoundDisplayGc9a01::drawHBar(int16_t x, int16_t y, int16_t w, int16_t h,
                                   float ratio, uint16_t fgColor, uint16_t bgColor, uint16_t borderColor) {
    if (w <= 2 || h <= 2) return;
    fillRect(x, y, w, h, bgColor);
    drawRect(x, y, w, h, borderColor);
    const float clamped = std::max(0.0f, std::min(1.0f, ratio));
    const int16_t fillW = static_cast<int16_t>(clamped * static_cast<float>(w - 2) + 0.5f);
    if (fillW > 0) {
        fillRect(x + 1, y + 1, fillW, h - 2, fgColor);
    }
}

void RoundDisplayGc9a01::drawChar5x7(int16_t x, int16_t y, uint8_t glyphIdx, uint16_t color, uint8_t scale) {
    if (scale == 0 || glyphIdx > kDegreeGlyphIdx) return;
    const int16_t charH = static_cast<int16_t>(7 * scale);
    if (y + charH <= bandY0_ || y >= bandY0_ + bandH_) return;

    const uint8_t* cols = kFont5x7[glyphIdx];
    for (uint8_t col = 0; col < 5; ++col) {
        const uint8_t bits = cols[col];
        for (uint8_t row = 0; row < 7; ++row) {
            if ((bits >> row) & 0x01U) {
                if (scale == 1) {
                    drawPixel(x + col, y + row, color);
                } else {
                    fillRect(x + static_cast<int16_t>(col * scale),
                             y + static_cast<int16_t>(row * scale),
                             scale, scale, color);
                }
            }
        }
    }
}

int16_t RoundDisplayGc9a01::textWidthPx(const char* text, uint8_t scale) const {
    if (!text || text[0] == '\0' || scale == 0) return 0;
    int16_t count = 0;
    const char* p = text;
    while (*p != '\0') {
        nextGlyph(p);
        ++count;
    }
    return count * static_cast<int16_t>(6 * scale) - static_cast<int16_t>(scale);
}

void RoundDisplayGc9a01::drawText(int16_t x, int16_t y, const char* text, uint16_t color, uint8_t scale) {
    if (!text || scale == 0) return;
    int16_t cursorX = x;
    const int16_t step = static_cast<int16_t>(6 * scale);
    const char* p = text;
    while (*p != '\0') {
        const uint8_t glyph = nextGlyph(p);
        drawChar5x7(cursorX, y, glyph, color, scale);
        cursorX += step;
    }
}

void RoundDisplayGc9a01::drawTextCentered(int16_t cx, int16_t y, const char* text, uint16_t color, uint8_t scale) {
    const int16_t w = textWidthPx(text, scale);
    drawText(cx - (w / 2), y, text, color, scale);
}

void RoundDisplayGc9a01::drawSplashScene() {
    clear(kColBg);
    drawRing(kCenterX, kCenterY, 119, 7, kColCyan);
    drawRing(kCenterX, kCenterY, 108, 2, kColDivider);

    drawTextCentered(kCenterX, 74, "TECHBIT", kColWhite, 2);
    drawTextCentered(kCenterX, 98, "v2.0", kColCyan, 2);

    fillRoundRect(56, 128, 128, 28, 6, kColCardBg);
    drawRoundRect(56, 128, 128, 28, 6, kColCardBorder);
    drawTextCentered(kCenterX, 138, "S3 N16R8", kColGreen, 1);

    drawTextCentered(kCenterX, 174, usingPsram_ ? "PSRAM FB 40MHz" : "BAND FB 40MHz", kColMuted, 1);
}

void RoundDisplayGc9a01::drawNodeCard(int16_t x,
                                      int16_t y,
                                      int16_t w,
                                      int16_t h,
                                      const rules::TrackedAxleNode& node,
                                      const char* pageBadge,
                                      uint32_t nowMs) {
    (void)nowMs;
    fillRoundRect(x, y, w, h, 6, kColCardBg);
    drawRoundRect(x, y, w, h, 6, kColCardBorder);

    const char* slotStr = slotShortLabel(node.slot);
    const uint32_t id16 = node.telemetry.nodeId & 0xFFFFU;
    char hdrBuf[24];
    std::snprintf(hdrBuf, sizeof(hdrBuf), "%s C3_%04X", slotStr, static_cast<unsigned>(id16));

    // Header row inside card
    fillCircle(x + 9, y + 9, 3, node.online ? kColGreen : kColRed);
    drawText(x + 16, y + 6, hdrBuf, kColWhite, 1);

    const char* linkTag = (pageBadge && pageBadge[0] != '\0')
                              ? pageBadge
                              : (node.fromTrailer ? "ESP" : "CAN");
    const uint16_t tagCol = node.fromTrailer ? kColCyan : kColMuted;
    drawText(x + w - textWidthPx(linkTag, 1) - 6, y + 6, linkTag, tagCol, 1);

    // Left wheel row
    char lStr[24];
    std::snprintf(lStr, sizeof(lStr), "L %4.1f°C %4.2fm/s",
                  node.telemetry.tempLeftC,
                  node.telemetry.vibRmsLeft);
    drawText(x + 6, y + 21, lStr, kColMuted, 1);

    const float lRatio = std::max(node.telemetry.tempLeftC / 70.0f, node.telemetry.vibRmsLeft / 3.5f);
    drawHBar(x + w - 44, y + 21, 38, 7, lRatio, metricColor(lRatio), kColBg, kColDivider);

    // Right wheel row
    char rStr[24];
    std::snprintf(rStr, sizeof(rStr), "R %4.1f°C %4.2fm/s",
                  node.telemetry.tempRightC,
                  node.telemetry.vibRmsRight);
    drawText(x + 6, y + 37, rStr, kColMuted, 1);

    const float rRatio = std::max(node.telemetry.tempRightC / 70.0f, node.telemetry.vibRmsRight / 3.5f);
    drawHBar(x + w - 44, y + 37, 38, 7, rRatio, metricColor(rRatio), kColBg, kColDivider);
}

void RoundDisplayGc9a01::drawDashboardScene(const rules::CabinIndicatorState& ind,
                                            const rules::TrackedAxleNode* nodes,
                                            uint8_t maxNodes,
                                            uint32_t canRxCount,
                                            bool sdMounted,
                                            uint32_t sdEvents,
                                            bool bleActive,
                                            uint16_t bbRecords,
                                            bool selfTest,
                                            uint32_t nowMs) {
    clear(kColBg);

    // 1. Outer 7px Status Ring (r = 112..119)
    if (selfTest) {
        const int16_t baseDeg = static_cast<int16_t>((nowMs / 25U) % 360U);
        for (uint8_t seg = 0; seg < 12; ++seg) {
            drawRingSegment(kCenterX, kCenterY, 119, 7,
                            baseDeg + static_cast<int16_t>(seg * 30), 26,
                            wheelColorWheel(seg));
        }
    } else if (ind.driverSeverity == rules::SEV_RED) {
        const uint16_t ringCol = ((nowMs / 250U) % 2U == 0U) ? kColRed : kColRedDim;
        drawRing(kCenterX, kCenterY, 119, 7, ringCol);
    } else if (ind.driverSeverity == rules::SEV_YELLOW) {
        drawRing(kCenterX, kCenterY, 119, 7, kColAmber);
    } else if (bleActive) {
        drawRing(kCenterX, kCenterY, 119, 7, kColCyan);
    } else {
        drawRing(kCenterX, kCenterY, 119, 7, kColGreen);
    }

    // 2. Top Header (strictly inside r <= 104)
    drawTextCentered(kCenterX, 22, selfTest ? "SELF TEST" : "TECHBIT",
                     selfTest ? kColCyan : kColWhite, 1);

    // Status pills: [CAN] [SD] [BLE]
    const uint16_t canFill = (canRxCount > 0U) ? kColGreenDark : kColDarkPill;
    const uint16_t canBdr  = (canRxCount > 0U) ? kColGreen : kColDim;
    const uint16_t canTxt  = (canRxCount > 0U) ? kColGreen : kColMuted;
    fillRoundRect(63, 35, 36, 13, 3, canFill);
    drawRoundRect(63, 35, 36, 13, 3, canBdr);
    drawTextCentered(81, 38, "CAN", canTxt, 1);

    const uint16_t sdFill = sdMounted ? kColGreenDark : kColDarkPill;
    const uint16_t sdBdr  = sdMounted ? kColGreen : kColDim;
    const uint16_t sdTxt  = sdMounted ? kColGreen : kColMuted;
    fillRoundRect(105, 35, 30, 13, 3, sdFill);
    drawRoundRect(105, 35, 30, 13, 3, sdBdr);
    drawTextCentered(120, 38, "SD", sdTxt, 1);

    const uint16_t bleFill = bleActive ? kColCyanDark : kColDarkPill;
    const uint16_t bleBdr  = bleActive ? kColCyan : kColDim;
    const uint16_t bleTxt  = bleActive ? kColCyan : kColMuted;
    fillRoundRect(141, 35, 36, 13, 3, bleFill);
    drawRoundRect(141, 35, 36, 13, 3, bleBdr);
    drawTextCentered(159, 38, "BLE", bleTxt, 1);

    fillRect(50, 52, 140, 1, kColDivider);

    // 3. Center Viewport (y = 58..178, kept within r <= 104)
    if (ind.driverSeverity == rules::SEV_RED || ind.driverSeverity == rules::SEV_YELLOW) {
        const bool isRed       = (ind.driverSeverity == rules::SEV_RED);
        const uint16_t sevCol  = isRed ? kColRed : kColAmber;
        const uint16_t sevFill = isRed ? kColRedDim : kColAmberDark;

        fillRoundRect(68, 58, 104, 16, 4, sevFill);
        drawRoundRect(68, 58, 104, 16, 4, sevCol);
        drawTextCentered(kCenterX, 62, isRed ? "CRITICAL" : "WARNING", kColWhite, 1);

        const char* code = ind.wheelCode[0] ? ind.wheelCode : "WARN";
        drawTextCentered(kCenterX, 82, code, sevCol, 4);

        // Locate matching worst node for reason, worst temp & worst RMS vib
        const rules::TrackedAxleNode* culprit = nullptr;
        float worstScore = -1.0f;
        if (nodes != nullptr) {
            for (uint8_t i = 0; i < maxNodes; ++i) {
                if (!nodes[i].used || !nodes[i].online) continue;
                if ((isRed && nodes[i].redLatched) || (!isRed && nodes[i].yellowLatched)) {
                    culprit = &nodes[i];
                    break;
                }
                const float score = std::max(nodes[i].telemetry.tempLeftC, nodes[i].telemetry.tempRightC) +
                                    10.0f * std::max(nodes[i].telemetry.vibRmsLeft, nodes[i].telemetry.vibRmsRight);
                if (score > worstScore) {
                    worstScore = score;
                    culprit    = &nodes[i];
                }
            }
        }

        if (culprit != nullptr) {
            char reasonBuf[24];
            std::snprintf(reasonBuf, sizeof(reasonBuf), "%.21s",
                          culprit->lastReason[0] ? culprit->lastReason : "ANOMALY");
            drawTextCentered(kCenterX, 118, reasonBuf, kColMuted, 1);

            const float worstT = std::max(culprit->telemetry.tempLeftC, culprit->telemetry.tempRightC);
            const float worstV = std::max(culprit->telemetry.vibRmsLeft, culprit->telemetry.vibRmsRight);

            fillRoundRect(38, 134, 78, 42, 5, kColCardBg);
            drawRoundRect(38, 134, 78, 42, 5, sevCol);
            drawTextCentered(77, 138, "TEMP", kColDim, 1);
            char tBuf[14];
            std::snprintf(tBuf, sizeof(tBuf), "%.1f°C", worstT);
            const uint8_t tScale = (textWidthPx(tBuf, 2) <= 72) ? 2 : 1;
            drawTextCentered(77, (tScale == 2) ? 150 : 154, tBuf, kColWhite, tScale);

            fillRoundRect(124, 134, 78, 42, 5, kColCardBg);
            drawRoundRect(124, 134, 78, 42, 5, sevCol);
            drawTextCentered(163, 138, "VIB", kColDim, 1);
            char vBuf[14];
            std::snprintf(vBuf, sizeof(vBuf), "%.2f", worstV);
            const uint8_t vScale = (textWidthPx(vBuf, 2) <= 72) ? 2 : 1;
            drawTextCentered(163, (vScale == 2) ? 148 : 151, vBuf, kColWhite, vScale);
            drawTextCentered(163, 166, "mm/s", kColMuted, 1);
        } else {
            drawTextCentered(kCenterX, 126, "CHECK AXLE NODE", kColMuted, 1);
        }
    } else if (ind.activeNodeCount > 0U && nodes != nullptr) {
        uint8_t activeIdx[12];
        uint8_t activeCnt = 0;
        for (uint8_t i = 0; i < maxNodes && activeCnt < 12U; ++i) {
            if (nodes[i].used && nodes[i].online) {
                activeIdx[activeCnt++] = i;
            }
        }

        if (activeCnt == 1U) {
            drawNodeCard(38, 66, 164, 56, nodes[activeIdx[0]], nullptr, nowMs);
            drawTextCentered(kCenterX, 138, "1 MODULE ONLINE", kColGreen, 1);
            drawTextCentered(kCenterX, 154, "ALL WHEELS NORMAL", kColMuted, 1);
        } else if (activeCnt >= 2U) {
            const uint8_t numPages = static_cast<uint8_t>((activeCnt + 1U) / 2U);
            const uint8_t page     = (numPages > 1U) ? static_cast<uint8_t>((nowMs / 3000U) % numPages) : 0U;
            const uint8_t first    = static_cast<uint8_t>(page * 2U);

            char pageStr[8] = "";
            if (numPages > 1U) {
                std::snprintf(pageStr, sizeof(pageStr), "%u/%u",
                              static_cast<unsigned>(page + 1U),
                              static_cast<unsigned>(numPages));
            }
            drawNodeCard(38, 58, 164, 56, nodes[activeIdx[first]], pageStr, nowMs);

            if (first + 1U < activeCnt) {
                drawNodeCard(38, 119, 164, 56, nodes[activeIdx[first + 1U]], nullptr, nowMs);
            } else {
                drawTextCentered(kCenterX, 142, "ALL WHEELS NORMAL", kColGreen, 1);
            }
        } else {
            drawTextCentered(kCenterX, 92, "CAN READY", kColGreen, 2);
            drawTextCentered(kCenterX, 118, "WAITING NODES", kColMuted, 1);
        }
    } else {
        // SEV_GREEN with 0 active nodes
        drawTextCentered(kCenterX, 78, "CAN READY", kColGreen, 2);
        drawTextCentered(kCenterX, 102, "WAITING NODES", kColMuted, 1);

        // Animated orbital dot indicator
        drawCircle(kCenterX, 140, 16, kColDivider);
        const uint8_t activeDot = static_cast<uint8_t>((nowMs / 120U) % 8U);
        static constexpr int8_t kDotDx[8] = {0, 11, 16, 11, 0, -11, -16, -11};
        static constexpr int8_t kDotDy[8] = {-16, -11, 0, 11, 16, 11, 0, -11};
        for (uint8_t d = 0; d < 8; ++d) {
            const bool lit = (d == activeDot);
            fillCircle(kCenterX + kDotDx[d], 140 + kDotDy[d], lit ? 3 : 2,
                       lit ? (bleActive ? kColCyan : kColGreen) : kColDim);
        }

        drawTextCentered(kCenterX, 166, "500K CAN | ESP-NOW", kColDim, 1);
    }

    // 4. Bottom Footer (y = 182..216)
    fillRect(50, 182, 140, 1, kColDivider);

    char foot1[24];
    std::snprintf(foot1, sizeof(foot1), "%s  BB:%u",
                  sdMounted ? "SD:OK" : "NO SD",
                  static_cast<unsigned>(bbRecords));
    // Draw SD part colored + BB part muted, centered together
    const int16_t foot1W = textWidthPx(foot1, 1);
    const int16_t f1X    = kCenterX - (foot1W / 2);
    const char* sdLabel  = sdMounted ? "SD:OK" : "NO SD";
    drawText(f1X, 188, sdLabel, sdMounted ? kColGreen : kColAmber, 1);
    char bbPart[16];
    std::snprintf(bbPart, sizeof(bbPart), "  BB:%u", static_cast<unsigned>(bbRecords));
    drawText(f1X + textWidthPx(sdLabel, 1), 188, bbPart, kColMuted, 1);

    char foot2[24];
    if (sdEvents > 0U) {
        std::snprintf(foot2, sizeof(foot2), "RX:%lu EV:%lu",
                      static_cast<unsigned long>(canRxCount),
                      static_cast<unsigned long>(sdEvents));
    } else {
        std::snprintf(foot2, sizeof(foot2), "RX:%lu",
                      static_cast<unsigned long>(canRxCount));
    }
    drawTextCentered(kCenterX, 202, foot2, kColDim, 1);
}

void RoundDisplayGc9a01::renderDashboard(const rules::CabinIndicatorState& ind,
                                         const rules::TrackedAxleNode* nodes,
                                         uint8_t maxNodes,
                                         uint32_t canRxCount,
                                         bool sdMounted,
                                         uint32_t sdEvents,
                                         bool bleActive,
                                         uint16_t bbRecords,
                                         bool selfTest,
                                         uint32_t nowMs) {
    renderAndFlush([&]() {
        drawDashboardScene(ind, nodes, maxNodes, canRxCount, sdMounted, sdEvents,
                           bleActive, bbRecords, selfTest, nowMs);
    });
}

} // namespace techbit
