#include <cmath>
#include <cstdint>
#include <unity.h>

#include "VibrationDSP.h"
#include "WheelClassifier.h"
#include "can_protocol.h"
#include "techbit_config.h"

using namespace techbit;

static constexpr float kPi = 3.14159265358979323846f;

void setUp(void) {}
void tearDown(void) {}

void test_fft_1000hz_sine_from_adc_counts(void) {
    dsp::VibrationDSP dsp;
    const float mvPerCount = kAdcFullScaleMv / static_cast<float>(kAdcMaxCounts);
    dsp.begin(static_cast<float>(kSampleRateHz), mvPerCount);

    // Simulate MCP6002 output from Multisim XSC1: 1650 mV DC + 300 mVpk @ 1000 Hz
    uint16_t raw[dsp::kDspFftSize];
    for (uint16_t n = 0; n < dsp::kDspFftSize; ++n) {
        float t  = static_cast<float>(n) / static_cast<float>(kSampleRateHz);
        float mv = 1650.0f + 300.0f * std::sin(2.0f * kPi * 1000.0f * t);
        raw[n]   = static_cast<uint16_t>(mv / mvPerCount + 0.5f);
    }

    dsp::VibrationFeatures f = dsp.processRawFrame(raw);

    TEST_ASSERT_FLOAT_WITHIN(15.0f, 1650.0f, f.dcOffsetMv);
    TEST_ASSERT_FLOAT_WITHIN(15.0f, 212.1f, f.rmsMv); // 300 / sqrt(2)
    TEST_ASSERT_FLOAT_WITHIN(12.0f, 1000.0f, f.dominantFreqHz);
    TEST_ASSERT_TRUE(f.bandMidRatio > 0.90f);
    TEST_ASSERT_TRUE(f.tonalityRatio > 6.0f);
    TEST_ASSERT_FALSE(f.surgeClipping);
}

void test_fft_4200hz_brake_squeal_and_surge_impulse(void) {
    dsp::VibrationDSP dsp;
    const float mvPerCount = kAdcFullScaleMv / static_cast<float>(kAdcMaxCounts);
    dsp.begin(static_cast<float>(kSampleRateHz), mvPerCount);

    // 4200 Hz high-frequency brake chatter
    float wave[dsp::kDspFftSize];
    for (uint16_t n = 0; n < dsp::kDspFftSize; ++n) {
        float t = static_cast<float>(n) / static_cast<float>(kSampleRateHz);
        wave[n] = 180.0f * std::sin(2.0f * kPi * 4200.0f * t);
    }

    dsp::VibrationFeatures fHigh = dsp.processCenteredMv(wave);
    TEST_ASSERT_FLOAT_WITHIN(15.0f, 4200.0f, fHigh.dominantFreqHz);
    TEST_ASSERT_TRUE(fHigh.bandHighRatio > 0.90f);

    // Sharp pothole impulse on top of low background
    uint16_t shockRaw[dsp::kDspFftSize];
    for (uint16_t n = 0; n < dsp::kDspFftSize; ++n) {
        float t  = static_cast<float>(n) / static_cast<float>(kSampleRateHz);
        float mv = 1650.0f + 20.0f * std::sin(2.0f * kPi * 200.0f * t);
        shockRaw[n] = static_cast<uint16_t>(mv / mvPerCount);
    }
    // Inject 3-sample clamping spike (hits BAT54S rail)
    shockRaw[120] = 4095;
    shockRaw[121] = 4090;
    shockRaw[122] = 10;

    dsp::VibrationFeatures fShock = dsp.processRawFrame(shockRaw, 25, 4070);
    TEST_ASSERT_TRUE(fShock.surgeClipping);
    TEST_ASSERT_TRUE(fShock.crestFactor > 4.5f);
    TEST_ASSERT_TRUE(fShock.kurtosis > 6.0f);
}

