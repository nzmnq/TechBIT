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
      kurtosis: 3.05,
      hfEnergy: 0.24,
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
      kurtosis: 3.08,
      hfEnergy: 0.25,
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
  console.log('\nTechBIT v2.3 ML & React Router SPA — Truthfulness, Auto-Baseline & Dataset Test Suite\n');

  await test('1. Cold boot defaults to Hyundai Santa Fe (crossover) + mvp_front strictly OFFLINE', () => {
    const eng = new TechBitV2Engine();
    eng.update(1000);
    const snap = eng.getSnapshot(1000);
    assert.strictEqual(snap.config.rigProfile, 'mvp_front');
    assert.strictEqual(snap.config.vehicleClass, 'crossover');
    assert.strictEqual(snap.indicator.expectedWheels, 2);
    assert.strictEqual(snap.indicator.driverSeverity, 'STANDBY');
  });

  await test('2. Independent per-module sensor config for T1-L, T1-R, and S3 Master', () => {
    const eng = new TechBitV2Engine({ rigProfile: 'mvp_front' });
    eng.updateConfig({
      moduleSensors: {
        frontLeft: { vib: 'piezo_mcp6002', temp: 'sht40' },
        frontRight: { vib: 'mems_imu', temp: 'ntc' },
        s3Master: { mode: 's3_usb_bench', link: 'usb_direct' },
      },
    });
    eng.ingestPacket(
      makeAxlePacket(1, {
        left: { dcOffsetMv: 760, rh: 91.0, shtOk: true },
        right: { dcOffsetMv: 760, rh: 91.0, shtOk: true },
      }),
      1000
    );
    eng.update(1100);
    assert.strictEqual(eng.axles[0].left.vrefStatus, 'FAULT');
    assert.strictEqual(eng.axles[0].left.humidityWarn, true);
    assert.strictEqual(eng.axles[0].right.vrefStatus, 'NA');
    assert.strictEqual(eng.axles[0].right.humidityWarn, false);
  });

  await test('3. Hyundai Santa Fe Auto-Baseline + Kurtosis/HF catches low-RMS bearing fault (1.15 mm/s)', () => {
    const eng = new TechBitV2Engine({
      rigProfile: 'mvp_front',
      vehicleClass: 'crossover',
      baselineMinSamples: 20,
      yellowConfirmSec: 8,
      redConfirmSec: 5,
    });
    let t = 1000;

    // 25 calm Santa Fe frames (~0.45 mm/s) -> learns own quiet baseline
    for (let i = 0; i < 25; i++) {
      t += 1000;
      const j = i % 2 === 0 ? 0.03 : -0.03;
      eng.ingestPacket(
        makeAxlePacket(1, {
          left: { rmsMmS: 0.45 + j, kurtosis: 3.0, hfEnergy: 0.24, tempC: 31.0 },
          right: { rmsMmS: 0.46 - j, kurtosis: 3.1, hfEnergy: 0.25, tempC: 31.2 },
        }),
        t
      );
      eng.update(t);
    }
    assert.strictEqual(eng.axles[0].left.baseline.ready, true);
    assert.strictEqual(eng.axles[0].right.baseline.ready, true);
    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');

    // Early worn bearing on T1-R: only 1.15 mm/s (3x below truck 3.5 mm/s!), but kurtosis=6.4, HF=0.64 -> YELLOW!
    for (let i = 0; i < 10; i++) {
      t += 1000;
      eng.ingestPacket(
        makeAxlePacket(1, {
          left: { rmsMmS: 0.46, kurtosis: 3.0, hfEnergy: 0.24, tempC: 31.5 },
          right: { rmsMmS: 1.15, kurtosis: 6.4, hfEnergy: 0.64, tempC: 35.5 },
        }),
        t
      );
      eng.update(t);
    }
    assert.strictEqual(eng.indicator.driverSeverity, 'YELLOW');
    assert.strictEqual(eng.indicator.wheelCode, 'T1-R');
    assert.strictEqual(eng.axles[0].lastReason, 'ML_BEARING_IMPULSE');
  });

  await test('4. MVP 2-wheel cobblestone stays GREEN with roughRoadActive=true', () => {
    const eng = new TechBitV2Engine({ rigProfile: 'mvp_front', vehicleClass: 'crossover', yellowConfirmSec: 5 });
    let t = 1000;
    for (let step = 0; step < 25; step++) {
      t += 400;
      const pkts = generateV2SimPackets('cobblestone', step * 400, step + 1, 'mvp_front', eng.config);
      for (const p of pkts) eng.ingestPacket(p, t);
      eng.update(t);
    }
    assert.strictEqual(eng.indicator.roughRoadActive, true);
    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');
    assert.strictEqual(eng.burstEvents.length, 0);
  });

  await test('5. Single-wheel pothole clip triggers POTHOLE_GUARD without false alarm', () => {
    const eng = new TechBitV2Engine({ rigProfile: 'mvp_front', vehicleClass: 'crossover' });
    eng.ingestPacket(makeAxlePacket(1, { left: { rmsMmS: 0.48 }, right: { rmsMmS: 0.48 } }), 1000);
    eng.update(1100);
    eng.ingestPacket(
      makeAxlePacket(1, { left: { rmsMmS: 3.2, peakMmS: 19.0, crest: 6.2, kurtosis: 8.2, hfEnergy: 0.25, clip: true } }),
      1300
    );
    eng.update(1400);
    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');
    assert.ok(eng.indicator.potholeCount >= 1);
    assert.strictEqual(eng.axles[0].lastReason, 'POTHOLE_GUARD');
  });

  await test('6. Full 10-wheel truck profile: sustained ΔT > 18°C -> YELLOW after 60s, then RED + buzzer', () => {
    const eng = new TechBitV2Engine({ rigProfile: 'full_10', vehicleClass: 'truck', yellowConfirmSec: 60, redConfirmSec: 5 });
    let t = 1000;
    for (let s = 1; s <= 5; s++) eng.ingestPacket(makeAxlePacket(s), t);
    eng.update(t);

    for (let sec = 0; sec < 60; sec++) {
      t += 1000;
      for (let s = 1; s <= 5; s++) {
        eng.ingestPacket(
          s === 4 ? makeAxlePacket(4, { left: { tempC: 58.0 }, right: { tempC: 34.0 } }) : makeAxlePacket(s),
          t
        );
      }
      eng.update(t);
    }
    assert.strictEqual(eng.indicator.driverSeverity, 'YELLOW');
    assert.strictEqual(eng.indicator.wheelCode, 'P2-L');

    for (let sec = 0; sec < 6; sec++) {
      t += 1000;
      eng.ingestPacket(makeAxlePacket(4, { left: { tempC: 103.0 }, right: { tempC: 34.0 } }), t);
      eng.update(t);
    }
    assert.strictEqual(eng.indicator.driverSeverity, 'RED');
    assert.strictEqual(eng.indicator.buzzerOn, true);
  });

  await test('7. Shadow Mode records ANOMALY_BURST silently while keeping driver LED GREEN', () => {
    const eng = new TechBitV2Engine({ rigProfile: 'mvp_front', shadowModeEnabled: true });
    eng.ingestPacket(
      makeAxlePacket(1, { left: { tempC: 34.0, rmsMmS: 0.5 }, right: { tempC: 46.5, rmsMmS: 0.9 } }),
      2000
    );
    eng.update(2100);
    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');
    assert.strictEqual(eng.indicator.shadowCount, 1);
    assert.strictEqual(eng.burstEvents[0].severity, 'SHADOW');
  });

  await test('8. HTTP Server SPA routes (/, /blackbox, /dataset, /cli) + Dataset Recorder CSV/JSON export', async () => {
    const { server } = createServer({ disableTimers: true, persistDatasets: false });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
      for (const route of ['/', '/blackbox', '/dataset', '/cli']) {
        const res = await fetch(`${base}${route}`);
        assert.strictEqual(res.status, 200, `Expected 200 for SPA route ${route}`);
        const html = await res.text();
        assert.ok(html.includes('<div id="root"></div>'));
      }

      // Start STO / Santa Fe recording session
      let res = await fetch(`${base}/api/dataset/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_model: 'Hyundai Santa Fe',
          condition: 'BEFORE_REPAIR',
          fault_label: 'BEARING_WEAR_EARLY',
          fault_wheel: 'AXLE1_RIGHT',
        }),
      });
      const started = await res.json();
      assert.strictEqual(started.ok, true);
      const sessionId = started.passport.session_id;

      // Mark speed 60 km/h + send live telemetry + mark pothole + send another frame
      await fetch(`${base}/api/dataset/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speedKmh: 60 }),
      });
      await fetch(`${base}/api/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...makeAxlePacket(1, { right: { rmsMmS: 1.4, kurtosis: 6.8, hfEnergy: 0.65 } }), _source: 'serial' }),
      });
      await fetch(`${base}/api/dataset/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventTag: 'POTHOLE' }),
      });
      await fetch(`${base}/api/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...makeAxlePacket(1), _source: 'serial' }),
      });

      res = await fetch(`${base}/api/dataset/stop`, { method: 'POST' });
      const stopped = await res.json();
      assert.strictEqual(stopped.ok, true);
      assert.strictEqual(stopped.sampleCount, 2);

      const csv = await (await fetch(`${base}/api/dataset/export/${sessionId}?format=csv`)).text();
      assert.ok(csv.includes('kurtosis_L,kurtosis_R,hf_energy_L,hf_energy_R'));
      assert.ok(csv.includes('BEARING_WEAR_EARLY'));
      assert.ok(csv.includes('POTHOLE'));

      const jsonObj = await (await fetch(`${base}/api/dataset/export/${sessionId}?format=json`)).json();
      assert.strictEqual(jsonObj.passport.vehicle_model, 'Hyundai Santa Fe');
      assert.strictEqual(jsonObj.samples.length, 2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  console.log(`\nSummary: ${passed} passed, ${process.exitCode ? 'FAILURES PRESENT' : '0 failed'}\n`);
}

runAll();
