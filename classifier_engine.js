'use strict';

// Exact JavaScript port of esp-code/lib/TechBitML/WheelClassifier.cpp + ml_model_weights.h
// Guarantees parity between on-device TinyML inference and web workbench diagnostics.

const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'];
const WHEEL_COUNT = 4;

const CLASS_NORMAL = 0;
const CLASS_BAD_ROAD = 1;
const CLASS_POTHOLE_IMPACT = 2;
const CLASS_ANOMALY_FAULT = 3;

const CLASS_NAMES = ['NORMAL', 'BAD_ROAD', 'POTHOLE', 'ANOMALY'];

const ALERT_OK = 0;
const ALERT_BAD_ROAD = 1;
const ALERT_WARNING = 2;
const ALERT_SERVICE_TO = 3;

const ROAD_STATES = {
  STANDSTILL: 'STANDSTILL',
  SMOOTH: 'SMOOTH',
  COBBLESTONE: 'COBBLESTONE',
  WARNING: 'WARNING',
  SERVICE_TO: 'SERVICE_TO',
};

// Exact weights exported by esp-code/ml_trainer/train_classifier.py (Validation Accuracy: 99.92%)
const kScalerMean = [
  1.496651, 2.391914, 2.222784, 3.855008, 5.088963,
  0.466377, 0.328030, 0.205594, 0.345223, 4.822359,
];

const kScalerStd = [
  0.541998, 1.559134, 1.555914, 1.893410, 3.299825,
  0.187342, 0.111015, 0.158478, 0.240640, 2.904548,
];

const kW1 = [
  [0.229383, -0.276368, 0.599241, 0.0, 0.857684, 0.162736, -0.0, 1.163867, 0.324921, -1.144045, 0.461529, -2.131433, 1.963473, -0.047516, 1.442037, 0.001604],
  [0.542498, -0.142019, 0.221478, 0.0, -1.254229, 0.524444, 0.0, 0.611978, 1.445329, -0.255198, 0.516824, -0.266720, 0.364213, 0.387536, -0.192745, 0.001171],
  [0.600436, -0.959933, -0.854011, 0.0, 1.171326, 0.612134, -0.0, 0.224278, 0.697455, -0.258768, 0.683584, -0.191906, -1.256421, -0.361421, 0.173801, 0.001074],
  [-0.289470, -0.414016, 0.046740, -0.0, 0.628192, -0.335389, -0.0, -0.271424, 1.337384, -0.553944, 1.461066, -0.387363, -0.821566, -0.182152, 0.434454, -0.001362],
  [-0.104730, -0.208311, 0.237020, -0.0, 0.571493, -0.192421, -0.0, -0.300348, -0.158505, 0.074511, 2.228733, -0.387371, 0.587751, -0.386403, 0.508622, -0.000145],
  [-0.621863, 0.345512, 0.245587, -0.0, -0.302797, -0.663961, 0.0, -0.255035, 0.679492, -0.015367, -0.367716, 0.185110, 0.222714, -1.162704, 0.278081, -0.000698],
  [0.515176, -0.365377, 0.088905, -0.0, 0.070152, 0.602054, -0.0, -0.270963, -0.441854, -0.005928, -0.088005, 0.300385, -0.006825, 0.252205, 0.316436, 0.001476],
  [0.289134, -0.443126, 0.020177, 0.0, 0.005544, 0.291185, 0.0, 0.367494, -0.616247, 0.013271, 0.551535, 0.132919, -0.017936, 1.171545, 0.279865, -0.0],
  [0.389465, -0.655724, -0.067611, 0.0, -0.135674, 0.420819, -0.0, -0.196115, 0.156502, 0.281777, 0.541048, 0.064848, -0.583744, 0.623531, -0.072679, 0.000473],
  [0.332666, -0.338403, 1.493398, -0.0, 0.100920, 0.320223, 0.0, -0.985190, -0.287148, 0.036797, 0.401430, -0.110878, 0.612326, 0.435601, -0.189957, 0.000735],
];

const kB1 = [
  0.389257, -0.717904, 0.305240, -0.021845, 1.372427, 0.457975, -0.089422, 1.076558,
  1.072692, -1.195338, 1.307112, -1.260295, 0.823570, 0.559666, 1.848719, -0.034658,
];