void test_can_protocol_pack_unpack_roundtrip(void) {
    can::WheelTelemetryPacket tx{};
    tx.wheelId            = WHEEL_FR;
    tx.rmsMv              = 143.7f;
    tx.peakMv             = 412.5f;
    tx.bandLowRatio       = 0.12f;
    tx.bandMidRatio       = 0.28f;
    tx.bandHighRatio      = 0.60f;
    tx.statusFlags        = can::FLAG_ADC_OK | can::FLAG_TEMP_VALID;
    tx.dominantFreqHz     = 3480;
    tx.spectralCentroidHz = 3920;
    tx.tonalityRatio      = 8.75f;
    tx.kurtosis           = 3.25f;
    tx.tempC              = 84.3f;

    uint8_t core[8];
    uint8_t spec[8];
    can::packCoreFrame(tx, core);
    can::packSpectralFrame(tx, spec);

    can::WheelTelemetryPacket rx{};
    rx.wheelId = WHEEL_FR;
    can::unpackCoreFrame(core, rx);
    can::unpackSpectralFrame(spec, rx);

    TEST_ASSERT_FLOAT_WITHIN(0.2f, tx.rmsMv, rx.rmsMv);
    TEST_ASSERT_FLOAT_WITHIN(0.2f, tx.peakMv, rx.peakMv);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, tx.bandLowRatio, rx.bandLowRatio);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, tx.bandMidRatio, rx.bandMidRatio);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, tx.bandHighRatio, rx.bandHighRatio);
    TEST_ASSERT_EQUAL_UINT8(tx.statusFlags, rx.statusFlags);
    TEST_ASSERT_EQUAL_UINT16(tx.dominantFreqHz, rx.dominantFreqHz);
    TEST_ASSERT_EQUAL_UINT16(tx.spectralCentroidHz, rx.spectralCentroidHz);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, tx.tonalityRatio, rx.tonalityRatio);
    TEST_ASSERT_FLOAT_WITHIN(0.1f, tx.kurtosis, rx.kurtosis);
    TEST_ASSERT_FLOAT_WITHIN(0.2f, tx.tempC, rx.tempC);
}

static can::WheelTelemetryPacket makePkt(uint8_t id, float rms, float peak,
                                         float bL, float bM, float bH,
                                         uint16_t fDom, uint16_t fCent,
                                         float ton, float kurt) {
    can::WheelTelemetryPacket p{};
    p.wheelId            = id;
    p.rmsMv              = rms;
    p.peakMv             = peak;
    p.bandLowRatio       = bL;
    p.bandMidRatio       = bM;
    p.bandHighRatio      = bH;
    p.statusFlags        = can::FLAG_ADC_OK;
    p.dominantFreqHz     = fDom;
    p.spectralCentroidHz = fCent;
    p.tonalityRatio      = ton;
    p.kurtosis           = kurt;
    return p;
}

void test_ml_bad_road_and_pothole_no_false_alarm(void) {
    ml::WheelClassifier clf;
    clf.init();

    // 1. Simulate 5 seconds of rough cobblestone road across ALL 4 wheels
    uint32_t t = 1000;
    for (int step = 0; step < 100; ++step) {
        t += 50;
        for (uint8_t w = 0; w < WHEEL_COUNT; ++w) {
            clf.onTelemetryPacket(
                makePkt(w, 155.0f, 470.0f, 0.62f, 0.28f, 0.10f, 280, 780, 3.1f, 3.6f), t);
        }
        clf.update(t);
    }

    TEST_ASSERT_EQUAL_UINT8(4, clf.summary().activeWheelCount);
    TEST_ASSERT_NOT_EQUAL(ml::ALERT_SERVICE_TO, clf.summary().alertLevel);
    TEST_ASSERT_EQUAL_UINT8(0, clf.summary().faultWheelMask);

    // 2. Simulate sharp pothole strike on FL only for 200 ms
    for (int step = 0; step < 4; ++step) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 190.0f, 1150.0f, 0.50f, 0.35f, 0.15f, 420, 1200, 3.4f, 10.5f), t);
        for (uint8_t w = 1; w < WHEEL_COUNT; ++w) {
            clf.onTelemetryPacket(
                makePkt(w, 28.0f, 75.0f, 0.56f, 0.32f, 0.12f, 260, 750, 2.8f, 3.0f), t);
        }
        clf.update(t);
    }

    TEST_ASSERT_EQUAL_UINT8(ml::CLASS_POTHOLE_IMPACT, clf.wheelState(WHEEL_FL).predictedClass);
    TEST_ASSERT_TRUE(clf.wheelState(WHEEL_FL).potholeCount >= 1);
    TEST_ASSERT_FALSE(clf.wheelState(WHEEL_FL).faultConfirmed);
}

