'use strict';

// ============================================================================
// TechBIT v2.3 Diagnostics & Domain-Invariant ML Rule Engine
// Exact JavaScript parity with C++ RuleEngine.cpp (esp-code):
//   - Per-module sensor configuration (Front Left T1-L, Front Right T1-R, S3 Master)
//   - Domain-invariant ML features: kurtosis, hfEnergy (600..4500 Hz), tonality, bandLow
//   - Per-wheel online Welford Auto-Baseline -> Z-score (solves Hyundai Santa Fe vs 40t Truck!)
//   - Vehicle class selector: 'crossover' (Hyundai Santa Fe MVP default) | 'truck' (40t)
// ============================================================================

const RIG_PROFILES = {
  mvp_front: {
    id: 'mvp_front',
    label: 'MVP Стенд: Перед (T1-L / T1-R) + S3 Master',
    shortLabel: 'MVP 2 колеса + S3',
    slots: [1],
    hasBridge: false,
    expectedWheels: 2,
  },
  tractor_4: {
    id: 'tractor_4',
    label: 'Тягач: 2 осі (4 колеса) + S3 Master',
    shortLabel: 'Тягач 4 колеса',
    slots: [1, 2],
    hasBridge: false,
    expectedWheels: 4,
  },
  full_10: {
    id: 'full_10',
    label: 'Повна зчіпка: 10 коліс + ESP-NOW Місток + S3',
    shortLabel: 'Зчіпка 10 коліс',
    slots: [1, 2, 3, 4, 5],
    hasBridge: true,
    expectedWheels: 10,
  },
};

const VEHICLE_CLASSES = ['crossover', 'truck'];
const TEMP_SENSOR_TYPES = ['sht40', 'ntc', 'dual'];
const VIB_SENSOR_TYPES = ['piezo_mcp6002', 'piezo_direct', 'mems_imu'];
const S3_MODES = ['s3_can_lte_led', 's3_usb_bench', 's3_ble_bridge'];
const S3_LINKS = ['can_500k', 'usb_direct', 'wifi_push'];

const AXLE_SLOTS = [
  { slot: 1, key: 'T1', asset: 'tractor', axleNum: 1, label: 'Передня вісь (T1)', codeL: 'T1-L', codeR: 'T1-R' },
  { slot: 2, key: 'T2', asset: 'tractor', axleNum: 2, label: 'Задня вісь (T2)',   codeL: 'T2-L', codeR: 'T2-R' },
  { slot: 3, key: 'P1', asset: 'trailer', axleNum: 1, label: 'Причеп • Вісь 1',   codeL: 'P1-L', codeR: 'P1-R' },
  { slot: 4, key: 'P2', asset: 'trailer', axleNum: 2, label: 'Причеп • Вісь 2',   codeL: 'P2-L', codeR: 'P2-R' },
  { slot: 5, key: 'P3', asset: 'trailer', axleNum: 3, label: 'Причеп • Вісь 3',   codeL: 'P3-L', codeR: 'P3-R' },
];

function createDefaultModuleSensors() {
  return {
    frontLeft: { vib: 'piezo_mcp6002', temp: 'sht40' },
    frontRight: { vib: 'piezo_mcp6002', temp: 'sht40' },
    s3Master: { mode: 's3_can_lte_led', link: 'can_500k' },
  };
}

const DEFAULT_CONFIG = {
  rigProfile: 'mvp_front',
  vehicleClass: 'crossover', // Hyundai Santa Fe MVP default; switchable to 'truck'
  tempSensorType: 'sht40',
  vibSensorType: 'piezo_mcp6002',
  moduleSensors: createDefaultModuleSensors(),
  tempWarnC: 70.0,
  tempCritC: 95.0,
  axleTempDeltaWarnC: 18.0,
  axleTempDeltaCritC: 35.0,
  vibWarnRmsMmS: 3.5,
  vibCritRmsMmS: 6.5,
  vibDeltaRatioWarn: 2.2,
  shadowVibRatio: 1.65,
  kurtosisWarn: 5.5,
  hfEnergyWarn: 0.56,
  zScoreWarn: 3.5,
  zScoreCrit: 6.0,
  baselineMinSamples: 25,
  autoBaselineEnabled: true,
  yellowConfirmSec: 60,
  redConfirmSec: 5,
  shadowModeEnabled: true,
  nodeTimeoutMs: 5000,
  vrefMinMv: 1480,
  vrefMaxMv: 1820,
  humidityWarnPct: 85.0,
  configVersion: 1,
};

function createEmptyBaseline() {
  return {
    samples: 0,
    meanRms: 0,
    m2Rms: 0,
    stdRms: 0,
    lastZScore: 0,
    ready: false,
  };
}

function createEmptySide(code, side) {
  return {
    code,
    side,
    online: false,
    lastRxMs: 0,
    rmsMv: 0,
    rmsMmS: 0,
    peakMmS: 0,
    crest: 1.0,
    kurtosis: 3.0,
    hfEnergy: 0.25,
    bandLow: 0.5,
    tonality: 1.0,
    dcOffsetMv: null,
    vrefStatus: 'UNKNOWN',
    fDomHz: 0,
    clip: false,
    tempC: null,
    rh: null,
    shtOk: false,
    humidityWarn: false,
    spectrum: new Array(32).fill(0),
    baseline: createEmptyBaseline(),
    severity: 'OFFLINE',
  };
}

function createEmptyAxle(def) {
  return {
    slot: def.slot,
    key: def.key,
    asset: def.asset,
    axleNum: def.axleNum,
    label: def.label,
    nodeId: null,
    online: false,
    seenEver: false,
    lastRxMs: 0,
    rxCount: 0,
    left: createEmptySide(def.codeL, 'L'),
    right: createEmptySide(def.codeR, 'R'),
    tempDeltaC: 0,
    vibRatio: 1.0,
    yellowAccumMs: 0,
    redAccumMs: 0,
    yellowLatched: false,
    redLatched: false,
    shadowTriggered: false,
    hotSide: 'L',
    lastReason: 'NORMAL',
    i2c: { sda: 8, scl: 9, addr: '—', err: 0 },
    can: { ready: false, tx: 0, err: 0 },
  };
}