const kW2 = [
  [-0.435122, 0.0, 0.0, -0.142525, 0.838976, -0.298865, -0.080705, -0.018487, -0.467092, -0.422900, 0.317653, 0.0],
  [0.816323, -0.0, 0.0, 0.704630, -0.516235, 0.244517, 0.024891, -0.030054, 0.385311, -0.257790, -0.261182, -0.0],
  [-0.170195, -0.0, 0.0, -0.750133, 0.067875, -0.069554, -0.375534, -0.118050, 0.171923, 0.241344, -0.030077, 0.0],
  [0.0, 0.0, 0.0, -0.0, 0.0, 0.0, 0.0, -0.0, -0.0, -0.0, -0.0, -0.0],
  [-0.086905, 0.0, -0.0, -0.889728, 0.172185, 0.003091, -0.956045, -0.108138, -0.298488, 0.392793, 0.153749, -0.0],
  [-0.447083, -0.0, 0.0, -0.131621, 0.905368, -0.313183, -0.061298, -0.019884, -0.481978, -0.480057, 0.343989, 0.0],
  [-0.0, -0.0, -0.0, -0.0, -0.0, -0.0, -0.0, -0.0, 0.0, 0.0, 0.0, -0.0],
  [0.183987, -0.0, -0.0, -0.891581, 0.041547, 0.097644, -0.214990, -0.106344, 0.409093, 0.225518, 0.137021, -0.0],
  [-0.258149, 0.0, -0.0, -1.211554, -0.019369, -0.119678, -0.678450, -0.147776, 0.124358, 0.966900, -0.296729, -0.0],
  [-0.003634, 0.0, 0.0, 0.315136, 0.003432, -0.061157, 0.472298, 0.007562, -0.061133, -0.165655, 0.049323, 0.0],
  [-1.332925, -0.0, -0.0, -0.133893, 0.347276, -0.908699, -0.061223, -0.280367, -1.700380, 1.123091, -0.257261, -0.0],
  [0.169590, -0.0, -0.0, 1.063037, -0.001914, -0.290134, 1.055628, -0.000885, -0.840103, -0.418873, -0.187121, -0.0],
  [0.292519, 0.0, 0.0, -1.566022, -0.029545, 0.298087, -0.765553, -0.082622, 1.084222, 0.558877, 0.052730, -0.0],
  [-0.486531, 0.0, 0.0, 0.676910, 1.024671, -0.400136, 0.509941, -0.008714, -0.679442, -0.700342, 0.224552, 0.0],
  [-0.077914, -0.0, 0.0, -1.053136, 0.051721, -0.074134, -0.598912, -0.125942, -0.307857, 0.611418, -0.040680, 0.0],
  [-0.0, 0.0, 0.0, -0.000641, 0.000120, -0.000003, -0.000104, -0.0, -0.001759, -0.005351, 0.000593, 0.0],
];

const kB2 = [
  1.909230, -0.081912, -0.039586, -0.699798, -0.045178, 0.651179,
  -0.609818, 0.279771, 0.740475, 0.982041, 0.565220, -0.100053,
];

const kW3 = [
  [0.644483, 0.857181, -1.124701, -0.322269],
  [-0.0, 0.0, 0.0, -0.0],
  [0.0, 0.0, -0.0, 0.0],
  [1.986418, -1.666943, -0.039299, -0.017940],
  [-0.133773, -0.713325, -0.357323, 1.230680],
  [0.017936, 0.455123, -0.273480, -0.031541],
  [1.195591, -1.224443, -0.018036, 0.047475],
  [0.264118, 0.246550, 0.132845, -0.006921],
  [-0.732592, 1.505716, -0.853023, 0.005336],
  [-1.180012, 0.278447, 1.349102, -0.374210],
  [-0.320437, 0.050517, -0.008623, 0.609735],
  [-0.0, -0.0, 0.0, 0.0],
];

const kB3 = [-0.516701, 0.692285, -1.040945, -2.858974];

const DEFAULT_CONFIG = {
  defaultBaselineRmsMv: 28.0,
  minPeerMedianMv: 6.0,
  faultProbThreshold: 0.65,
  faultPeerRatioMin: 1.50,
  faultOnBadRoadPeerRatioMin: 1.90,
  badRoadFloorRatio: 1.85,
  axleSymmetryMin: 0.60,
  axleSymmetryMax: 1.65,
  standstillRmsMv: 7.0,
  warningDelayMs: 1800,
  faultConfirmDurationMs: 3000,
  potholeCooldownMs: 900,
  sideCascadeGuardMs: 750,
  deadSensorTimeoutMs: 5000,
  deadSensorRmsMv: 1.8,
  deadSensorPeerMinMv: 20.0,
  calibrationDurationMs: 5000,
  tempOverheatAbsC: 75.0,
  tempDeltaOverPeerC: 18.0,
  humidityWarnPct: 85.0,
  vrefMinMv: 1480.0,
  vrefMaxMv: 1820.0,
  nodeTimeoutMs: 1500,
};

