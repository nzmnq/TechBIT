#include <cmath>
#include <cstdint>
#include <cstring>
#include <unity.h>

#include "BlackBoxBuffer.h"
#include "RuleConfig.h"
#include "RuleEngine.h"
#include "VibrationDSP.h"
#include "can_protocol_v2.h"
#include "esp_now_protocol.h"
#include "techbit_config.h"

using namespace techbit;

static constexpr float kPi = 3.14159265358979323846f;

void setUp(void) {}
void tearDown(void) {}

void test_c3_edge_dsp_256pt_fft_1000hz_sine(void) {
    dsp::VibrationDSP dsp;
    const float mvPerCount = kAdcFullScaleMv / static_cast<float>(kAdcMaxCounts);
    dsp.begin(static_cast<float>(kAdcPerChannelVibHz), mvPerCount);

    uint16_t raw[kDspFftSize];
    for (uint16_t n = 0; n < kDspFftSize; ++n) {
        const float t  = static_cast<float>(n) / static_cast<float>(kAdcPerChannelVibHz);
        const float mv = 1650.0f + 300.0f * std::sin(2.0f * kPi * 1000.0f * t);
        raw[n]         = static_cast<uint16_t>(mv / mvPerCount + 0.5f);
    }

    const dsp::VibrationFeatures f = dsp.processRawFrame(raw);
    TEST_ASSERT_FLOAT_WITHIN(15.0f, 1650.0f, f.dcOffsetMv);
    TEST_ASSERT_FLOAT_WITHIN(15.0f, 212.1f, f.rmsMv);
    TEST_ASSERT_FLOAT_WITHIN(15.0f, 1000.0f, f.dominantFreqHz);
    TEST_ASSERT_FALSE(f.surgeClipping);
}

void test_can_v2_extended_29bit_node_roundtrip(void) {
    const uint32_t nodeId = 0x998877U;
    const uint32_t extId  = can2::makeExtId(can2::MSG_AXLE_TEMP_META, nodeId);
    TEST_ASSERT_EQUAL_UINT8(can2::MSG_AXLE_TEMP_META, can2::extractMsgType(extId));
    TEST_ASSERT_EQUAL_UINT32(nodeId, can2::extractNodeId(extId));

    can2::AxleTelemetry tx{};
    tx.nodeId         = nodeId;
    tx.tempLeftC      = 78.4f;
    tx.tempRightC     = 34.1f;
    tx.vibRmsLeft     = 4.12f;
    tx.vibRmsRight    = 1.05f;
    tx.vibPeakLeft    = 12.5f;
    tx.vibPeakRight   = 3.1f;
    tx.crestLeft      = 3.0f;
    tx.crestRight     = 2.9f;
    tx.domFreqLeftHz  = 1480;
    tx.domFreqRightHz = 320;
    tx.statusFlags    = can2::FLAG_LEFT_OK | can2::FLAG_RIGHT_OK;
    tx.seq            = 42;

    uint8_t fVib[8], fTemp[8];
    can2::packAxleVibFrame(tx, fVib);
    can2::packAxleTempFrame(tx, fTemp);

    can2::AxleTelemetry rx{};
    rx.nodeId = nodeId;
    can2::unpackAxleVibFrame(fVib, rx);
    can2::unpackAxleTempFrame(fTemp, rx);

    TEST_ASSERT_FLOAT_WITHIN(0.2f, tx.tempLeftC, rx.tempLeftC);
    TEST_ASSERT_FLOAT_WITHIN(0.2f, tx.tempRightC, rx.tempRightC);
    TEST_ASSERT_FLOAT_WITHIN(0.05f, tx.vibRmsLeft, rx.vibRmsLeft);
    TEST_ASSERT_FLOAT_WITHIN(0.05f, tx.vibRmsRight, rx.vibRmsRight);
    TEST_ASSERT_EQUAL_UINT8(tx.statusFlags, rx.statusFlags);
    TEST_ASSERT_EQUAL_UINT8(tx.seq, rx.seq);
}