function makeUuid(ts, nodeStr, seq) {
  const h1 = (ts >>> 0).toString(16).padStart(8, '0');
  const h2 = (((seq * 2654435761) >>> 16) & 0xffff).toString(16).padStart(4, '0');
  const h3 = (0x4000 | (seq & 0x0fff)).toString(16).padStart(4, '0');
  const h4 = (0x8000 | ((ts ^ seq) & 0x3fff)).toString(16).padStart(4, '0');
  const tag = String(nodeStr || 'C3000000')
    .replace(/[^A-Fa-f0-9]/g, '')
    .padEnd(12, '0')
    .slice(0, 12)
    .toLowerCase();
  return `${h1}-${h2}-${h3}-${h4}-${tag}`;
}

function deriveBandsFromSpectrum(spectrum) {
  if (!Array.isArray(spectrum) || spectrum.length !== 32) {
    return { bandLow: 0.5, hfEnergy: 0.25, tonality: 1.0 };
  }
  let lowP = 0;
  let hfP = 0;
  let sumMag = 0;
  let maxMag = 0;
  for (let b = 0; b < 32; b++) {
    const m = Math.max(0, Number(spectrum[b]) || 0);
    const p = m * m;
    const fCenter = b * 140 + 70;
    if (fCenter < 600) lowP += p;
    else hfP += p;
    sumMag += m;
    if (m > maxMag) maxMag = m;
  }
  const tot = lowP + hfP;
  const meanMag = sumMag / 32;
  if (tot <= 1e-6) return { bandLow: 0.5, hfEnergy: 0.25, tonality: 1.0 };
  return {
    bandLow: Number((lowP / tot).toFixed(3)),
    hfEnergy: Number((hfP / tot).toFixed(3)),
    tonality: Number((meanMag > 1e-4 ? maxMag / meanMag : 1.0).toFixed(2)),
  };
}