function runMlpInference(rawFeatures) {
  const x = new Array(10);
  for (let i = 0; i < 10; i++) {
    x[i] = (rawFeatures[i] - kScalerMean[i]) / kScalerStd[i];
  }

  const h1 = new Array(16);
  for (let j = 0; j < 16; j++) {
    let acc = kB1[j];
    for (let i = 0; i < 10; i++) {
      acc += x[i] * kW1[i][j];
    }
    h1[j] = acc > 0 ? acc : 0;
  }

  const h2 = new Array(12);
  for (let j = 0; j < 12; j++) {
    let acc = kB2[j];
    for (let i = 0; i < 16; i++) {
      acc += h1[i] * kW2[i][j];
    }
    h2[j] = acc > 0 ? acc : 0;
  }

  const logits = new Array(4);
  let maxLogit = -1e30;
  for (let j = 0; j < 4; j++) {
    let acc = kB3[j];
    for (let i = 0; i < 12; i++) {
      acc += h2[i] * kW3[i][j];
    }
    logits[j] = acc;
    if (acc > maxLogit) maxLogit = acc;
  }

  const probs = new Array(4);
  let sumExp = 0;
  for (let j = 0; j < 4; j++) {
    const e = Math.exp(logits[j] - maxLogit);
    probs[j] = e;
    sumExp += e;
  }

  const invSum = sumExp > 1e-9 ? 1.0 / sumExp : 0.25;
  let bestClass = 0;
  let bestProb = -1;
  for (let j = 0; j < 4; j++) {
    probs[j] *= invSum;
    if (probs[j] > bestProb) {
      bestProb = probs[j];
      bestClass = j;
    }
  }

  return {
    predictedClass: bestClass,
    className: CLASS_NAMES[bestClass],
    probs,
  };
}

function computeMedian(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : 0.5 * (sorted[mid - 1] + sorted[mid]);
}

function createEmptyWheel(id, defaultBaseline) {
  return {
    wheelId: id,
    name: WHEEL_NAMES[id],
    seenEver: false,
    online: false,
    lastRxMs: 0,
    rxPacketCount: 0,
    mcu: null,
    telemetry: null,
    baselineRmsMv: defaultBaseline,
    calMean: 0,
    calM2: 0,
    calCount: 0,
    features: new Array(10).fill(0),
    probs: [1, 0, 0, 0],
    predictedClass: CLASS_NORMAL,
    predictedClassName: 'NORMAL',
    peerRatio: 1.0,
    axleRatio: 1.0,
    tempDeltaC: 0.0,
    anomalyAccumMs: 0,
    faultConfirmed: false,
    thermalOverheat: false,
    condensationRisk: false,
    vrefStatus: 'UNKNOWN', // 'OK' | 'LOW_RAIL' | 'HIGH_RAIL' | 'UNKNOWN'
    roadSuppressed: false,
    guardReasons: [],
    sensorDead: false,
    potholeCount: 0,
    lastPotholeMs: 0,
    potholeCooldownUntilMs: 0,
    lowSignalMs: 0,
    hubVerdict: null,
  };
}