void test_esp_now_trailer_bridge_crc_packet_roundtrip(void) {
    espnow2::TrailerTelemetryPacket tx{};
    std::snprintf(tx.trailerId, sizeof(tx.trailerId), "TL_042");
    tx.sequence  = 77;
    tx.nodeCount = 2;

    can2::AxleTelemetry ax1{};
    ax1.nodeId      = 0x998876U;
    ax1.tempLeftC   = 33.4f;
    ax1.tempRightC  = 34.1f;
    ax1.vibRmsLeft  = 1.15f;
    ax1.vibRmsRight = 1.18f;

    can2::AxleTelemetry ax2{};
    ax2.nodeId      = 0x998877U;
    ax2.tempLeftC   = 78.4f;
    ax2.tempRightC  = 34.1f;
    ax2.vibRmsLeft  = 4.12f;
    ax2.vibRmsRight = 1.05f;

    tx.nodes[0] = espnow2::toCompactRecord(ax1);
    tx.nodes[1] = espnow2::toCompactRecord(ax2);
    espnow2::finalizeTelemetryCrc(tx);

    espnow2::TrailerTelemetryPacket rx{};
    TEST_ASSERT_TRUE(espnow2::validateTelemetryPacket(
        reinterpret_cast<const uint8_t*>(&tx), sizeof(tx), rx));
    TEST_ASSERT_EQUAL_STRING("TL_042", rx.trailerId);
    TEST_ASSERT_EQUAL_UINT8(2, rx.nodeCount);

    can2::AxleTelemetry decodedAx2 = espnow2::fromCompactRecord(rx.nodes[1]);
    TEST_ASSERT_FLOAT_WITHIN(0.2f, 78.4f, decodedAx2.tempLeftC);
    TEST_ASSERT_FLOAT_WITHIN(0.05f, 4.12f, decodedAx2.vibRmsLeft);

    // Corrupt 1 byte -> CRC must reject
    uint8_t corrupted[sizeof(tx)];
    std::memcpy(corrupted, &tx, sizeof(tx));
    corrupted[20] ^= 0xFF;
    TEST_ASSERT_FALSE(espnow2::validateTelemetryPacket(corrupted, sizeof(corrupted), rx));
}

void test_rule_engine_pothole_and_cobblestone_suppressed(void) {
    rules::RuleEngine engine;
    engine.init();
    engine.assignNodeSlot(0x110011U, rules::SLOT_TRACTOR_A1);
    engine.assignNodeSlot(0x110012U, rules::SLOT_TRACTOR_A2);

    uint32_t t = 1000;
    // Both axles vibrate symmetrically on cobblestone for 70 seconds, normal temp
    for (int i = 0; i < 70; ++i) {
        t += 1000;
        can2::AxleTelemetry f{0x110011U, 34.0f, 34.5f, 4.2f, 4.4f, 12.0f, 12.5f, 2.9f, 2.9f, 280, 290, 3, 0};
        can2::AxleTelemetry r{0x110012U, 35.0f, 34.8f, 4.1f, 4.3f, 11.8f, 12.1f, 2.8f, 2.9f, 270, 280, 3, 0};
        engine.onAxleTelemetry(f, false, t);
        engine.onAxleTelemetry(r, false, t);
        auto trig = engine.update(t);
        TEST_ASSERT_FALSE(trig.triggered);
        TEST_ASSERT_EQUAL_UINT8(rules::SEV_GREEN, engine.indicator().driverSeverity);
    }

    // Sharp single-wheel pothole strike (high crest = 6.5, normal temp) -> no YELLOW
    for (int i = 0; i < 3; ++i) {
        t += 1000;
        can2::AxleTelemetry f{0x110011U, 34.0f, 34.5f, 5.8f, 1.1f, 22.0f, 3.0f, 6.5f, 2.5f, 310, 240, 3, 0};
        can2::AxleTelemetry r{0x110012U, 35.0f, 34.8f, 1.1f, 1.1f, 3.2f, 3.1f, 2.6f, 2.5f, 240, 245, 3, 0};
        engine.onAxleTelemetry(f, false, t);
        engine.onAxleTelemetry(r, false, t);
        engine.update(t);
        TEST_ASSERT_EQUAL_UINT8(rules::SEV_GREEN, engine.indicator().driverSeverity);
    }
}

