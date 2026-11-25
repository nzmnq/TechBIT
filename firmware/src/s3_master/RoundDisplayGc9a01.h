#pragma once

#include <cstdint>
#include "RuleEngine.h"

class SPIClass;

namespace techbit {

// Zero-external-dependency C++17 driver & automotive round HUD for the
// 1.28" 240x240 GC9A01 IPS TFT display on SPI2 (FSPI) @ 40 MHz.
// Allocates a full RGB565 240x240 framebuffer (115,200 bytes) in OPI PSRAM
// when available, with automatic fallback to a 20-line internal RAM band buffer.
class RoundDisplayGc9a01 {
public:
    static constexpr int16_t kWidth     = 240;
    static constexpr int16_t kHeight    = 240;
    static constexpr int16_t kCenterX   = 120;
    static constexpr int16_t kCenterY   = 120;
    static constexpr int16_t kBandLines = 20;

    RoundDisplayGc9a01();
    ~RoundDisplayGc9a01();

    bool begin();
    void setBrightness(uint8_t level);

    bool isReady() const { return ready_; }
    bool usingPsram() const { return usingPsram_; }

    void renderDashboard(const rules::CabinIndicatorState& ind,
                         const rules::TrackedAxleNode* nodes,
                         uint8_t maxNodes,
                         uint32_t canRxCount,
                         bool sdMounted,
                         uint32_t sdEvents,
                         bool bleActive,
                         uint16_t bbRecords,
                         bool selfTest,
                         uint32_t nowMs);

private:
    void hardwareReset();
    void initController();
    void writeCmdData(uint8_t cmd, const uint8_t* data, uint16_t len);
    void flushWindow(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1, uint32_t byteCount);

    template <typename DrawFn>
    void renderAndFlush(DrawFn&& drawFn);

    void drawSplashScene();
    void drawDashboardScene(const rules::CabinIndicatorState& ind,
                            const rules::TrackedAxleNode* nodes,
                            uint8_t maxNodes,
                            uint32_t canRxCount,
                            bool sdMounted,
                            uint32_t sdEvents,
                            bool bleActive,
                            uint16_t bbRecords,
                            bool selfTest,
                            uint32_t nowMs);

    void drawNodeCard(int16_t x,
                      int16_t y,
                      int16_t w,
                      int16_t h,
                      const rules::TrackedAxleNode& node,
                      const char* pageBadge,
                      uint32_t nowMs);

    // Primitives clipped to the active band & round display area
    void clear(uint16_t color);
    void drawPixel(int16_t x, int16_t y, uint16_t color);
    void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
    void drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
    void fillRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color);
    void drawRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color);
    void fillCircle(int16_t cx, int16_t cy, int16_t r, uint16_t color);
    void drawCircle(int16_t cx, int16_t cy, int16_t r, uint16_t color);
    void drawRing(int16_t cx, int16_t cy, int16_t rOuter, int16_t thickness, uint16_t color);
    void drawRingSegment(int16_t cx, int16_t cy, int16_t rOuter, int16_t thickness,
                         int16_t startDeg, int16_t spanDeg, uint16_t color);
    void drawHBar(int16_t x, int16_t y, int16_t w, int16_t h,
                  float ratio, uint16_t fgColor, uint16_t bgColor, uint16_t borderColor);

    void drawChar5x7(int16_t x, int16_t y, uint8_t glyphIdx, uint16_t color, uint8_t scale);
    int16_t textWidthPx(const char* text, uint8_t scale) const;
    void drawText(int16_t x, int16_t y, const char* text, uint16_t color, uint8_t scale = 1);
    void drawTextCentered(int16_t cx, int16_t y, const char* text, uint16_t color, uint8_t scale = 1);

    SPIClass* spi_;
    uint16_t* buf_;
    int16_t   bandY0_;
    int16_t   bandH_;
    uint8_t   brightness_;
    bool      ready_;
    bool      usingPsram_;
};

} // namespace techbit
