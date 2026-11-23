'use strict';

const assert = require('node:assert/strict');
const {
  CLASS_NORMAL,
  CLASS_BAD_ROAD,
  CLASS_POTHOLE_IMPACT,
  CLASS_ANOMALY_FAULT,
  ALERT_WARNING,
  ALERT_SERVICE_TO,
  runMlpInference,
  WheelClassifierEngine,
} = require('./classifier_engine');
const { createServer } = require('./server');

function makePkt(id, rms, peak, bL, bM, bH, fDom, fCent, ton, kurt, extra = {}) {
  return {
    type: 'techbit_node',
    mcu: 'ESP32-C3',
    wheelId: id,
    rmsMv: rms,
    peakMv: peak,
    dcOffsetMv: 1650,
    bandLowRatio: bL,
    bandMidRatio: bM,
    bandHighRatio: bH,
    dominantFreqHz: fDom,
    spectralCentroidHz: fCent,
    tonalityRatio: ton,
    kurtosis: kurt,
    sht40Ok: true,
    tempC: 34.0,
    humidityPct: 45.0,
    surgeClipping: false,
    ...extra,
  };
}

function testMlpAnd3sFaultHysteresis() {
  const clf = new WheelClassifierEngine();
  let t = 1000;

  // 1. Healthy baseline
  for (let s = 0; s < 10; s++) {
    t += 50;
    for (let w = 0; w < 4; w++) {
      clf.ingestNodePacket(makePkt(w, 28, 75, 0.55, 0.32, 0.13, 250, 760, 2.7, 3.0), t);
    }
    clf.update(t);
  }
  assert.equal(clf.summary.activeWheelCount, 4);
  assert.equal(clf.wheels[0].predictedClass, CLASS_NORMAL);
  assert.equal(clf.wheels[0].vrefStatus, 'OK');

  // 2. FR develops sticking brake pad chatter -> 2.0s => ALERT_WARNING, not confirmed
  for (let s = 0; s < 40; s++) {
    t += 50;
    clf.ingestNodePacket(makePkt(0, 29, 78, 0.55, 0.32, 0.13, 260, 780, 2.8, 3.0), t);
    clf.ingestNodePacket(makePkt(1, 150, 410, 0.10, 0.25, 0.65, 3400, 4100, 8.8, 3.2), t);
    clf.ingestNodePacket(makePkt(2, 27, 72, 0.56, 0.31, 0.13, 240, 740, 2.6, 2.9), t);
    clf.ingestNodePacket(makePkt(3, 28, 76, 0.55, 0.32, 0.13, 255, 760, 2.7, 3.0), t);
    clf.update(t);
  }
  assert.equal(clf.wheels[1].predictedClass, CLASS_ANOMALY_FAULT);
  assert.equal(clf.wheels[1].faultConfirmed, false);
  assert.equal(clf.summary.alertLevel, ALERT_WARNING);

  // 3. Another 1.5s => ALERT_SERVICE_TO confirmed
  for (let s = 0; s < 30; s++) {
    t += 50;
    clf.ingestNodePacket(makePkt(0, 29, 78, 0.55, 0.32, 0.13, 260, 780, 2.8, 3.0), t);
    clf.ingestNodePacket(makePkt(1, 150, 410, 0.10, 0.25, 0.65, 3400, 4100, 8.8, 3.2), t);
    clf.ingestNodePacket(makePkt(2, 27, 72, 0.56, 0.31, 0.13, 240, 740, 2.6, 2.9), t);
    clf.ingestNodePacket(makePkt(3, 28, 76, 0.55, 0.32, 0.13, 255, 760, 2.7, 3.0), t);
    clf.update(t);
  }
  assert.equal(clf.wheels[1].faultConfirmed, true);
  assert.equal(clf.summary.alertLevel, ALERT_SERVICE_TO);
  assert.equal(clf.summary.faultWheelMask, 1 << 1);
}

function testAxleTransitionAndPotholeSuppression() {
  const clf = new WheelClassifierEngine();
  let t = 2000;

  // Front axle hits cobblestone while rear is still smooth -> suppressed to BAD_ROAD
  for (let s = 0; s < 25; s++) {
    t += 50;
    clf.ingestNodePacket(makePkt(0, 175, 540, 0.62, 0.28, 0.10, 280, 780, 3.1, 3.6), t);
    clf.ingestNodePacket(makePkt(1, 184, 560, 0.60, 0.29, 0.11, 290, 810, 3.2, 3.5), t);
    clf.ingestNodePacket(makePkt(2, 27, 73, 0.56, 0.32, 0.12, 240, 730, 2.7, 3.0), t);
    clf.ingestNodePacket(makePkt(3, 26, 71, 0.56, 0.32, 0.12, 245, 720, 2.6, 3.0), t);
    clf.update(t);
    assert.equal(clf.wheels[0].anomalyAccumMs, 0);
    assert.equal(clf.wheels[1].anomalyAccumMs, 0);
  }
  assert.equal(clf.wheels[0].predictedClass, CLASS_BAD_ROAD);
  assert.equal(clf.summary.faultWheelMask, 0);

  // Pothole direct MLP check
  const potholeRes = runMlpInference([Math.log1p(6.5), 3.0, 3.0, 5.8, 9.5, 0.50, 0.35, 0.15, 0.24, 3.2]);
  assert.equal(potholeRes.predictedClass, CLASS_POTHOLE_IMPACT);
}

