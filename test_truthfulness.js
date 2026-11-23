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
  console.log('\nTechBIT v2.1 SPA Workbench — Truthfulness, Profiles & Rule Engine Test Suite\n');

  await test('1. Cold boot defaults to mvp_front (T1-L / T1-R + S3) strictly OFFLINE', () => {
    const eng = new TechBitV2Engine();
    eng.update(1000);
    const snap = eng.getSnapshot(1000);
    assert.strictEqual(snap.config.rigProfile, 'mvp_front');
    assert.strictEqual(snap.indicator.expectedWheels, 2);
    assert.strictEqual(snap.indicator.activeWheels, 0);
    assert.strictEqual(snap.indicator.driverSeverity, 'STANDBY');
    assert.strictEqual(snap.s3Master.online, false);
  });

  await test('2. Two separate boards mapped via T1-L and T1-R USB overrides merge cleanly', () => {
    const eng = new TechBitV2Engine({ rigProfile: 'mvp_front' });
    eng.ingestPacket(
      {
        type: 'techbit_c3_node',
        nodeId: 'BOARD_L',
        left: { rmsMmS: 1.2, tempC: 33.0, dcOffsetMv: 1650, shtOk: true, rh: 40 },
      },
      1000,
      'T1-L'
    );
    eng.ingestPacket(
      {
        type: 'techbit_c3_node',
        nodeId: 'BOARD_R',
        left: { rmsMmS: 1.3, tempC: 34.0, dcOffsetMv: 1655, shtOk: true, rh: 42 },
      },
      1050,
      'T1-R'
    );
    eng.update(1100);
    assert.strictEqual(eng.indicator.activeWheels, 2);
    assert.strictEqual(eng.axles[0].left.tempC, 33.0);
    assert.strictEqual(eng.axles[0].right.tempC, 34.0);
    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');
  });

  await test('3. MVP 2-wheel cobblestone stays GREEN with roughRoadActive=true', () => {
    const eng = new TechBitV2Engine({ rigProfile: 'mvp_front', yellowConfirmSec: 5 });
    let t = 1000;
    for (let step = 0; step < 25; step++) {
      t += 400;
      const pkts = generateV2SimPackets('cobblestone', step * 400, step + 1, 'mvp_front');
      for (const p of pkts) eng.ingestPacket(p, t);
      eng.update(t);
    }
    assert.strictEqual(eng.indicator.activeWheels, 2);
    assert.strictEqual(eng.indicator.roughRoadActive, true);
    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');
    assert.strictEqual(eng.burstEvents.length, 0);
  });

  await test('4. Sensor type config adapts Vref & SHT40 validation cleanly', () => {
    const eng = new TechBitV2Engine({ rigProfile: 'mvp_front' });
    eng.ingestPacket(
      makeAxlePacket(1, { left: { dcOffsetMv: 780, rh: 92.0, shtOk: true } }),
      1000
    );
    eng.update(1100);
    assert.strictEqual(eng.axles[0].left.vrefStatus, 'FAULT');
    assert.strictEqual(eng.axles[0].left.humidityWarn, true);

    // Switch to direct piezo + NTC -> no false Vref fault or SHT40 condensation warning
    eng.updateConfig({ vibSensorType: 'piezo_direct', tempSensorType: 'ntc' });
    assert.strictEqual(eng.axles[0].left.vrefStatus, 'NA');
    assert.strictEqual(eng.axles[0].left.humidityWarn, false);
  });

  await test('5. Full 10-wheel profile: sustained ΔT > 18°C latches YELLOW after 60s, then RED + buzzer', () => {
    const eng = new TechBitV2Engine({ rigProfile: 'full_10', yellowConfirmSec: 60, redConfirmSec: 5 });
    let t = 1000;
    for (let s = 1; s <= 5; s++) eng.ingestPacket(makeAxlePacket(s), t);
    eng.update(t);

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

    for (let sec = 0; sec < 6; sec++) {
      t += 1000;
      eng.ingestPacket(makeAxlePacket(4, { left: { tempC: 103.0 }, right: { tempC: 34.0 } }), t);
      eng.update(t);
    }
    assert.strictEqual(eng.indicator.driverSeverity, 'RED');
    assert.strictEqual(eng.indicator.buzzerOn, true);
    eng.toggleMute();
    eng.update(t + 100);
    assert.strictEqual(eng.indicator.buzzerOn, false);
  });

  await test('6. Single-wheel pothole clip triggers POTHOLE_GUARD without false alarm', () => {
    const eng = new TechBitV2Engine({ rigProfile: 'mvp_front' });
    eng.ingestPacket(makeAxlePacket(1), 1000);
    eng.update(1100);
    eng.ingestPacket(
      makeAxlePacket(1, { left: { rmsMmS: 6.1, peakMmS: 26.0, crest: 6.3, clip: true } }),
      1300
    );
    eng.update(1400);
    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');
    assert.ok(eng.indicator.potholeCount >= 1);
    assert.strictEqual(eng.axles[0].lastReason, 'POTHOLE_GUARD');
  });

  await test('7. Shadow Mode records ANOMALY_BURST silently while keeping driver LED GREEN', () => {
    const eng = new TechBitV2Engine({ rigProfile: 'mvp_front', shadowModeEnabled: true });
    eng.ingestPacket(
      makeAxlePacket(1, { left: { tempC: 34.0, rmsMmS: 1.15 }, right: { tempC: 47.0, rmsMmS: 2.3 } }),
      2000
    );
    eng.update(2100);
    assert.strictEqual(eng.indicator.driverSeverity, 'GREEN');
    assert.strictEqual(eng.indicator.shadowCount, 1);
    assert.strictEqual(eng.burstEvents[0].severity, 'SHADOW');
    assert.strictEqual(eng.burstEvents[0].wheel_code, 'T1-R');
  });

  await test('8. HTTP Server routes, live profile switching, simulator override, and CSV export', async () => {
    const { server } = createServer({ disableTimers: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
      for (const p of ['/', '/styles.css', '/app.js']) {
        const res = await fetch(`${base}${p}`);
        assert.strictEqual(res.status, 200);
      }

      // Switch profile via API
      let res = await fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'config',
          config: { rigProfile: 'tractor_4', vibSensorType: 'mems_imu', tempSensorType: 'dual', redConfirmSec: 0 },
        }),
      });
      let data = await res.json();
      assert.strictEqual(data.state.config.rigProfile, 'tractor_4');
      assert.strictEqual(data.state.indicator.expectedWheels, 4);
      assert.strictEqual(data.state.config.vibSensorType, 'mems_imu');

      // Start simulator then verify live packet overrides it
      await fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'simulator', enabled: true, scenario: 'smooth' }),
      });

      await fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raw', cmd: 'slot 1' }),
      });

      res = await fetch(`${base}/api/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...makeAxlePacket(1, { right: { tempC: 104.0 } }), _source: 'serial' }),
      });
      const ack = await res.json();
      assert.strictEqual(ack.ok, true);
      assert.deepStrictEqual(ack.commands, ['slot 1']);

      const st = await (await fetch(`${base}/api/state`)).json();
      assert.strictEqual(st.source.mode, 'serial');
      assert.ok(st.incidents.length >= 1);

      const ticketId = st.incidents[0].ticket_id;
      await fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve_ticket', ticketId, resolutionCode: 'BRAKE_STUCK' }),
      });

      const csv = await (await fetch(`${base}/api/export.csv`)).text();
      assert.ok(csv.includes('BRAKE_STUCK'));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  console.log(`\nSummary: ${passed} passed, ${process.exitCode ? 'FAILURES PRESENT' : '0 failed'}\n`);
}

runAll();