void test_ml_sustained_brake_fault_confirmed_after_3s(void) {
    ml::WheelClassifier clf;
    clf.init();

    // Start with healthy baseline across 4 wheels
    uint32_t t = 1000;
    for (int step = 0; step < 10; ++step) {
        t += 50;
        for (uint8_t w = 0; w < WHEEL_COUNT; ++w) {
            clf.onTelemetryPacket(
                makePkt(w, 28.0f, 75.0f, 0.55f, 0.32f, 0.13f, 250, 760, 2.7f, 3.0f), t);
        }
        clf.update(t);
    }

    // Now FR develops sticking brake pad chatter (3400 Hz, high tonality, 5x peer RMS)
    // Check after 2.0s (>= 1.8s warning delay) -> ALERT_WARNING, not yet ALERT_SERVICE_TO!
    for (int step = 0; step < 40; ++step) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 29.0f, 78.0f, 0.55f, 0.32f, 0.13f, 260, 780, 2.8f, 3.0f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 150.0f, 410.0f, 0.10f, 0.25f, 0.65f, 3400, 4100, 8.8f, 3.2f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RL, 27.0f, 72.0f, 0.56f, 0.31f, 0.13f, 240, 740, 2.6f, 2.9f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RR, 28.0f, 76.0f, 0.55f, 0.32f, 0.13f, 255, 760, 2.7f, 3.0f), t);
        clf.update(t);
    }

    TEST_ASSERT_EQUAL_UINT8(ml::CLASS_ANOMALY_FAULT, clf.wheelState(WHEEL_FR).predictedClass);
    TEST_ASSERT_FALSE(clf.wheelState(WHEEL_FR).faultConfirmed);
    TEST_ASSERT_EQUAL_UINT8(ml::ALERT_WARNING, clf.summary().alertLevel);

    // Continue for another 1.5s (total 3.5s > 3.0s) -> must confirm ALERT_SERVICE_TO!
    for (int step = 0; step < 30; ++step) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 29.0f, 78.0f, 0.55f, 0.32f, 0.13f, 260, 780, 2.8f, 3.0f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 150.0f, 410.0f, 0.10f, 0.25f, 0.65f, 3400, 4100, 8.8f, 3.2f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RL, 27.0f, 72.0f, 0.56f, 0.31f, 0.13f, 240, 740, 2.6f, 2.9f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RR, 28.0f, 76.0f, 0.55f, 0.32f, 0.13f, 255, 760, 2.7f, 3.0f), t);
        clf.update(t);
    }

    TEST_ASSERT_TRUE(clf.wheelState(WHEEL_FR).faultConfirmed);
    TEST_ASSERT_EQUAL_UINT8(ml::ALERT_SERVICE_TO, clf.summary().alertLevel);
    TEST_ASSERT_EQUAL_UINT8(1U << WHEEL_FR, clf.summary().faultWheelMask);
}

void test_2_sensor_axle_mode_and_calibration(void) {
    ml::WheelClassifier clf;
    clf.init();

    // Run 2-second calibration in 2-sensor mode (FL & FR only)
    uint32_t t = 500;
    clf.startCalibration(t, 1000);
    bool calDone = false;
    for (int step = 0; step < 25; ++step) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 42.0f, 110.0f, 0.55f, 0.32f, 0.13f, 260, 760, 2.7f, 3.0f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 38.0f, 102.0f, 0.55f, 0.32f, 0.13f, 260, 760, 2.7f, 3.0f), t);
        bool done = false;
        clf.update(t, &done);
        if (done) calDone = true;
    }

    TEST_ASSERT_TRUE(calDone);
    TEST_ASSERT_EQUAL_UINT8(2, clf.summary().activeWheelCount);
    TEST_ASSERT_FLOAT_WITHIN(2.0f, 42.0f, clf.getWheelBaseline(WHEEL_FL));
    TEST_ASSERT_FLOAT_WITHIN(2.0f, 38.0f, clf.getWheelBaseline(WHEEL_FR));
}

