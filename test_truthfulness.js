'use strict';

const assert = require('assert');
const { TechBitV2Engine } = require('./v2_engine');
const { createServer, generateV2SimPackets } = require('./server');

let passed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  [PASS] ${name}`);
    })
    .catch((err) => {
      console.error(`  [FAIL] ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

function makeAxlePacket(slot, overrides = {}) {
  return {
    type: 'techbit_c3_node',
    nodeId: `C3_SLOT${slot}`,
    slot,
    fromTrailer: slot >= 3,
    left: {
      rmsMv: 25.0,
      rmsMmS: 1.15,
      peakMmS: 3.0,
      crest: 2.6,
      dcOffsetMv: 1650,
      fDomHz: 240,
      clip: false,
      tempC: 34.0,
      rh: 44.0,
      shtOk: true,
      spectrum: new Array(32).fill(10),
      ...(overrides.left || {}),
    },
    right: {
      rmsMv: 25.5,
      rmsMmS: 1.18,
      peakMmS: 3.1,
      crest: 2.6,
      dcOffsetMv: 1648,
      fDomHz: 245,
      clip: false,
      tempC: 34.2,
      rh: 44.5,
      shtOk: true,
      spectrum: new Array(32).fill(10),
      ...(overrides.right || {}),
    },
    i2c: { sda: 8, scl: 9, addr: '0x44', err: 0 },
    can: { ready: true, tx: 10, err: 0 },
  };
}