class WheelClassifierEngine {
  constructor(initialConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...initialConfig };
    this.resetAll();
  }

  resetAll() {
    this.wheels = Array.from({ length: WHEEL_COUNT }, (_, i) =>
      createEmptyWheel(i, this.config.defaultBaselineRmsMv)
    );
    this.lastUpdateMs = 0;
    this.startupBlankingUntilMs = 0;
    this.calibrating = false;
    this.calStartMs = 0;
    this.calDurationMs = this.config.calibrationDurationMs;
    this.buzzerMuted = false;
    this.prevFaultMask = 0;
    this.summary = {
      activeWheelCount: 0,
      offlineWheelMask: 0,
      deadSensorMask: 0,
      vrefFaultMask: 0,
      sht40FaultMask: 0,
      alertLevel: ALERT_OK,
      roadState: ROAD_STATES.STANDSTILL,
      calibrating: false,
      calProgressPct: 100,
      faultWheelMask: 0,
      badRoadActive: false,
      standstill: true,
      buzzerMuted: false,
    };
  }

  updateConfig(patch) {
    const numericKeys = Object.keys(DEFAULT_CONFIG);
    for (const key of numericKeys) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        const val = Number(patch[key]);
        if (Number.isFinite(val) && val >= 0) {
          this.config[key] = val;
        }
      }
    }
    if (Array.isArray(patch.baselines)) {
      for (let i = 0; i < Math.min(4, patch.baselines.length); i++) {
        this.setWheelBaseline(i, patch.baselines[i]);
      }
    }
  }

  setWheelBaseline(wheelId, baselineRmsMv) {
    if (wheelId < 0 || wheelId >= WHEEL_COUNT) return;
    const v = Number(baselineRmsMv);
    if (Number.isFinite(v) && v >= 5.0 && v <= 500.0) {
      this.wheels[wheelId].baselineRmsMv = v;
    }
  }

  startCalibration(nowMs, durationMs = this.config.calibrationDurationMs) {
    this.calibrating = true;
    this.calStartMs = nowMs;
    this.calDurationMs = Math.max(500, durationMs);
    for (const w of this.wheels) {
      w.calMean = 0;
      w.calM2 = 0;
      w.calCount = 0;
    }
  }

  resetFaultLatches() {
    for (const w of this.wheels) {
      w.anomalyAccumMs = 0;
      w.faultConfirmed = false;
      w.thermalOverheat = false;
      w.roadSuppressed = false;
      w.guardReasons = [];
      w.sensorDead = false;
      w.lowSignalMs = 0;
      w.potholeCooldownUntilMs = 0;
      w.potholeCount = 0;
    }
    this.buzzerMuted = false;
    this.prevFaultMask = 0;
  }

  setBuzzerMuted(muted) {
    this.buzzerMuted = Boolean(muted);
    this.summary.buzzerMuted = this.buzzerMuted;
  }

  toggleBuzzerMute() {
    this.setBuzzerMuted(!this.buzzerMuted);
  }

  ingestNodePacket(pkt, nowMs) {
    const id = Number(pkt.wheelId);
    if (!Number.isInteger(id) || id < 0 || id >= WHEEL_COUNT) return false;
    const w = this.wheels[id];

    const rmsMv = Number(pkt.rmsMv);
    if (!Number.isFinite(rmsMv)) return false;

    const peakMv = Number.isFinite(Number(pkt.peakMv)) ? Number(pkt.peakMv) : rmsMv * 2.5;
    const bandLow = Number.isFinite(Number(pkt.bandLowRatio)) ? Number(pkt.bandLowRatio) : 0.34;
    const bandMid = Number.isFinite(Number(pkt.bandMidRatio)) ? Number(pkt.bandMidRatio) : 0.33;
    const bandHigh = Number.isFinite(Number(pkt.bandHighRatio)) ? Number(pkt.bandHighRatio) : 0.33;

    w.telemetry = {
      wheelId: id,
      rmsMv,
      peakMv,
      dcOffsetMv: Number.isFinite(Number(pkt.dcOffsetMv)) ? Number(pkt.dcOffsetMv) : null,
      crestFactor: Number.isFinite(Number(pkt.crestFactor))
        ? Number(pkt.crestFactor)
        : (rmsMv > 0.5 ? peakMv / rmsMv : 1.0),
      kurtosis: Number.isFinite(Number(pkt.kurtosis)) ? Number(pkt.kurtosis) : 3.0,
      bandLowRatio: bandLow,
      bandMidRatio: bandMid,
      bandHighRatio: bandHigh,
      dominantFreqHz: Number.isFinite(Number(pkt.dominantFreqHz)) ? Number(pkt.dominantFreqHz) : 0,
      spectralCentroidHz: Number.isFinite(Number(pkt.spectralCentroidHz)) ? Number(pkt.spectralCentroidHz) : 0,
      tonalityRatio: Number.isFinite(Number(pkt.tonalityRatio)) ? Number(pkt.tonalityRatio) : 1.0,
      zeroCrossingsHz: Number.isFinite(Number(pkt.zeroCrossingsHz)) ? Number(pkt.zeroCrossingsHz) : null,
      surgeClipping: Boolean(pkt.surgeClipping),
      sht40Ok: typeof pkt.sht40Ok === 'boolean' ? pkt.sht40Ok : Boolean(pkt.tempValid),
      tempC: Number.isFinite(Number(pkt.tempC)) ? Number(pkt.tempC) : null,
      humidityPct: Number.isFinite(Number(pkt.humidityPct)) ? Number(pkt.humidityPct) : null,
      canReady: typeof pkt.canReady === 'boolean' ? pkt.canReady : null,
      canTx: Number.isFinite(Number(pkt.canTx)) ? Number(pkt.canTx) : null,
      canRx: Number.isFinite(Number(pkt.canRx)) ? Number(pkt.canRx) : null,
      canErr: Number.isFinite(Number(pkt.canErr)) ? Number(pkt.canErr) : null,
      canBusOff: Number.isFinite(Number(pkt.canBusOff)) ? Number(pkt.canBusOff) : null,
      adcDropped: Number.isFinite(Number(pkt.adcDropped)) ? Number(pkt.adcDropped) : null,
      spectrum: Array.isArray(pkt.spectrum) ? pkt.spectrum.slice(0, 32).map(Number) : null,
      deviceTsMs: Number.isFinite(Number(pkt.tsMs)) ? Number(pkt.tsMs) : null,
    };

    if (pkt.mcu) w.mcu = String(pkt.mcu);
    w.seenEver = true;
    w.online = true;
    w.lastRxMs = nowMs;
    w.rxPacketCount += 1;
    w.hubVerdict = null;
    return true;
  }

  ingestHubPacket(hubPkt, nowMs) {
    if (!hubPkt || !Array.isArray(hubPkt.wheels)) return false;
    let ingestedAny = false;
    for (const hw of hubPkt.wheels) {
      const id = Number(hw.wheelId);
      if (!Number.isInteger(id) || id < 0 || id >= WHEEL_COUNT) continue;
      if (this.ingestNodePacket(hw, nowMs)) {
        const w = this.wheels[id];
        if (Number.isFinite(Number(hw.baselineRmsMv))) {
          this.setWheelBaseline(id, Number(hw.baselineRmsMv));
        }
        w.hubVerdict = {
          cls: hw.cls || null,
          prob: Number.isFinite(Number(hw.prob)) ? Number(hw.prob) : null,
          accMs: Number.isFinite(Number(hw.accMs)) ? Number(hw.accMs) : null,
          fault: Boolean(hw.fault),
          guarded: Boolean(hw.guarded),
          sensorDead: Boolean(hw.sensorDead),
          roadState: hubPkt.road || null,
          alertLevel: Number.isFinite(Number(hubPkt.alert)) ? Number(hubPkt.alert) : null,
        };
        ingestedAny = true;
      }
    }
    return ingestedAny;
  }

  evaluateWheel(id, nowMs, dtMs, peerMedianRms, peerMedianTemp, hasPeerTemp, activeCount, otherRoughCount, allStandstill, maxPeerRms) {
    const cfg = this.config;
    const w = this.wheels[id];
    const p = w.telemetry;
    w.roadSuppressed = false;
    w.guardReasons = [];

    // Hardware Vref health check (MCP6002 middle-point nominal 1650 mV)
    if (p.dcOffsetMv === null) {
      w.vrefStatus = 'UNKNOWN';
    } else if (p.dcOffsetMv < cfg.vrefMinMv) {
      w.vrefStatus = 'LOW_RAIL';
    } else if (p.dcOffsetMv > cfg.vrefMaxMv) {
      w.vrefStatus = 'HIGH_RAIL';
    } else {
      w.vrefStatus = 'OK';
    }

    // Dead / disconnected piezo watchdog
    if (activeCount >= 2 && maxPeerRms >= cfg.deadSensorPeerMinMv && p.rmsMv <= cfg.deadSensorRmsMv) {
      w.lowSignalMs = Math.min(w.lowSignalMs + dtMs, cfg.deadSensorTimeoutMs + 2000);
      if (w.lowSignalMs >= cfg.deadSensorTimeoutMs) {
        w.sensorDead = true;
      }
    } else {
      const dec = dtMs * 2;
      w.lowSignalMs = w.lowSignalMs > dec ? w.lowSignalMs - dec : 0;
      if (w.lowSignalMs === 0) {
        w.sensorDead = false;
      }
    }

    const safePeer = Math.max(peerMedianRms, cfg.minPeerMedianMv);
    w.peerRatio = p.rmsMv / safePeer;

    const oppId = id ^ 0x01;
    const oppOnline = this.wheels[oppId].online && this.wheels[oppId].telemetry !== null;
    if (oppOnline) {
      const safeOpp = Math.max(this.wheels[oppId].telemetry.rmsMv, cfg.minPeerMedianMv);
      w.axleRatio = p.rmsMv / safeOpp;
    } else {
      w.axleRatio = w.peerRatio;
    }

    const sideId = id ^ 0x02;
    const sideOnline = this.wheels[sideId].online && this.wheels[sideId].telemetry !== null;
    let sideRatio = w.peerRatio;
    if (sideOnline) {
      const safeSide = Math.max(this.wheels[sideId].telemetry.rmsMv, cfg.minPeerMedianMv);
      sideRatio = p.rmsMv / safeSide;
    }

    const safeBase = Math.max(w.baselineRmsMv, cfg.minPeerMedianMv);
    const normRms = p.rmsMv / safeBase;
    const crest = p.rmsMv > 0.5 ? p.peakMv / p.rmsMv : 1.0;

    w.features = [
      Math.log1p(Math.max(0, normRms)),
      Math.min(w.peerRatio, 10.0),
      Math.min(w.axleRatio, 10.0),
      Math.min(Math.max(crest, 1.0), 12.0),
      Math.min(Math.max(p.kurtosis, 1.0), 16.0),
      p.bandLowRatio,
      p.bandMidRatio,
      p.bandHighRatio,
      p.spectralCentroidHz / 5000.0,
      Math.min(Math.max(p.tonalityRatio, 1.0), 16.0),
    ];

    // Thermal & enclosure humidity check (GY-SHT40 0x44)
    w.thermalOverheat = false;
    w.condensationRisk = false;
    w.tempDeltaC = 0.0;
    if (p.sht40Ok && p.tempC !== null) {
      if (hasPeerTemp) {
        w.tempDeltaC = p.tempC - peerMedianTemp;
      }
      if (
        p.tempC >= cfg.tempOverheatAbsC ||
        (hasPeerTemp && w.tempDeltaC >= cfg.tempDeltaOverPeerC && p.tempC >= 55.0)
      ) {
        w.thermalOverheat = true;
      }
      if (p.humidityPct !== null && p.humidityPct >= cfg.humidityWarnPct) {
        w.condensationRisk = true;
      }
    }

    if (allStandstill) {
      w.predictedClass = CLASS_NORMAL;
      w.predictedClassName = CLASS_NAMES[CLASS_NORMAL];
      w.probs = [1, 0, 0, 0];

      if (!w.thermalOverheat && !w.faultConfirmed) {
        const slowDecay = Math.floor(dtMs / 4);
        w.anomalyAccumMs = w.anomalyAccumMs > slowDecay ? w.anomalyAccumMs - slowDecay : 0;
      } else if (w.thermalOverheat) {
        w.anomalyAccumMs = Math.min(w.anomalyAccumMs + dtMs * 2, cfg.faultConfirmDurationMs + 2000);
        if (w.anomalyAccumMs >= cfg.faultConfirmDurationMs) {
          w.faultConfirmed = true;
        }
      }
      return;
    }

    const res = runMlpInference(w.features);
    w.predictedClass = res.predictedClass;
    w.predictedClassName = res.className;
    w.probs = res.probs;

    const extremeBrakeSqueal = p.bandHighRatio > 0.65 && p.tonalityRatio > 7.0;
    if (
      p.surgeClipping &&
      !extremeBrakeSqueal &&
      (crest >= 3.3 || p.kurtosis >= 4.0 || p.bandLowRatio >= 0.30)
    ) {
      w.predictedClass = CLASS_POTHOLE_IMPACT;
      w.predictedClassName = CLASS_NAMES[CLASS_POTHOLE_IMPACT];
      w.guardReasons.push('BAT54S_CLIP_SHOCK');
    }

    if (w.predictedClass === CLASS_POTHOLE_IMPACT) {
      w.potholeCooldownUntilMs = Math.max(w.potholeCooldownUntilMs, nowMs + cfg.potholeCooldownMs);
      if (id === 0 || id === 1) {
        const rearId = id | 0x02;
        this.wheels[rearId].potholeCooldownUntilMs = Math.max(
          this.wheels[rearId].potholeCooldownUntilMs,
          nowMs + cfg.sideCascadeGuardMs
        );
      }
    }

    let axleRoadSymmetry = false;
    if (oppOnline && !w.thermalOverheat) {
      const oppBase = Math.max(this.wheels[oppId].baselineRmsMv, cfg.minPeerMedianMv);
      const bothElevated = normRms >= 1.55 && this.wheels[oppId].telemetry.rmsMv / oppBase >= 1.55;
      const symOnAxle = w.axleRatio >= cfg.axleSymmetryMin && w.axleRatio <= cfg.axleSymmetryMax;
      const roadSpectrum = p.bandLowRatio >= 0.35 && p.bandHighRatio < 0.45;
      if (bothElevated && symOnAxle && roadSpectrum) {
        axleRoadSymmetry = true;
        w.predictedClass = CLASS_BAD_ROAD;
        w.predictedClassName = CLASS_NAMES[CLASS_BAD_ROAD];
        w.roadSuppressed = true;
        w.guardReasons.push('AXLE_SYMMETRY');
      }
    }

    let sideTrackRoad = false;
    if (!axleRoadSymmetry && activeCount >= 3 && sideOnline && !w.thermalOverheat) {
      const sideBase = Math.max(this.wheels[sideId].baselineRmsMv, cfg.minPeerMedianMv);
      const bothSideUp = normRms >= 1.55 && this.wheels[sideId].telemetry.rmsMv / sideBase >= 1.55;
      const symOnSide = sideRatio >= cfg.axleSymmetryMin && sideRatio <= cfg.axleSymmetryMax;
      const lowBandRumble = p.bandLowRatio >= 0.40 && p.bandHighRatio < 0.35 && p.tonalityRatio < 5.2;
      if (bothSideUp && symOnSide && lowBandRumble) {
        sideTrackRoad = true;
        w.predictedClass = CLASS_BAD_ROAD;
        w.predictedClassName = CLASS_NAMES[CLASS_BAD_ROAD];
        w.roadSuppressed = true;
        w.guardReasons.push('SIDE_RUMBLE_STRIP');
      }
    }

    const inCobblestoneCtx =
      otherRoughCount >= 2 ||
      (activeCount === 2 &&
        otherRoughCount >= 1 &&
        peerMedianRms >= cfg.defaultBaselineRmsMv * cfg.badRoadFloorRatio);

    let cobblestoneUnevenSuppressed = false;
    if (
      inCobblestoneCtx &&
      !w.thermalOverheat &&
      p.bandLowRatio >= 0.45 &&
      p.bandHighRatio < 0.25 &&
      p.tonalityRatio < 4.5 &&
      w.peerRatio < 2.30
    ) {
      cobblestoneUnevenSuppressed = true;
      w.predictedClass = CLASS_BAD_ROAD;
      w.predictedClassName = CLASS_NAMES[CLASS_BAD_ROAD];
      w.roadSuppressed = true;
      w.guardReasons.push('COBBLESTONE_CTX');
    }

    const inPotholeCooldown =
      w.potholeCooldownUntilMs > nowMs && !w.thermalOverheat && !extremeBrakeSqueal;
    if (inPotholeCooldown && w.predictedClass !== CLASS_POTHOLE_IMPACT) {
      w.roadSuppressed = true;
      w.guardReasons.push('POTHOLE_COOLDOWN');
    }

    const reqPeerRatio = inCobblestoneCtx ? cfg.faultOnBadRoadPeerRatioMin : cfg.faultPeerRatioMin;
    const mlFault =
      !axleRoadSymmetry &&
      !sideTrackRoad &&
      !cobblestoneUnevenSuppressed &&
      !inPotholeCooldown &&
      w.predictedClass === CLASS_ANOMALY_FAULT &&
      w.probs[CLASS_ANOMALY_FAULT] >= cfg.faultProbThreshold &&
      w.peerRatio >= reqPeerRatio;

    if (mlFault || w.thermalOverheat) {
      const step = w.thermalOverheat ? dtMs * 2 : dtMs;
      w.anomalyAccumMs = Math.min(w.anomalyAccumMs + step, cfg.faultConfirmDurationMs + 2000);
    } else if (w.predictedClass === CLASS_POTHOLE_IMPACT) {
      if (nowMs - w.lastPotholeMs > 400) {
        w.potholeCount += 1;
        w.lastPotholeMs = nowMs;
      }
      const decay = Math.floor(dtMs / 2);
      w.anomalyAccumMs = w.anomalyAccumMs > decay ? w.anomalyAccumMs - decay : 0;
    } else if (inPotholeCooldown) {
      const decay = Math.floor(dtMs / 4);
      w.anomalyAccumMs = w.anomalyAccumMs > decay ? w.anomalyAccumMs - decay : 0;
    } else {
      const decay = dtMs * 2;
      w.anomalyAccumMs = w.anomalyAccumMs > decay ? w.anomalyAccumMs - decay : 0;
    }

    if (w.anomalyAccumMs >= cfg.faultConfirmDurationMs) {
      w.faultConfirmed = true;
    } else if (w.anomalyAccumMs === 0) {
      w.faultConfirmed = false;
    }
  }

  update(nowMs) {
    let dtMs = this.lastUpdateMs === 0 || nowMs < this.lastUpdateMs ? 50 : nowMs - this.lastUpdateMs;
    if (dtMs > 500) dtMs = 500;
    this.lastUpdateMs = nowMs;

    let activeCount = 0;
    let offlineMask = 0;
    let allStandstill = true;

    for (let i = 0; i < WHEEL_COUNT; i++) {
      const w = this.wheels[i];
      if (w.seenEver) {
        w.online = nowMs - w.lastRxMs <= this.config.nodeTimeoutMs;
        if (!w.online) {
          offlineMask |= 1 << i;
        }
      } else {
        w.online = false;
      }

      if (w.online && w.telemetry !== null) {
        activeCount++;
        if (w.telemetry.rmsMv >= this.config.standstillRmsMv) {
          allStandstill = false;
        }
      }
    }

    if (activeCount === 0) {
      allStandstill = true;
    }

    let calCompletedNow = false;
    if (this.calibrating) {
      const elapsed = nowMs - this.calStartMs;
      for (const w of this.wheels) {
        if (w.online && w.telemetry !== null && nowMs - w.lastRxMs <= 300) {
          const x = w.telemetry.rmsMv;
          if (w.calCount < 5 || x < w.calMean * 3.5) {
            w.calCount += 1;
            const delta = x - w.calMean;
            w.calMean += delta / w.calCount;
            const delta2 = x - w.calMean;
            w.calM2 += delta * delta2;
          }
        }
      }

      if (elapsed >= this.calDurationMs) {
        this.calibrating = false;
        calCompletedNow = true;
        for (const w of this.wheels) {
          if (w.calCount >= 5) {
            let calRms = w.calMean;
            if (calRms < 8.0) calRms = 8.0;
            if (calRms > 150.0) calRms = 150.0;
            w.baselineRmsMv = calRms;
          }
        }
      }
      this.summary.calProgressPct = Math.min(100, Math.floor((elapsed * 100) / this.calDurationMs));
    } else {
      this.summary.calProgressPct = 100;
    }

    let badRoadVotes = 0;
    let warnVotes = 0;
    let faultMask = 0;
    let deadSensorMask = 0;
    let vrefFaultMask = 0;
    let sht40FaultMask = 0;

    for (let i = 0; i < WHEEL_COUNT; i++) {
      const w = this.wheels[i];
      if (!w.online || w.telemetry === null) continue;

      const otherRms = [];
      const otherTemp = [];
      let otherRoughCount = 0;
      let maxPeerRms = 0;

      for (let j = 0; j < WHEEL_COUNT; j++) {
        if (j === i) continue;
        const peer = this.wheels[j];
        if (peer.online && peer.telemetry !== null) {
          const r = peer.telemetry.rmsMv;
          otherRms.push(r);
          if (r > maxPeerRms) maxPeerRms = r;
          const jBase = Math.max(peer.baselineRmsMv, this.config.minPeerMedianMv);
          if (r >= jBase * this.config.badRoadFloorRatio) {
            otherRoughCount += 1;
          }
          if (peer.telemetry.sht40Ok && peer.telemetry.tempC !== null) {
            otherTemp.push(peer.telemetry.tempC);
          }
        }
      }

      const peerMedianRms = otherRms.length > 0 ? computeMedian(otherRms) : w.baselineRmsMv;
      const hasPeerTemp = otherTemp.length > 0;
      const peerMedTemp = hasPeerTemp ? computeMedian(otherTemp) : 0.0;

      this.evaluateWheel(
        i,
        nowMs,
        dtMs,
        peerMedianRms,
        peerMedTemp,
        hasPeerTemp,
        activeCount,
        otherRoughCount,
        allStandstill,
        maxPeerRms
      );

      if (w.sensorDead) deadSensorMask |= 1 << i;
      if (w.vrefStatus === 'LOW_RAIL' || w.vrefStatus === 'HIGH_RAIL') vrefFaultMask |= 1 << i;
      if (!w.telemetry.sht40Ok) sht40FaultMask |= 1 << i;

      if (w.faultConfirmed) {
        faultMask |= 1 << i;
      } else if (w.anomalyAccumMs >= this.config.warningDelayMs) {
        warnVotes += 1;
      } else if (w.predictedClass === CLASS_BAD_ROAD) {
        badRoadVotes += 1;
      }
    }

    if ((faultMask & ~this.prevFaultMask) !== 0 || faultMask === 0) {
      this.buzzerMuted = false;
    }
    this.prevFaultMask = faultMask;

    this.summary.activeWheelCount = activeCount;
    this.summary.offlineWheelMask = offlineMask;
    this.summary.deadSensorMask = deadSensorMask;
    this.summary.vrefFaultMask = vrefFaultMask;
    this.summary.sht40FaultMask = sht40FaultMask;
    this.summary.calibrating = this.calibrating;
    this.summary.faultWheelMask = faultMask;
    this.summary.standstill = allStandstill;
    this.summary.badRoadActive = badRoadVotes >= 2 || (activeCount === 1 && badRoadVotes === 1);
    this.summary.buzzerMuted = this.buzzerMuted;

    if (faultMask !== 0) {
      this.summary.alertLevel = ALERT_SERVICE_TO;
      this.summary.roadState = ROAD_STATES.SERVICE_TO;
    } else if (warnVotes > 0) {
      this.summary.alertLevel = ALERT_WARNING;
      this.summary.roadState = ROAD_STATES.WARNING;
    } else if (this.summary.badRoadActive) {
      this.summary.alertLevel = ALERT_BAD_ROAD;
      this.summary.roadState = ROAD_STATES.COBBLESTONE;
    } else if (allStandstill) {
      this.summary.alertLevel = ALERT_OK;
      this.summary.roadState = ROAD_STATES.STANDSTILL;
    } else {
      this.summary.alertLevel = ALERT_OK;
      this.summary.roadState = ROAD_STATES.SMOOTH;
    }

    return calCompletedNow;
  }

  getSnapshot(nowMs) {
    return {
      nowMs,
      config: { ...this.config },
      summary: { ...this.summary },
      wheels: this.wheels.map((w) => ({
        wheelId: w.wheelId,
        name: w.name,
        seenEver: w.seenEver,
        online: w.online,
        ageMs: w.seenEver ? Math.max(0, nowMs - w.lastRxMs) : null,
        rxPacketCount: w.rxPacketCount,
        mcu: w.mcu,
        baselineRmsMv: Number(w.baselineRmsMv.toFixed(2)),
        telemetry: w.online ? w.telemetry : null,
        features: w.online ? w.features.map((v) => Number(v.toFixed(4))) : null,
        probs: w.online ? w.probs.map((v) => Number(v.toFixed(4))) : null,
        predictedClass: w.online ? w.predictedClass : null,
        predictedClassName: w.online ? w.predictedClassName : null,
        peerRatio: w.online ? Number(w.peerRatio.toFixed(2)) : null,
        axleRatio: w.online ? Number(w.axleRatio.toFixed(2)) : null,
        tempDeltaC: w.online ? Number(w.tempDeltaC.toFixed(2)) : null,
        anomalyAccumMs: w.anomalyAccumMs,
        faultConfirmed: w.faultConfirmed,
        thermalOverheat: w.thermalOverheat,
        condensationRisk: w.condensationRisk,
        vrefStatus: w.online ? w.vrefStatus : 'UNKNOWN',
        roadSuppressed: w.roadSuppressed,
        guardReasons: w.guardReasons,
        sensorDead: w.sensorDead,
        potholeCount: w.potholeCount,
        hubVerdict: w.online ? w.hubVerdict : null,
      })),
    };
  }
}

module.exports = {
  WHEEL_NAMES,
  WHEEL_COUNT,
  CLASS_NORMAL,
  CLASS_BAD_ROAD,
  CLASS_POTHOLE_IMPACT,
  CLASS_ANOMALY_FAULT,
  CLASS_NAMES,
  ALERT_OK,
  ALERT_BAD_ROAD,
  ALERT_WARNING,
  ALERT_SERVICE_TO,
  ROAD_STATES,
  DEFAULT_CONFIG,
  runMlpInference,
  WheelClassifierEngine,
};