void test_single_wheel_pothole_with_clipping_and_cascade_guard(void) {
    ml::WheelClassifier clf;
    clf.init();

    uint32_t t = 3000;
    // Smooth baseline
    for (int i = 0; i < 10; ++i) {
        t += 50;
        for (uint8_t w = 0; w < WHEEL_COUNT; ++w) {
            clf.onTelemetryPacket(
                makePkt(w, 28.0f, 75.0f, 0.56f, 0.32f, 0.12f, 250, 750, 2.7f, 3.0f), t);
        }
        clf.update(t);
    }

    // 1. FL hits deep pothole causing BAT54S clamping (flattens crest slightly to 3.6)
    for (int i = 0; i < 3; ++i) {
        t += 50;
        auto shock = makePkt(WHEEL_FL, 220.0f, 790.0f, 0.48f, 0.36f, 0.16f, 410, 1150, 3.3f, 4.4f);
        shock.statusFlags |= can::FLAG_SURGE_CLIPPING;
        clf.onTelemetryPacket(shock, t);
        for (uint8_t w = 1; w < WHEEL_COUNT; ++w) {
            clf.onTelemetryPacket(
                makePkt(w, 28.0f, 75.0f, 0.56f, 0.32f, 0.12f, 250, 750, 2.7f, 3.0f), t);
        }
        clf.update(t);
    }
    TEST_ASSERT_EQUAL_UINT8(ml::CLASS_POTHOLE_IMPACT, clf.wheelState(WHEEL_FL).predictedClass);

    // 2. Next 400 ms: FL suspension rings + RL (rear wheel on same track) hits the same pothole!
    for (int i = 0; i < 8; ++i) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 95.0f, 320.0f, 0.40f, 0.42f, 0.18f, 520, 1300, 3.8f, 3.6f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 28.0f, 75.0f, 0.56f, 0.32f, 0.12f, 250, 750, 2.7f, 3.0f), t);
        float rlRms = (i >= 3 && i <= 5) ? 185.0f : 29.0f;
        float rlPeak = (i >= 3 && i <= 5) ? 720.0f : 78.0f;
        clf.onTelemetryPacket(
            makePkt(WHEEL_RL, rlRms, rlPeak, 0.45f, 0.38f, 0.17f, 450, 1250, 3.5f, 4.8f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RR, 28.0f, 75.0f, 0.56f, 0.32f, 0.12f, 250, 750, 2.7f, 3.0f), t);
        clf.update(t);
        TEST_ASSERT_NOT_EQUAL(ml::ALERT_WARNING, clf.summary().alertLevel);
        TEST_ASSERT_NOT_EQUAL(ml::ALERT_SERVICE_TO, clf.summary().alertLevel);
    }

    TEST_ASSERT_EQUAL_UINT8(0, clf.summary().faultWheelMask);
    TEST_ASSERT_TRUE(clf.wheelState(WHEEL_FL).potholeCount >= 1);
}

void test_smooth_to_10km_cobblestone_axle_transition_no_false_alarm(void) {
    ml::WheelClassifier clf;
    clf.init();

    uint32_t t = 3000;
    // Phase 1: Smooth asphalt (1.0 s)
    for (int i = 0; i < 20; ++i) {
        t += 50;
        for (uint8_t w = 0; w < WHEEL_COUNT; ++w) {
            clf.onTelemetryPacket(
                makePkt(w, 26.0f, 72.0f, 0.56f, 0.32f, 0.12f, 240, 720, 2.7f, 3.0f), t);
        }
        clf.update(t);
    }
    TEST_ASSERT_EQUAL_UINT8(ml::ROAD_SMOOTH, clf.summary().roadState);

    // Phase 2: Sudden transition onto cobblestones — FRONT AXLE (FL+FR) hits rough stone for 1.5 s
    // while long truck rear axle (RL+RR) is still rolling on smooth asphalt!
    for (int i = 0; i < 30; ++i) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 175.0f, 540.0f, 0.62f, 0.28f, 0.10f, 280, 780, 3.1f, 3.6f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 184.0f, 560.0f, 0.60f, 0.29f, 0.11f, 290, 810, 3.2f, 3.5f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RL, 27.0f, 73.0f, 0.56f, 0.32f, 0.12f, 240, 730, 2.7f, 3.0f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RR, 26.0f, 71.0f, 0.56f, 0.32f, 0.12f, 245, 720, 2.6f, 3.0f), t);
        clf.update(t);

        TEST_ASSERT_EQUAL_UINT32(0, clf.wheelState(WHEEL_FL).anomalyAccumMs);
        TEST_ASSERT_EQUAL_UINT32(0, clf.wheelState(WHEEL_FR).anomalyAccumMs);
        TEST_ASSERT_NOT_EQUAL(ml::ALERT_WARNING, clf.summary().alertLevel);
        TEST_ASSERT_NOT_EQUAL(ml::ALERT_SERVICE_TO, clf.summary().alertLevel);
    }

    // Phase 3: Now ALL 4 wheels roll over 10 km uneven cobblestones for 12 s (with slight wheel spread)
    for (int i = 0; i < 240; ++i) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 160.0f, 490.0f, 0.64f, 0.26f, 0.10f, 270, 760, 3.0f, 3.5f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 195.0f, 610.0f, 0.61f, 0.28f, 0.11f, 295, 820, 3.2f, 3.7f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RL, 145.0f, 450.0f, 0.65f, 0.25f, 0.10f, 260, 740, 2.9f, 3.4f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RR, 210.0f, 650.0f, 0.60f, 0.28f, 0.12f, 310, 840, 3.3f, 3.8f), t);
        clf.update(t);

        TEST_ASSERT_NOT_EQUAL(ml::ALERT_WARNING, clf.summary().alertLevel);
        TEST_ASSERT_NOT_EQUAL(ml::ALERT_SERVICE_TO, clf.summary().alertLevel);
    }

    TEST_ASSERT_EQUAL_UINT8(ml::ROAD_COBBLESTONE, clf.summary().roadState);
    TEST_ASSERT_EQUAL_UINT8(0, clf.summary().faultWheelMask);
}