void test_rule_engine_sustained_delta_temp_yellow_after_60s_with_wheel_code(void) {
    rules::RuleEngine engine;
    engine.init();
    engine.setAssetIds("TR_001", "TL_042");
    engine.assignNodeSlot(0x110011U, rules::SLOT_TRACTOR_A1);
    engine.assignNodeSlot(0x998877U, rules::SLOT_TRAILER_A2); // P2-L / P2-R

    uint32_t t = 5000;
    bool triggeredYellow = false;

    // Simulate P2-L moderate overheating to 58.0°C while P2-R is 34.0°C (ΔT = 24.0°C -> YELLOW band 18..35°C)
    // Wait 55 s -> still GREEN (must wait > 60s hysteresis)
    for (int i = 0; i < 55; ++i) {
        t += 1000;
        can2::AxleTelemetry tr{0x110011U, 33.0f, 33.5f, 1.1f, 1.1f, 3.0f, 3.0f, 2.6f, 2.6f, 250, 250, 3, 0};
        can2::AxleTelemetry p2{0x998877U, 58.0f, 34.0f, 3.2f, 1.0f, 9.5f, 3.1f, 2.9f, 2.7f, 1200, 250, 3, 0};
        engine.onAxleTelemetry(tr, false, t);
        engine.onAxleTelemetry(p2, true, t);
        engine.update(t);
        TEST_ASSERT_EQUAL_UINT8(rules::SEV_GREEN, engine.indicator().driverSeverity);
    }

    // Continue past 60 s -> triggers SEV_YELLOW & wheel code "P2-L"!
    for (int i = 0; i < 8; ++i) {
        t += 1000;
        can2::AxleTelemetry tr{0x110011U, 33.0f, 33.5f, 1.1f, 1.1f, 3.0f, 3.0f, 2.6f, 2.6f, 250, 250, 3, 0};
        can2::AxleTelemetry p2{0x998877U, 58.0f, 34.0f, 3.2f, 1.0f, 9.5f, 3.1f, 2.9f, 2.7f, 1200, 250, 3, 0};
        engine.onAxleTelemetry(tr, false, t);
        engine.onAxleTelemetry(p2, true, t);
        auto evt = engine.update(t);
        if (evt.triggered && evt.severity == rules::SEV_YELLOW) {
            triggeredYellow = true;
            TEST_ASSERT_EQUAL_STRING("P2-L", evt.wheelCode);
            TEST_ASSERT_EQUAL_UINT32(0x998877U, evt.triggerNodeId);
        }
    }

    TEST_ASSERT_TRUE(triggeredYellow);
    TEST_ASSERT_EQUAL_UINT8(rules::SEV_YELLOW, engine.indicator().driverSeverity);
    TEST_ASSERT_EQUAL_STRING("P2-L", engine.indicator().wheelCode);
    TEST_ASSERT_FALSE(engine.indicator().buzzerOn);

    // Now simulate critical overheat (104°C) -> triggers SEV_RED & cabin buzzer within ~5s!
    bool triggeredRed = false;
    for (int i = 0; i < 6; ++i) {
        t += 1000;
        can2::AxleTelemetry p2{0x998877U, 104.0f, 34.0f, 6.8f, 1.0f, 18.0f, 3.1f, 3.0f, 2.7f, 1200, 250, 3, 0};
        engine.onAxleTelemetry(p2, true, t);
        auto evt = engine.update(t);
        if (evt.triggered && evt.severity == rules::SEV_RED) {
            triggeredRed = true;
        }
    }
    TEST_ASSERT_TRUE(triggeredRed);
    TEST_ASSERT_EQUAL_UINT8(rules::SEV_RED, engine.indicator().driverSeverity);
    TEST_ASSERT_TRUE(engine.indicator().buzzerOn);
}