async function runAll() {
  console.log('\nTechBIT v2.0 Workbench — Truthfulness & Rule Engine Test Suite\n');

  await test('1. Cold boot starts strictly OFFLINE / STANDBY with zero fake data', () => {
    const eng = new TechBitV2Engine();
    eng.update(1000);
    const snap = eng.getSnapshot(1000);
    assert.strictEqual(snap.indicator.driverSeverity, 'STANDBY');
    assert.strictEqual(snap.indicator.activeWheels, 0);
    assert.strictEqual(snap.bridge.online, false);
    assert.strictEqual(snap.s3Master.online, false);
    for (const ax of snap.axles) {
      assert.strictEqual(ax.online, false);
      assert.strictEqual(ax.left.severity, 'OFFLINE');
      assert.strictEqual(ax.right.severity, 'OFFLINE');
    }
  });

  await test('2. Honest timeout watchdog marks stale C3 nodes and Bridge OFFLINE', () => {
    const eng = new TechBitV2Engine({ nodeTimeoutMs: 5000 });
    eng.ingestPacket(makeAxlePacket(1), 1000);
    eng.ingestPacket(
      { type: 'techbit_trailer_bridge', trailerId: 'TL_042', paired: true, rssi: -55, seq: 1 },
      1000
    );
    eng.update(1100);
    assert.strictEqual(eng.axles[0].online, true);
    assert.strictEqual(eng.bridge.online, true);

    eng.update(7000);
    assert.strictEqual(eng.axles[0].online, false);
    assert.strictEqual(eng.axles[0].left.severity, 'OFFLINE');
    assert.strictEqual(eng.bridge.online, false);
    assert.strictEqual(eng.indicator.driverSeverity, 'STANDBY');
  });

  await test('3. Cobblestone road (all 5 axles high vibration) stays GREEN with roughRoadActive', () => {
    const eng = new TechBitV2Engine({ yellowConfirmSec: 5 });
    let t = 1000;
    for (let step = 0; step < 30; step++) {
      t += 500;
      const pkts = generateV2SimPackets('cobblestone', step * 500, step + 1);
      for (const p of pkts) eng.ingestPacket(p, t);
      eng.update(t);
    }
    assert.strictEqual(eng.indicator.roughRoadActive, true);
    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');
    assert.strictEqual(eng.burstEvents.length, 0);
  });

  await test('4. Single-wheel pothole clip triggers POTHOLE_GUARD without false alarm', () => {
    const eng = new TechBitV2Engine({ yellowConfirmSec: 5 });
    for (let s = 1; s <= 5; s++) eng.ingestPacket(makeAxlePacket(s), 1000);
    eng.update(1100);

    // Sudden BAT54S clipped pothole impact on P2-L (slot 4)
    eng.ingestPacket(
      makeAxlePacket(4, { left: { rmsMmS: 6.1, peakMmS: 26.0, crest: 6.3, clip: true } }),
      1300
    );
    eng.update(1400);

    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');
    assert.ok(eng.indicator.potholeCount >= 1);
    assert.strictEqual(eng.axles[3].lastReason, 'POTHOLE_GUARD');
    assert.strictEqual(eng.axles[3].left.clip, true);
  });

  await test('5. Sustained ΔT > 18°C latches YELLOW after 60s, then RED + buzzer on overheat', () => {
    const eng = new TechBitV2Engine({ yellowConfirmSec: 60, redConfirmSec: 5 });
    let t = 1000;
    // Establish normal baseline tick first
    for (let s = 1; s <= 5; s++) eng.ingestPacket(makeAxlePacket(s), t);
    eng.update(t);

    // 59 seconds at ΔT = 24°C on P2-L -> still GREEN (hysteresis)
    for (let sec = 0; sec < 59; sec++) {
      t += 1000;
      for (let s = 1; s <= 5; s++) {
        eng.ingestPacket(
          s === 4 ? makeAxlePacket(4, { left: { tempC: 58.0 }, right: { tempC: 34.0 } }) : makeAxlePacket(s),
          t
        );
      }
      eng.update(t);
    }
    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');

    // Cross 60 s -> YELLOW on P2-L + ANOMALY_BURST
    t += 1000;
    for (let s = 1; s <= 5; s++) {
      eng.ingestPacket(
        s === 4 ? makeAxlePacket(4, { left: { tempC: 58.0 }, right: { tempC: 34.0 } }) : makeAxlePacket(s),
        t
      );
    }
    eng.update(t);
    assert.strictEqual(eng.indicator.driverSeverity, 'YELLOW');
    assert.strictEqual(eng.indicator.wheelCode, 'P2-L');
    assert.strictEqual(eng.burstEvents.length, 1);
    assert.strictEqual(eng.burstEvents[0].packet_type, 'ANOMALY_BURST');

    // Escalate P2-L to 103°C for 5 seconds -> RED + active buzzer
    for (let sec = 0; sec < 6; sec++) {
      t += 1000;
      eng.ingestPacket(makeAxlePacket(4, { left: { tempC: 103.0 }, right: { tempC: 34.0 } }), t);
      eng.update(t);
    }
    assert.strictEqual(eng.indicator.driverSeverity, 'RED');
    assert.strictEqual(eng.indicator.wheelCode, 'P2-L');
    assert.strictEqual(eng.indicator.buzzerOn, true);

    eng.toggleMute();
    eng.update(t + 100);
    assert.strictEqual(eng.indicator.buzzerOn, false);
  });

  await test('6. Shadow Mode records ANOMALY_BURST silently while keeping driver LED GREEN', () => {
    const eng = new TechBitV2Engine({ shadowModeEnabled: true });
    const t = 2000;
    for (let s = 1; s <= 5; s++) {
      eng.ingestPacket(
        s === 3
          ? makeAxlePacket(3, { left: { tempC: 47.0, rmsMmS: 2.3 }, right: { tempC: 34.0, rmsMmS: 1.15 } })
          : makeAxlePacket(s),
        t
      );
    }
    eng.update(t + 100);
    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');
    assert.strictEqual(eng.indicator.shadowCount, 1);
    assert.strictEqual(eng.burstEvents[0].severity, 'SHADOW');
    assert.strictEqual(eng.burstEvents[0].wheel_code, 'P1-L');
  });

  await test('7. MCP6002 Vref fault, GY-SHT40 I2C fault, condensation RH >= 85%, and legacy v1 packet', () => {
    const eng = new TechBitV2Engine();
    eng.ingestPacket(
      makeAxlePacket(1, { left: { dcOffsetMv: 780 }, right: { rh: 91.5, shtOk: true } }),
      1000
    );
    eng.ingestPacket(
      {
        type: 'techbit_node',
        wheelId: 3,
        rmsMv: 42.0,
        peakMv: 110.0,
        crestFactor: 2.6,
        dcOffsetMv: 1652,
        dominantFreqHz: 320,
        tempC: 37.5,
        humidityPct: 48.0,
        sht40Ok: true,
      },
      1000
    );
    eng.update(1100);

    assert.strictEqual(eng.axles[0].left.vrefStatus, 'FAULT');
    assert.strictEqual(eng.axles[0].right.humidityWarn, true);
    assert.strictEqual(eng.axles[1].online, true);
    assert.strictEqual(eng.axles[1].right.tempC, 37.5);
  });

  await test('8. HTTP Server routes, live hardware disabling simulator, command queue, and CSV export', async () => {
    const { server } = createServer({ disableTimers: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // Static assets
      for (const p of ['/', '/styles.css', '/app.js']) {
        const res = await fetch(`${base}${p}`);
        assert.strictEqual(res.status, 200, `Expected 200 for ${p}`);
      }

      // Start simulator
      let res = await fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'simulator', enabled: true, scenario: 'smooth' }),
      });
      let data = await res.json();
      assert.strictEqual(data.state.source.mode, 'simulator');

      // Queue raw CLI command for ESP
      await fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raw', cmd: 'slot 4' }),
      });

      // Live hardware packet must automatically supersede simulator AND pop queued command
      res = await fetch(`${base}/api/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...makeAxlePacket(4, { left: { tempC: 105.0 } }), _source: 'serial' }),
      });
      const ack = await res.json();
      assert.strictEqual(ack.ok, true);
      assert.deepStrictEqual(ack.commands, ['slot 4']);

      // Set redConfirmSec = 0 via config API to confirm ticket creation + Ground Truth resolution
      await fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'config', config: { redConfirmSec: 0 } }),
      });

      res = await fetch(`${base}/api/state`);
      const st = await res.json();
      assert.strictEqual(st.source.mode, 'serial');
      assert.ok(st.incidents.length >= 1);

      const ticketId = st.incidents[0].ticket_id;
      await fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve_ticket', ticketId, resolutionCode: 'BRAKE_STUCK' }),
      });

      const csvRes = await fetch(`${base}/api/export.csv`);
      assert.strictEqual(csvRes.status, 200);
      const csv = await csvRes.text();
      assert.ok(csv.includes('ticket_id,event_id,created_at_utc'));
      assert.ok(csv.includes('BRAKE_STUCK'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  console.log(`\nSummary: ${passed} passed, ${process.exitCode ? 'FAILURES PRESENT' : '0 failed'}\n`);
}

runAll();