void test_one_side_rumble_strip_and_standstill_behavior(void) {
    ml::WheelClassifier clf;
    clf.init();

    uint32_t t = 3000;
    // Right wheels (FR + RR) ride along shoulder rumble strip for 4.0 s while left stays smooth
    for (int i = 0; i < 80; ++i) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 26.0f, 70.0f, 0.56f, 0.32f, 0.12f, 240, 720, 2.6f, 3.0f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RL, 27.0f, 72.0f, 0.56f, 0.32f, 0.12f, 245, 730, 2.7f, 3.0f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 145.0f, 440.0f, 0.62f, 0.28f, 0.10f, 310, 830, 3.2f, 3.5f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RR, 152.0f, 460.0f, 0.61f, 0.28f, 0.11f, 320, 850, 3.3f, 3.6f), t);
        clf.update(t);
    }
    TEST_ASSERT_EQUAL_UINT8(0, clf.summary().faultWheelMask);
    TEST_ASSERT_NOT_EQUAL(ml::ALERT_SERVICE_TO, clf.summary().alertLevel);

    // Stop at a traffic light (< kStandstillRmsMv = 7.0 mV)
    for (int i = 0; i < 20; ++i) {
        t += 50;
        for (uint8_t w = 0; w < WHEEL_COUNT; ++w) {
            clf.onTelemetryPacket(
                makePkt(w, 3.0f, 8.0f, 0.40f, 0.30f, 0.30f, 0, 0, 1.5f, 3.0f), t);
        }
        clf.update(t);
    }
    TEST_ASSERT_TRUE(clf.summary().standstill);
    TEST_ASSERT_EQUAL_UINT8(ml::ROAD_STANDSTILL, clf.summary().roadState);
    TEST_ASSERT_EQUAL_UINT8(ml::ALERT_OK, clf.summary().alertLevel);
}

void test_real_fault_over_cobblestone_detected(void) {
    ml::WheelClassifier clf;
    clf.init();

    uint32_t t = 3000;
    // Driving on cobblestones, AND FR caliper sticks producing high-freq squeal > 2.2x peers
    for (int i = 0; i < 80; ++i) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 140.0f, 430.0f, 0.63f, 0.27f, 0.10f, 270, 760, 3.0f, 3.5f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 330.0f, 950.0f, 0.08f, 0.26f, 0.66f, 3600, 4200, 8.6f, 3.2f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RL, 145.0f, 440.0f, 0.62f, 0.28f, 0.10f, 280, 770, 3.1f, 3.6f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RR, 138.0f, 420.0f, 0.64f, 0.26f, 0.10f, 265, 750, 2.9f, 3.5f), t);
        clf.update(t);
    }

    TEST_ASSERT_TRUE(clf.wheelState(WHEEL_FR).faultConfirmed);
    TEST_ASSERT_EQUAL_UINT8(ml::ALERT_SERVICE_TO, clf.summary().alertLevel);
    TEST_ASSERT_EQUAL_UINT8(1U << WHEEL_FR, clf.summary().faultWheelMask);
}