function testHardwareDiagnosticsAndTruthfulness() {
  const clf = new WheelClassifierEngine();
  let t = 5000;

  // Check Vref LOW_RAIL, HIGH_RAIL, disconnected SHT40 (sht40Ok: false must NOT trigger thermal overheat),
  // condensation risk, and dead piezo watchdog
  for (let s = 0; s < 110; s++) {
    t += 50;
    clf.ingestNodePacket(makePkt(0, 45, 120, 0.55, 0.32, 0.13, 260, 760, 2.7, 3.0, {
      dcOffsetMv: 740,
      sht40Ok: false,
      tempC: 99.0, // Stale/garbage value when sht40Ok is false -> MUST be ignored!
    }), t);
    clf.ingestNodePacket(makePkt(1, 46, 122, 0.55, 0.32, 0.13, 260, 760, 2.7, 3.0, {
      dcOffsetMv: 2150,
      humidityPct: 91.0,
    }), t);
    clf.ingestNodePacket(makePkt(2, 0.6, 1.5, 0.34, 0.33, 0.33, 0, 0, 1.0, 3.0), t);
    clf.ingestNodePacket(makePkt(3, 44, 118, 0.55, 0.32, 0.13, 260, 760, 2.7, 3.0), t);
    clf.update(t);
  }

  assert.equal(clf.wheels[0].vrefStatus, 'LOW_RAIL');
  assert.equal(clf.wheels[0].thermalOverheat, false, 'Disconnected SHT40 must never cause false overheat');
  assert.equal(clf.wheels[1].vrefStatus, 'HIGH_RAIL');
  assert.equal(clf.wheels[1].condensationRisk, true);
  assert.equal(clf.wheels[2].sensorDead, true);
  assert.equal(clf.summary.deadSensorMask, 1 << 2);
  assert.equal(clf.summary.vrefFaultMask, (1 << 0) | (1 << 1));
  assert.equal(clf.summary.sht40FaultMask, 1 << 0);

  // Timeout honesty: advancing time past nodeTimeoutMs (1500 ms) MUST clear live telemetry
  t += 2000;
  clf.update(t);
  const snap = clf.getSnapshot(t);
  assert.equal(snap.summary.activeWheelCount, 0);
  assert.equal(snap.wheels[0].online, false);
  assert.equal(snap.wheels[0].telemetry, null);
}

async function testHttpServerEndpoints() {
  const { server } = createServer({ disableTimers: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Starts truthfully in waiting mode with zero active wheels
    const r0 = await fetch(`${baseUrl}/api/state`);
    assert.equal(r0.status, 200);
    const s0 = await r0.json();
    assert.equal(s0.sourceMeta.mode, 'waiting');
    assert.equal(s0.summary.activeWheelCount, 0);

    // 2. Queue 'cal' command and verify ESP receives it on next POST /api/telemetry
    const rCmd = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cal' }),
    });
    assert.equal(rCmd.status, 200);

    const nodePkt = makePkt(0, 31.5, 84.0, 0.55, 0.31, 0.14, 245, 730, 2.75, 3.05, {
      spectrum: new Array(32).fill(1.2),
    });
    const rTel = await fetch(`${baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nodePkt),
    });
    assert.equal(rTel.status, 200);
    const telResp = await rTel.json();
    assert.equal(telResp.ok, true);
    assert.deepEqual(telResp.commands, ['cal']);

    const rState = await fetch(`${baseUrl}/api/state`);
    const s1 = await rState.json();
    assert.equal(s1.sourceMeta.mode, 'wifi');
    assert.equal(s1.summary.activeWheelCount, 1);
    assert.equal(s1.wheels[0].telemetry.rmsMv, 31.5);
    assert.equal(s1.wheels[0].telemetry.spectrum.length, 32);

    // 3. Config update
    const rCfg = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faultPeerRatioMin: 1.75, baselines: [33.0] }),
    });
    assert.equal(rCfg.status, 200);
    const cfgResp = await rCfg.json();
    assert.equal(cfgResp.config.faultPeerRatioMin, 1.75);

    // 4. Malformed JSON handled cleanly with 400
    const rBad = await fetch(`${baseUrl}/api/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json',
    });
    assert.equal(rBad.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function run() {
  testMlpAnd3sFaultHysteresis();
  testAxleTransitionAndPotholeSuppression();
  testHardwareDiagnosticsAndTruthfulness();
  await testHttpServerEndpoints();
  console.log('[PASS] All TechBIT truthfulness, TinyML parity, hardware fault & API tests passed.');
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