class TechBitV2Engine {
  constructor(initialConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...initialConfig,
      moduleSensors: {
        frontLeft: {
          ...createDefaultModuleSensors().frontLeft,
          ...(initialConfig.moduleSensors?.frontLeft || {}),
        },
        frontRight: {
          ...createDefaultModuleSensors().frontRight,
          ...(initialConfig.moduleSensors?.frontRight || {}),
        },
        s3Master: {
          ...createDefaultModuleSensors().s3Master,
          ...(initialConfig.moduleSensors?.s3Master || {}),
        },
      },
    };
    if (!RIG_PROFILES[this.config.rigProfile]) this.config.rigProfile = 'mvp_front';
    if (!VEHICLE_CLASSES.includes(this.config.vehicleClass)) this.config.vehicleClass = 'crossover';
    this.reset();
  }

  getProfileMeta() {
    return RIG_PROFILES[this.config.rigProfile] || RIG_PROFILES.mvp_front;
  }

  isSlotInProfile(slot) {
    return this.getProfileMeta().slots.includes(slot);
  }

  getSideSensorConfig(code) {
    if (code === 'T1-L') return this.config.moduleSensors.frontLeft;
    if (code === 'T1-R') return this.config.moduleSensors.frontRight;
    return {
      vib: this.config.vibSensorType,
      temp: this.config.tempSensorType,
    };
  }

  reset() {
    this.lastUpdateMs = 0;
    this.eventSeq = 0;
    this.tractorId = this.config.vehicleClass === 'crossover' ? 'SANTA_FE_MVP' : 'TR_001';
    this.trailerId = 'TL_042';
    this.deviceId = 'S3_MASTER_MVP';

    this.axles = AXLE_SLOTS.map((d) => createEmptyAxle(d));
    this.nodeIdToSlot = new Map();

    this.bridge = {
      online: false,
      seenEver: false,
      lastRxMs: 0,
      trailerId: 'TL_042',
      paired: false,
      rssi: null,
      seq: 0,
      nodeCount: 0,
      canRx: 0,
    };

    this.s3Master = {
      online: false,
      seenEver: false,
      lastRxMs: 0,
      deviceId: 'S3_MASTER_MVP',
      bleActive: false,
      lteOnline: false,
      pendingQueue: 0,
      blackBoxRecs: 0,
      buzzerMuted: false,
    };

    this.indicator = {
      driverSeverity: 'STANDBY',
      wheelCode: '—',
      buzzerOn: false,
      shadowCount: 0,
      roughRoadActive: false,
      potholeCount: 0,
      activeAxles: 0,
      activeWheels: 0,
      expectedWheels: this.getProfileMeta().expectedWheels,
      offlineAxles: 0,
    };

    this.blackBoxRing = [];
    this.burstEvents = [];
    this.incidents = [];
  }

  resetBaselines() {
    for (const ax of this.axles) {
      ax.left.baseline = createEmptyBaseline();
      ax.right.baseline = createEmptyBaseline();
      ax.yellowAccumMs = 0;
      ax.redAccumMs = 0;
      ax.yellowLatched = false;
      ax.redLatched = false;
      ax.shadowTriggered = false;
      ax.lastReason = 'NORMAL';
    }
  }

  updateConfig(patch) {
    if (!patch || typeof patch !== 'object') return this.config;
    const numKeys = [
      'tempWarnC',
      'tempCritC',
      'axleTempDeltaWarnC',
      'axleTempDeltaCritC',
      'vibWarnRmsMmS',
      'vibCritRmsMmS',
      'vibDeltaRatioWarn',
      'shadowVibRatio',
      'kurtosisWarn',
      'hfEnergyWarn',
      'zScoreWarn',
      'zScoreCrit',
      'baselineMinSamples',
      'yellowConfirmSec',
      'redConfirmSec',
      'nodeTimeoutMs',
      'vrefMinMv',
      'vrefMaxMv',
      'humidityWarnPct',
    ];
    let changed = false;

    if (patch.rigProfile && RIG_PROFILES[patch.rigProfile] && patch.rigProfile !== this.config.rigProfile) {
      this.config.rigProfile = patch.rigProfile;
      changed = true;
    }

    if (patch.vehicleClass && VEHICLE_CLASSES.includes(patch.vehicleClass) && patch.vehicleClass !== this.config.vehicleClass) {
      this.config.vehicleClass = patch.vehicleClass;
      this.tractorId = patch.vehicleClass === 'crossover' ? 'SANTA_FE_MVP' : 'TR_001';
      this.resetBaselines();
      changed = true;
    }

    if (patch.tempSensorType && TEMP_SENSOR_TYPES.includes(patch.tempSensorType)) {
      if (patch.tempSensorType !== this.config.tempSensorType) changed = true;
      this.config.tempSensorType = patch.tempSensorType;
      if (!patch.moduleSensors) {
        this.config.moduleSensors.frontLeft.temp = patch.tempSensorType;
        this.config.moduleSensors.frontRight.temp = patch.tempSensorType;
      }
    }
    if (patch.vibSensorType && VIB_SENSOR_TYPES.includes(patch.vibSensorType)) {
      if (patch.vibSensorType !== this.config.vibSensorType) changed = true;
      this.config.vibSensorType = patch.vibSensorType;
      if (!patch.moduleSensors) {
        this.config.moduleSensors.frontLeft.vib = patch.vibSensorType;
        this.config.moduleSensors.frontRight.vib = patch.vibSensorType;
      }
    }

    if (patch.moduleSensors && typeof patch.moduleSensors === 'object') {
      const ms = patch.moduleSensors;
      if (ms.frontLeft) {
        if (VIB_SENSOR_TYPES.includes(ms.frontLeft.vib) && ms.frontLeft.vib !== this.config.moduleSensors.frontLeft.vib) {
          this.config.moduleSensors.frontLeft.vib = ms.frontLeft.vib;
          changed = true;
        }
        if (TEMP_SENSOR_TYPES.includes(ms.frontLeft.temp) && ms.frontLeft.temp !== this.config.moduleSensors.frontLeft.temp) {
          this.config.moduleSensors.frontLeft.temp = ms.frontLeft.temp;
          changed = true;
        }
      }
      if (ms.frontRight) {
        if (VIB_SENSOR_TYPES.includes(ms.frontRight.vib) && ms.frontRight.vib !== this.config.moduleSensors.frontRight.vib) {
          this.config.moduleSensors.frontRight.vib = ms.frontRight.vib;
          changed = true;
        }
        if (TEMP_SENSOR_TYPES.includes(ms.frontRight.temp) && ms.frontRight.temp !== this.config.moduleSensors.frontRight.temp) {
          this.config.moduleSensors.frontRight.temp = ms.frontRight.temp;
          changed = true;
        }
      }
      if (ms.s3Master) {
        if (S3_MODES.includes(ms.s3Master.mode) && ms.s3Master.mode !== this.config.moduleSensors.s3Master.mode) {
          this.config.moduleSensors.s3Master.mode = ms.s3Master.mode;
          changed = true;
        }
        if (S3_LINKS.includes(ms.s3Master.link) && ms.s3Master.link !== this.config.moduleSensors.s3Master.link) {
          this.config.moduleSensors.s3Master.link = ms.s3Master.link;
          changed = true;
        }
      }
    }

    for (const k of numKeys) {
      if (patch[k] !== undefined && Number.isFinite(Number(patch[k]))) {
        if (this.config[k] !== Number(patch[k])) changed = true;
        this.config[k] = Number(patch[k]);
      }
    }
    if (typeof patch.shadowModeEnabled === 'boolean') {
      if (this.config.shadowModeEnabled !== patch.shadowModeEnabled) changed = true;
      this.config.shadowModeEnabled = patch.shadowModeEnabled;
    }
    if (typeof patch.autoBaselineEnabled === 'boolean') {
      if (this.config.autoBaselineEnabled !== patch.autoBaselineEnabled) changed = true;
      this.config.autoBaselineEnabled = patch.autoBaselineEnabled;
    }

    if (changed) {
      this.config.configVersion += 1;
      for (const ax of this.axles) {
        this.evaluateSideHardware(ax.left);
        this.evaluateSideHardware(ax.right);
      }
    }
    return this.config;
  }

  assignSlot(nodeId, slotNumber) {
    const slot = Number(slotNumber);
    if (!nodeId || slot < 1 || slot > 5) return false;
    this.nodeIdToSlot.set(String(nodeId), slot);
    return true;
  }

  parseSlotOverride(slotOverride) {
    if (!slotOverride || slotOverride === 'auto' || slotOverride === 's3') {
      return { slot: null, sideOnly: null };
    }
    const str = String(slotOverride).trim().toUpperCase();
    const wheelMatch = str.match(/^([TP])([1-3])-([LR])$/);
    if (wheelMatch) {
      const slotMap = { T1: 1, T2: 2, P1: 3, P2: 4, P3: 5 };
      const slot = slotMap[`${wheelMatch[1]}${wheelMatch[2]}`] || 1;
      return { slot, sideOnly: wheelMatch[3] };
    }
    const num = Number(slotOverride);
    if (num >= 1 && num <= 5) return { slot: num, sideOnly: null };
    return { slot: null, sideOnly: null };
  }

  resolveSlot(nodeId, requestedSlot, fromTrailer = false) {
    const req = Number(requestedSlot);
    if (req >= 1 && req <= 5) {
      if (nodeId) this.nodeIdToSlot.set(String(nodeId), req);
      return req;
    }
    if (nodeId && this.nodeIdToSlot.has(String(nodeId))) {
      return this.nodeIdToSlot.get(String(nodeId));
    }
    const profileSlots = this.getProfileMeta().slots;
    const range = fromTrailer ? [3, 4, 5] : profileSlots.length > 0 ? profileSlots : [1, 2, 3, 4, 5];
    for (const s of range) {
      const ax = this.axles[s - 1];
      if (!ax.nodeId || ax.nodeId === nodeId) {
        if (nodeId) this.nodeIdToSlot.set(String(nodeId), s);
        return s;
      }
    }
    return range[0] || 1;
  }

  evaluateSideHardware(sideObj) {
    const sensorCfg = this.getSideSensorConfig(sideObj.code);
    if (sensorCfg.vib !== 'piezo_mcp6002') {
      sideObj.vrefStatus = 'NA';
    } else if (sideObj.dcOffsetMv !== null && Number.isFinite(sideObj.dcOffsetMv)) {
      sideObj.vrefStatus =
        sideObj.dcOffsetMv >= this.config.vrefMinMv && sideObj.dcOffsetMv <= this.config.vrefMaxMv
          ? 'OK'
          : 'FAULT';
    } else {
      sideObj.vrefStatus = 'UNKNOWN';
    }

    if (sensorCfg.temp === 'ntc') {
      sideObj.humidityWarn = false;
    } else {
      sideObj.humidityWarn =
        sideObj.shtOk && sideObj.rh !== null && sideObj.rh >= this.config.humidityWarnPct;
    }
  }

  applySidePayload(targetSide, src, nowMs) {
    targetSide.online = true;
    targetSide.lastRxMs = nowMs;
    targetSide.rmsMv = Number(src.rmsMv ?? 0);
    targetSide.rmsMmS = Number(src.rmsMmS ?? targetSide.rmsMv * 0.045);
    targetSide.peakMmS = Number(src.peakMmS ?? targetSide.rmsMmS * 2.6);
    targetSide.crest = Number(src.crest ?? 2.6);
    targetSide.dcOffsetMv = src.dcOffsetMv !== undefined ? Number(src.dcOffsetMv) : null;
    targetSide.fDomHz = Number(src.fDomHz ?? 0);
    targetSide.clip = Boolean(src.clip);
    targetSide.tempC = src.tempC !== undefined ? Number(src.tempC) : null;
    targetSide.rh = src.rh !== undefined ? Number(src.rh) : null;
    targetSide.shtOk = Boolean(src.shtOk);

    if (Array.isArray(src.spectrum) && src.spectrum.length === 32) {
      targetSide.spectrum = src.spectrum.map((v) => Number(v) || 0);
    }

    const derived = deriveBandsFromSpectrum(targetSide.spectrum);
    targetSide.kurtosis = Number(src.kurtosis ?? 3.0);
    targetSide.hfEnergy = Number(src.hfEnergy ?? derived.hfEnergy);
    targetSide.bandLow = Number(src.bandLow ?? derived.bandLow);
    targetSide.tonality = Number(src.tonality ?? derived.tonality);

    this.evaluateSideHardware(targetSide);
  }

  ingestPacket(pkt, nowMs = Date.now(), slotOverride = null) {
    if (!pkt || typeof pkt !== 'object') return false;
    const override = this.parseSlotOverride(slotOverride);

    if (pkt.type === 'techbit_c3_node') {
      const fromTrailer = Boolean(pkt.fromTrailer) || Number(pkt.slot) >= 3;
      const slot = this.resolveSlot(
        pkt.nodeId,
        override.slot !== null ? override.slot : pkt.slot,
        fromTrailer
      );
      const ax = this.axles[slot - 1];
      ax.nodeId = pkt.nodeId || ax.nodeId || `C3_SLOT${slot}`;
      ax.seenEver = true;
      ax.online = true;
      ax.lastRxMs = nowMs;
      ax.rxCount += 1;

      if (override.sideOnly === 'L') {
        const src = pkt.left || pkt.right;
        if (src) this.applySidePayload(ax.left, src, nowMs);
      } else if (override.sideOnly === 'R') {
        const src = pkt.right || pkt.left;
        if (src) this.applySidePayload(ax.right, src, nowMs);
      } else {
        if (pkt.left) this.applySidePayload(ax.left, pkt.left, nowMs);
        if (pkt.right) this.applySidePayload(ax.right, pkt.right, nowMs);
      }

      if (pkt.i2c) ax.i2c = { ...ax.i2c, ...pkt.i2c };
      if (pkt.can) ax.can = { ...ax.can, ...pkt.can };

      this.pushBlackBox(ax, nowMs);
      return true;
    }

    if (pkt.type === 'techbit_trailer_bridge') {
      this.bridge.seenEver = true;
      this.bridge.online = true;
      this.bridge.lastRxMs = nowMs;
      if (pkt.trailerId) {
        this.bridge.trailerId = pkt.trailerId;
        this.trailerId = pkt.trailerId;
      }
      this.bridge.paired = Boolean(pkt.paired);
      this.bridge.rssi = pkt.rssi !== undefined ? Number(pkt.rssi) : this.bridge.rssi;
      this.bridge.seq = Number(pkt.seq ?? this.bridge.seq);
      this.bridge.nodeCount = Number(pkt.nodeCount ?? 0);
      this.bridge.canRx = Number(pkt.canRx ?? 0);
      return true;
    }

    if (pkt.type === 'techbit_s3_master') {
      this.s3Master.seenEver = true;
      this.s3Master.online = true;
      this.s3Master.lastRxMs = nowMs;
      if (pkt.deviceId) {
        this.s3Master.deviceId = pkt.deviceId;
        this.deviceId = pkt.deviceId;
      }
      if (pkt.tractorId) this.tractorId = pkt.tractorId;
      if (pkt.trailerId) this.trailerId = pkt.trailerId;
      this.s3Master.bleActive = Boolean(pkt.bleActive);
      this.s3Master.lteOnline = Boolean(pkt.lteOnline);
      this.s3Master.pendingQueue = Number(pkt.pendingQueue ?? 0);
      this.s3Master.blackBoxRecs = Number(pkt.blackBoxRecs ?? this.blackBoxRing.length);

      if (Array.isArray(pkt.nodes)) {
        for (const n of pkt.nodes) {
          if (!n.online) continue;
          this.ingestPacket(
            {
              type: 'techbit_c3_node',
              nodeId: n.id,
              slot: n.slot,
              fromTrailer: Boolean(n.trailer),
              left: {
                rmsMmS: n.vL,
                rmsMv: Number((n.vL / 0.045).toFixed(1)),
                tempC: n.tL,
                shtOk: true,
                fDomHz: n.fL || 0,
                kurtosis: n.kL ?? 3.0,
                hfEnergy: n.hfL ?? 0.25,
              },
              right: {
                rmsMmS: n.vR,
                rmsMv: Number((n.vR / 0.045).toFixed(1)),
                tempC: n.tR,
                shtOk: true,
                fDomHz: n.fR || 0,
                kurtosis: n.kR ?? 3.0,
                hfEnergy: n.hfR ?? 0.25,
              },
            },
            nowMs
          );
        }
      }
      return true;
    }

    if (pkt.type === 'techbit_node') {
      const wId = Number(pkt.wheelId ?? 0);
      const slot = override.slot !== null ? override.slot : wId <= 1 ? 1 : 2;
      const isRight = override.sideOnly ? override.sideOnly === 'R' : wId === 1 || wId === 3;
      const sideData = {
        rmsMv: Number(pkt.rmsMv ?? 0),
        rmsMmS: Number(((pkt.rmsMv ?? 0) * 0.045).toFixed(2)),
        peakMmS: Number(((pkt.peakMv ?? 0) * 0.045).toFixed(2)),
        crest: Number(pkt.crestFactor ?? 2.6),
        kurtosis: Number(pkt.kurtosis ?? 3.0),
        dcOffsetMv: pkt.dcOffsetMv !== undefined ? Number(pkt.dcOffsetMv) : null,
        fDomHz: Number(pkt.dominantFreqHz ?? 0),
        clip: Boolean(pkt.surgeClipping),
        tempC: pkt.tempC !== undefined ? Number(pkt.tempC) : null,
        rh: pkt.humidityPct !== undefined ? Number(pkt.humidityPct) : null,
        shtOk: Boolean(pkt.sht40Ok),
        spectrum: Array.isArray(pkt.spectrum) ? pkt.spectrum : undefined,
      };
      return this.ingestPacket(
        {
          type: 'techbit_c3_node',
          nodeId: `LEGACY_W${wId}`,
          slot,
          [isRight ? 'right' : 'left']: sideData,
        },
        nowMs,
        override.sideOnly ? `${slot === 1 ? 'T1' : 'T2'}-${override.sideOnly}` : null
      );
    }

    return false;
  }

  pushBlackBox(ax, nowMs) {
    this.blackBoxRing.push({
      tsUtc: new Date(nowMs).toISOString(),
      nodeId: ax.nodeId,
      slot: ax.slot,
      tL: ax.left.tempC,
      tR: ax.right.tempC,
      vL: ax.left.rmsMmS,
      vR: ax.right.rmsMmS,
      kL: ax.left.kurtosis,
      kR: ax.right.kurtosis,
      hfL: ax.left.hfEnergy,
      hfR: ax.right.hfEnergy,
    });
    if (this.blackBoxRing.length > 240) this.blackBoxRing.shift();
  }

  recordBurstEvent(ax, severity, wheelCode, reason, nowMs) {
    this.eventSeq += 1;
    const eventId = makeUuid(Math.floor(nowMs / 1000), ax.nodeId, this.eventSeq);
    const tsUtc = new Date(nowMs).toISOString();
    const summary = this.axles
      .filter((a) => a.online && this.isSlotInProfile(a.slot))
      .map((a) => ({
        node_id: a.nodeId,
        slot: a.key,
        temp_c: Number(Math.max(a.left.tempC ?? 0, a.right.tempC ?? 0).toFixed(1)),
        vib_rms: Number(Math.max(a.left.rmsMmS, a.right.rmsMmS).toFixed(2)),
        kurtosis: Number(Math.max(a.left.kurtosis, a.right.kurtosis).toFixed(2)),
        hf_energy: Number(Math.max(a.left.hfEnergy, a.right.hfEnergy).toFixed(3)),
        z_score: Number(Math.max(a.left.baseline.lastZScore, a.right.baseline.lastZScore).toFixed(2)),
      }));

    const sliceJson = JSON.stringify(this.blackBoxRing.slice(-16));
    const burstB64 = Buffer.from(sliceJson, 'utf-8').toString('base64');

    const packet = {
      protocol_version: 1,
      device_id: this.deviceId,
      timestamp_utc: tsUtc,
      vehicle_class: this.config.vehicleClass,
      tractor_id: this.tractorId,
      trailer_id: this.getProfileMeta().hasBridge ? this.trailerId : null,
      rig_profile: this.config.rigProfile,
      module_sensors: this.config.moduleSensors,
      packet_type: 'ANOMALY_BURST',
      event_id: eventId,
      severity,
      trigger_node_id: ax.nodeId,
      wheel_code: wheelCode,
      trigger_reason: reason,
      firmware_version: '2.3.0-ml-mvp',
      config_version: this.config.configVersion,
      summary,
      burst_samples_base64: burstB64,
    };

    this.burstEvents.unshift(packet);
    if (this.burstEvents.length > 25) this.burstEvents.pop();

    const hotObj = ax.hotSide === 'R' ? ax.right : ax.left;
    const ticket = {
      ticket_id: `TKT-${String(this.eventSeq).padStart(3, '0')}`,
      event_id: eventId,
      created_at_utc: tsUtc,
      wheel_code: wheelCode,
      axle_label: ax.label,
      severity,
      reason,
      temp_c: Number((hotObj.tempC ?? 0).toFixed(1)),
      temp_delta_c: Number(ax.tempDeltaC.toFixed(1)),
      vib_rms: Number(hotObj.rmsMmS.toFixed(2)),
      kurtosis: Number(hotObj.kurtosis.toFixed(2)),
      hf_energy: Number(hotObj.hfEnergy.toFixed(3)),
      z_score: Number(hotObj.baseline.lastZScore.toFixed(2)),
      status: severity === 'SHADOW' ? 'CLOSED' : 'OPEN',
      resolution_code: severity === 'SHADOW' ? 'SHADOW_OBSERVATION' : null,
      resolved_at_utc: severity === 'SHADOW' ? tsUtc : null,
    };
    this.incidents.unshift(ticket);
    if (this.incidents.length > 40) this.incidents.pop();
    return packet;
  }

  resolveIncident(ticketId, resolutionCode) {
    const t = this.incidents.find((x) => x.ticket_id === ticketId);
    if (!t) return null;
    t.status = 'CLOSED';
    t.resolution_code = resolutionCode;
    t.resolved_at_utc = new Date().toISOString();
    return t;
  }

  resetAlerts() {
    for (const ax of this.axles) {
      ax.yellowAccumMs = 0;
      ax.redAccumMs = 0;
      ax.yellowLatched = false;
      ax.redLatched = false;
      ax.shadowTriggered = false;
      ax.lastReason = 'NORMAL';
    }
    this.s3Master.buzzerMuted = false;
    this.indicator.potholeCount = 0;
  }

  toggleMute() {
    this.s3Master.buzzerMuted = !this.s3Master.buzzerMuted;
    return this.s3Master.buzzerMuted;
  }

  updateWheelBaseline(b, rms, allowLearn) {
    const stdFloor = this.config.vehicleClass === 'crossover' ? 0.14 : 0.30;

    if (b.ready) {
      const denom = Math.max(b.stdRms, stdFloor);
      b.lastZScore = Number(((rms - b.meanRms) / denom).toFixed(2));
    } else {
      b.lastZScore = 0;
    }

    if (!this.config.autoBaselineEnabled || !allowLearn || rms < 0.08) return;
    if (b.ready && b.lastZScore >= this.config.zScoreWarn * 0.75) return;

    if (b.samples < 600) {
      b.samples += 1;
      const delta = rms - b.meanRms;
      b.meanRms += delta / b.samples;
      const delta2 = rms - b.meanRms;
      b.m2Rms += delta * delta2;
      if (b.samples >= 2) {
        b.stdRms = Math.sqrt(b.m2Rms / (b.samples - 1));
      }
    } else {
      const alpha = 0.002;
      const diff = rms - b.meanRms;
      b.meanRms += alpha * diff;
      const variance = (1 - alpha) * (b.stdRms * b.stdRms) + alpha * (diff * diff);
      b.stdRms = Math.sqrt(Math.max(variance, 0.0001));
    }

    if (b.samples >= this.config.baselineMinSamples) {
      b.ready = true;
      const denom = Math.max(b.stdRms, stdFloor);
      b.lastZScore = Number(((rms - b.meanRms) / denom).toFixed(2));
    }
  }

  update(nowMs = Date.now()) {
    const dtMs =
      this.lastUpdateMs === 0 || nowMs < this.lastUpdateMs
        ? 100
        : Math.min(1000, nowMs - this.lastUpdateMs);
    this.lastUpdateMs = nowMs;

    const profile = this.getProfileMeta();
    const isCrossover = this.config.vehicleClass === 'crossover';
    let activeAxles = 0;
    let activeWheels = 0;
    let offlineAxles = 0;
    let vibSum = 0;

    for (const ax of this.axles) {
      const inProfile = profile.slots.includes(ax.slot);
      const timeout = this.config.nodeTimeoutMs;

      ax.left.online = ax.left.lastRxMs > 0 && nowMs - ax.left.lastRxMs <= timeout;
      ax.right.online = ax.right.lastRxMs > 0 && nowMs - ax.right.lastRxMs <= timeout;
      ax.online = ax.seenEver && nowMs - ax.lastRxMs <= timeout && (ax.left.online || ax.right.online);

      if (!ax.left.online) ax.left.severity = 'OFFLINE';
      if (!ax.right.online) ax.right.severity = 'OFFLINE';

      if (!inProfile) continue;

      if (ax.online) {
        activeAxles += 1;
        if (ax.left.online) activeWheels += 1;
        if (ax.right.online) activeWheels += 1;
        const meanV =
          ax.left.online && ax.right.online
            ? 0.5 * (ax.left.rmsMmS + ax.right.rmsMmS)
            : ax.left.online
              ? ax.left.rmsMmS
              : ax.right.rmsMmS;
        vibSum += meanV;
      } else if (ax.seenEver) {
        offlineAxles += 1;
      }
    }

    if (this.bridge.seenEver) {
      this.bridge.online = nowMs - this.bridge.lastRxMs <= this.config.nodeTimeoutMs;
    }
    if (this.s3Master.seenEver) {
      this.s3Master.online = nowMs - this.s3Master.lastRxMs <= this.config.nodeTimeoutMs;
    }

    const fleetFloor = isCrossover ? 0.30 : 0.80;
    const fleetMeanVib = activeAxles > 0 ? Math.max(fleetFloor, vibSum / activeAxles) : 1.0;
    const roughThresh = isCrossover ? Math.min(this.config.vibWarnRmsMmS, 2.4) : this.config.vibWarnRmsMmS;

    let roughCount = 0;
    for (const ax of this.axles) {
      if (!ax.online || !profile.slots.includes(ax.slot)) continue;
      if (ax.left.online && ax.right.online) {
        const minV = Math.max(fleetFloor, Math.min(ax.left.rmsMmS, ax.right.rmsMmS));
        const maxV = Math.max(ax.left.rmsMmS, ax.right.rmsMmS);
        if (0.5 * (ax.left.rmsMmS + ax.right.rmsMmS) >= roughThresh) roughCount += 1;
        if (
          activeAxles === 1 &&
          ax.left.rmsMmS >= roughThresh &&
          ax.right.rmsMmS >= roughThresh &&
          maxV / minV < 1.35
        ) {
          roughCount = 2;
        }
      }
    }
    const roughRoadAllWheels = roughCount >= 2;

    let highestSev = activeAxles > 0 ? 'GREEN' : 'STANDBY';
    let highestCode = activeAxles > 0 ? 'OK' : '—';
    const yellowConfirmMs = this.config.yellowConfirmSec * 1000;
    const redConfirmMs = this.config.redConfirmSec * 1000;

    for (const ax of this.axles) {
      if (!ax.online || !profile.slots.includes(ax.slot)) continue;

      const bothOnline = ax.left.online && ax.right.online;
      const tL = ax.left.online ? (ax.left.tempC ?? 25.0) : (ax.right.tempC ?? 25.0);
      const tR = ax.right.online ? (ax.right.tempC ?? 25.0) : (ax.left.tempC ?? 25.0);
      const maxTemp = Math.max(tL, tR);
      const tempDelta = bothOnline ? Math.abs(tL - tR) : 0;
      ax.tempDeltaC = tempDelta;

      let rightIsHot = false;
      if (!ax.left.online && ax.right.online) {
        rightIsHot = true;
      } else if (ax.left.online && !ax.right.online) {
        rightIsHot = false;
      } else if (tempDelta >= 3.0) {
        rightIsHot = tR > tL;
      } else if (ax.right.clip && !ax.left.clip) {
        rightIsHot = true;
      } else if (ax.left.clip && !ax.right.clip) {
        rightIsHot = false;
      } else {
        const scoreL = ax.left.rmsMmS + (ax.left.kurtosis >= this.config.kurtosisWarn ? 1.5 : 0);
        const scoreR = ax.right.rmsMmS + (ax.right.kurtosis >= this.config.kurtosisWarn ? 1.5 : 0);
        rightIsHot = scoreR > scoreL;
      }

      ax.hotSide = rightIsHot ? 'R' : 'L';
      const hotObj = rightIsHot ? ax.right : ax.left;
      const coldObj = rightIsHot ? ax.left : ax.right;

      const minSideFloor = isCrossover ? 0.25 : 0.60;
      const minSideVib = bothOnline
        ? Math.max(minSideFloor, Math.min(ax.left.rmsMmS, ax.right.rmsMmS))
        : 1.0;
      const maxSideVib = hotObj.rmsMmS;
      const sideRatio = maxSideVib / minSideVib;
      const peerRatio = maxSideVib / fleetMeanVib;
      ax.vibRatio = Number(sideRatio.toFixed(2));

      const transientPothole =
        (hotObj.crest >= 4.2 || hotObj.clip) &&
        tempDelta < 10.0 &&
        hotObj.hfEnergy < this.config.hfEnergyWarn;

      const calmFrame = !transientPothole && !roughRoadAllWheels && tempDelta < 12.0;
      if (ax.left.online) this.updateWheelBaseline(ax.left.baseline, ax.left.rmsMmS, calmFrame && sideRatio < 1.55);
      if (ax.right.online) this.updateWheelBaseline(ax.right.baseline, ax.right.rmsMmS, calmFrame && sideRatio < 1.55);

      const hotZ = hotObj.baseline.ready ? hotObj.baseline.lastZScore : 0;

      const mlBearingImpulse =
        !transientPothole &&
        !roughRoadAllWheels &&
        hotObj.kurtosis >= this.config.kurtosisWarn &&
        hotObj.hfEnergy >= this.config.hfEnergyWarn &&
        (sideRatio >= 1.45 || hotZ >= 2.5);

      const baselineDriftWarn =
        this.config.autoBaselineEnabled &&
        hotObj.baseline.ready &&
        !transientPothole &&
        !roughRoadAllWheels &&
        hotZ >= this.config.zScoreWarn &&
        (sideRatio >= 1.5 || hotObj.hfEnergy >= this.config.hfEnergyWarn || hotObj.kurtosis >= 4.5);

      const baselineDriftCrit =
        this.config.autoBaselineEnabled &&
        hotObj.baseline.ready &&
        !transientPothole &&
        !roughRoadAllWheels &&
        hotZ >= this.config.zScoreCrit &&
        sideRatio >= this.config.vibDeltaRatioWarn &&
        (hotObj.kurtosis >= this.config.kurtosisWarn || hotObj.hfEnergy >= this.config.hfEnergyWarn);

      const redCond =
        maxTemp >= this.config.tempCritC ||
        tempDelta >= this.config.axleTempDeltaCritC ||
        baselineDriftCrit ||
        (!transientPothole &&
          !roughRoadAllWheels &&
          maxSideVib >= this.config.vibCritRmsMmS &&
          (bothOnline ? sideRatio >= this.config.vibDeltaRatioWarn : peerRatio >= 1.0));

      const yellowCond =
        redCond ||
        maxTemp >= this.config.tempWarnC ||
        tempDelta >= this.config.axleTempDeltaWarnC ||
        mlBearingImpulse ||
        baselineDriftWarn ||
        (!transientPothole &&
          !roughRoadAllWheels &&
          maxSideVib >= this.config.vibWarnRmsMmS &&
          (bothOnline ? sideRatio >= this.config.vibDeltaRatioWarn : true));

      const shadowCond =
        this.config.shadowModeEnabled &&
        !yellowCond &&
        !transientPothole &&
        !roughRoadAllWheels &&
        (bothOnline
          ? sideRatio >= this.config.shadowVibRatio ||
            tempDelta >= this.config.axleTempDeltaWarnC * 0.65 ||
            (hotObj.baseline.ready && hotZ >= 2.5 && hotObj.hfEnergy >= 0.45)
          : maxSideVib >= this.config.vibWarnRmsMmS * 0.72);

      if (redCond) {
        ax.redAccumMs = Math.min(ax.redAccumMs + dtMs, redConfirmMs + 3000);
      } else {
        ax.redAccumMs = Math.max(0, ax.redAccumMs - dtMs * 2);
        if (ax.redAccumMs === 0) ax.redLatched = false;
      }

      if (yellowCond) {
        ax.yellowAccumMs = Math.min(ax.yellowAccumMs + dtMs, yellowConfirmMs + 3000);
      } else if (transientPothole) {
        if (ax.lastReason !== 'POTHOLE_GUARD') this.indicator.potholeCount += 1;
        ax.lastReason = 'POTHOLE_GUARD';
        ax.yellowAccumMs = Math.max(0, ax.yellowAccumMs - dtMs * 0.5);
      } else {
        ax.yellowAccumMs = Math.max(0, ax.yellowAccumMs - dtMs * 2);
        if (ax.yellowAccumMs === 0) ax.yellowLatched = false;
      }

      let reason = 'NORMAL';
      if (maxTemp >= this.config.tempCritC || tempDelta >= this.config.axleTempDeltaCritC) {
        reason = 'TEMP_CRITICAL_BRAKE';
      } else if (tempDelta >= this.config.axleTempDeltaWarnC || maxTemp >= this.config.tempWarnC) {
        reason = 'TEMP_DELTA_HIGH';
      } else if (mlBearingImpulse) {
        reason = 'ML_BEARING_IMPULSE';
      } else if (baselineDriftWarn || baselineDriftCrit) {
        reason = 'BASELINE_ZSCORE_DRIFT';
      } else if (yellowCond) {
        reason = 'VIB_ANOMALY_LOCAL';
      } else if (roughRoadAllWheels) {
        reason = 'COBBLESTONE_FILTERED';
      } else if (transientPothole) {
        reason = 'POTHOLE_GUARD';
      }
      ax.lastReason = reason;

      if (ax.redAccumMs >= redConfirmMs && !ax.redLatched) {
        ax.redLatched = true;
        ax.yellowLatched = true;
        this.recordBurstEvent(ax, 'RED', hotObj.code, reason, nowMs);
      } else if (ax.yellowAccumMs >= yellowConfirmMs && !ax.yellowLatched) {
        ax.yellowLatched = true;
        this.recordBurstEvent(ax, 'YELLOW', hotObj.code, reason, nowMs);
      } else if (shadowCond && !ax.shadowTriggered) {
        ax.shadowTriggered = true;
        this.indicator.shadowCount += 1;
        this.recordBurstEvent(ax, 'SHADOW', hotObj.code, 'SHADOW_EARLY_DRIFT', nowMs);
      } else if (!shadowCond && ax.yellowAccumMs === 0) {
        ax.shadowTriggered = false;
      }

      if (coldObj.online) coldObj.severity = 'GREEN';
      if (ax.redLatched) {
        hotObj.severity = 'RED';
        highestSev = 'RED';
        highestCode = hotObj.code;
      } else if (ax.yellowLatched) {
        hotObj.severity = 'YELLOW';
        if (highestSev !== 'RED') {
          highestSev = 'YELLOW';
          highestCode = hotObj.code;
        }
      } else if (ax.shadowTriggered) {
        hotObj.severity = 'SHADOW';
      } else {
        hotObj.severity = 'GREEN';
      }
    }

    this.indicator.driverSeverity = highestSev;
    this.indicator.wheelCode = highestCode;
    this.indicator.buzzerOn = highestSev === 'RED' && !this.s3Master.buzzerMuted;
    this.indicator.roughRoadActive = roughRoadAllWheels;
    this.indicator.activeAxles = activeAxles;
    this.indicator.activeWheels = activeWheels;
    this.indicator.expectedWheels = profile.expectedWheels;
    this.indicator.offlineAxles = offlineAxles;
  }

  exportGroundTruthCsv() {
    const header =
      'ticket_id,event_id,created_at_utc,wheel_code,severity,reason,temp_c,temp_delta_c,vib_rms,kurtosis,hf_energy,z_score,status,ground_truth_label';
    const lines = this.incidents.map(
      (i) =>
        `${i.ticket_id},${i.event_id},${i.created_at_utc},${i.wheel_code},${i.severity},${i.reason},${i.temp_c},${i.temp_delta_c},${i.vib_rms},${i.kurtosis ?? 3.0},${i.hf_energy ?? 0.25},${i.z_score ?? 0},${i.status},${i.resolution_code || 'UNLABELED'}`
    );
    return [header, ...lines].join('\n');
  }

  getSnapshot(nowMs = Date.now()) {
    return {
      tsUtc: new Date(nowMs).toISOString(),
      tractorId: this.tractorId,
      trailerId: this.trailerId,
      deviceId: this.deviceId,
      profile: this.getProfileMeta(),
      config: {
        ...this.config,
        moduleSensors: {
          frontLeft: { ...this.config.moduleSensors.frontLeft },
          frontRight: { ...this.config.moduleSensors.frontRight },
          s3Master: { ...this.config.moduleSensors.s3Master },
        },
      },
      indicator: { ...this.indicator },
      bridge: { ...this.bridge },
      s3Master: {
        ...this.s3Master,
        blackBoxRecs: Math.max(this.s3Master.blackBoxRecs, this.blackBoxRing.length),
      },
      axles: this.axles,
      burstEvents: this.burstEvents.slice(0, 12),
      incidents: this.incidents.slice(0, 25),
    };
  }
}

module.exports = {
  RIG_PROFILES,
  VEHICLE_CLASSES,
  TEMP_SENSOR_TYPES,
  VIB_SENSOR_TYPES,
  S3_MODES,
  S3_LINKS,
  AXLE_SLOTS,
  DEFAULT_CONFIG,
  TechBitV2Engine,
};