void test_dead_piezo_watchdog_startup_blanking_and_buzzer_mute(void) {
    ml::WheelClassifier clf;
    clf.init();
    clf.setStartupBlanking(2000);

    uint32_t t = 100;
    // During ACC cranking blanking (< 2000 ms), transients must not accumulate
    for (int i = 0; i < 20; ++i) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 220.0f, 650.0f, 0.10f, 0.25f, 0.65f, 3500, 4000, 8.5f, 3.2f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 28.0f, 75.0f, 0.55f, 0.32f, 0.13f, 250, 760, 2.7f, 3.0f), t);
        clf.update(t);
    }
    TEST_ASSERT_EQUAL_UINT32(0, clf.wheelState(WHEEL_FL).anomalyAccumMs);

    // Move past blanking (t >= 2000): RL piezo is disconnected (< 1.8 mV) while others roll @ 45 mV
    t = 2100;
    for (int i = 0; i < 110; ++i) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 45.0f, 120.0f, 0.55f, 0.32f, 0.13f, 260, 760, 2.7f, 3.0f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 46.0f, 122.0f, 0.55f, 0.32f, 0.13f, 260, 760, 2.7f, 3.0f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RL, 0.6f, 1.5f, 0.34f, 0.33f, 0.33f, 0, 0, 1.0f, 3.0f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RR, 44.0f, 118.0f, 0.55f, 0.32f, 0.13f, 260, 760, 2.7f, 3.0f), t);
        clf.update(t);
    }
    TEST_ASSERT_TRUE(clf.wheelState(WHEEL_RL).sensorDead);
    TEST_ASSERT_EQUAL_UINT8(1U << WHEEL_RL, clf.summary().deadSensorMask);
    TEST_ASSERT_EQUAL_UINT8(0, clf.summary().faultWheelMask);

    // Trigger real fault on FL (> 3.0 s), mute buzzer, then trigger NEW fault on RR -> auto-unmute
    for (int i = 0; i < 70; ++i) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 210.0f, 600.0f, 0.10f, 0.25f, 0.65f, 3500, 4100, 8.7f, 3.2f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 45.0f, 120.0f, 0.55f, 0.32f, 0.13f, 260, 760, 2.7f, 3.0f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RR, 44.0f, 118.0f, 0.55f, 0.32f, 0.13f, 260, 760, 2.7f, 3.0f), t);
        clf.update(t);
    }
    TEST_ASSERT_TRUE(clf.wheelState(WHEEL_FL).faultConfirmed);
    clf.toggleBuzzerMute();
    TEST_ASSERT_TRUE(clf.summary().buzzerMuted);

    // Second wheel (RR) also fails -> buzzer must auto-unmute so driver notices the new fault
    for (int i = 0; i < 70; ++i) {
        t += 50;
        clf.onTelemetryPacket(
            makePkt(WHEEL_FL, 210.0f, 600.0f, 0.10f, 0.25f, 0.65f, 3500, 4100, 8.7f, 3.2f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_FR, 45.0f, 120.0f, 0.55f, 0.32f, 0.13f, 260, 760, 2.7f, 3.0f), t);
        clf.onTelemetryPacket(
            makePkt(WHEEL_RR, 225.0f, 630.0f, 0.12f, 0.58f, 0.30f, 1450, 1950, 9.2f, 3.3f), t);
        clf.update(t);
    }
    TEST_ASSERT_TRUE(clf.wheelState(WHEEL_RR).faultConfirmed);
    TEST_ASSERT_FALSE(clf.summary().buzzerMuted);
}

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_fft_1000hz_sine_from_adc_counts);
    RUN_TEST(test_fft_4200hz_brake_squeal_and_surge_impulse);
    RUN_TEST(test_can_protocol_pack_unpack_roundtrip);
    RUN_TEST(test_ml_bad_road_and_pothole_no_false_alarm);
    RUN_TEST(test_ml_sustained_brake_fault_confirmed_after_3s);
    RUN_TEST(test_2_sensor_axle_mode_and_calibration);
    RUN_TEST(test_single_wheel_pothole_with_clipping_and_cascade_guard);
    RUN_TEST(test_smooth_to_10km_cobblestone_axle_transition_no_false_alarm);
    RUN_TEST(test_one_side_rumble_strip_and_standstill_behavior);
    RUN_TEST(test_real_fault_over_cobblestone_detected);
    RUN_TEST(test_dead_piezo_watchdog_startup_blanking_and_buzzer_mute);
    return UNITY_END();
}