void test_rule_engine_shadow_mode_and_remote_json_config(void) {
    rules::RuleEngine engine;
    engine.init();
    engine.assignNodeSlot(0x220022U, rules::SLOT_TRACTOR_A2);

    const char* cloudCfg =
        "{\"temp_warn_c\":68.0,\"axle_temp_delta_warn_c\":16.0,\"yellow_confirm_sec\":45,\"shadow_mode_enabled\":true}";
    TEST_ASSERT_TRUE(rules::applyJsonConfigUpdate(cloudCfg, engine.config()));
    TEST_ASSERT_FLOAT_WITHIN(0.1f, 68.0f, engine.config().tempWarnC);
    TEST_ASSERT_EQUAL_UINT32(45000U, engine.config().yellowConfirmMs);

    // Subtle right-side thermal rise (ΔT = 12°C, below 16°C YELLOW) -> triggers SHADOW cloud burst silently!
    uint32_t t = 2000;
    can2::AxleTelemetry ax{0x220022U, 34.0f, 46.0f, 1.1f, 2.1f, 3.0f, 6.0f, 2.7f, 2.8f, 250, 950, 3, 0};
    engine.onAxleTelemetry(ax, false, t);
    auto evt = engine.update(t);

    TEST_ASSERT_TRUE(evt.triggered);
    TEST_ASSERT_EQUAL_UINT8(rules::SEV_SHADOW, evt.severity);
    // Driver cab LED must remain calm GREEN!
    TEST_ASSERT_EQUAL_UINT8(rules::SEV_GREEN, engine.indicator().driverSeverity);
}

void test_black_box_ring_buffer_and_ingest_json_contract(void) {
    rules::BlackBoxBuffer bb;
    bb.reset();

    can2::AxleTelemetry ax{0x998877U, 78.4f, 34.1f, 4.12f, 1.05f, 12.5f, 3.1f, 3.0f, 2.8f, 1200, 250, 1, 1};
    bb.pushSample(1795455900UL, ax);
    bb.pushSample(1795455901UL, ax);
    TEST_ASSERT_EQUAL_UINT16(2, bb.size());

    char ts[24];
    rules::BlackBoxBuffer::formatIsoUtc(1795455900UL, ts);
    TEST_ASSERT_NOT_NULL(std::strchr(ts, 'T'));
    TEST_ASSERT_NOT_NULL(std::strchr(ts, 'Z'));

    char json[1500];
    bb.buildAnomalyBurstJson(
        json, sizeof(json),
        "S3_A1B2C3",
        "TR_001",
        "TL_042",
        ts,
        "550e8400-e29b-41d4-a716-446655440000",
        "YELLOW",
        0x998877U,
        "TEMP_DELTA_HIGH",
        &ax,
        1);

    TEST_ASSERT_NOT_NULL(std::strstr(json, "\"protocol_version\":1"));
    TEST_ASSERT_NOT_NULL(std::strstr(json, "\"packet_type\":\"ANOMALY_BURST\""));
    TEST_ASSERT_NOT_NULL(std::strstr(json, "\"tractor_id\":\"TR_001\""));
    TEST_ASSERT_NOT_NULL(std::strstr(json, "\"trailer_id\":\"TL_042\""));
    TEST_ASSERT_NOT_NULL(std::strstr(json, "\"trigger_node_id\":\"C3_998877\""));
    TEST_ASSERT_NOT_NULL(std::strstr(json, "\"burst_samples_base64\":"));
}

int main(int argc, char** argv) {
    UNITY_BEGIN();
    RUN_TEST(test_c3_edge_dsp_256pt_fft_1000hz_sine);
    RUN_TEST(test_can_v2_extended_29bit_node_roundtrip);
    RUN_TEST(test_esp_now_trailer_bridge_crc_packet_roundtrip);
    RUN_TEST(test_rule_engine_pothole_and_cobblestone_suppressed);
    RUN_TEST(test_rule_engine_sustained_delta_temp_yellow_after_60s_with_wheel_code);
    RUN_TEST(test_rule_engine_shadow_mode_and_remote_json_config);
    RUN_TEST(test_black_box_ring_buffer_and_ingest_json_contract);
    return UNITY_END();
}
