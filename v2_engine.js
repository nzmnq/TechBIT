'use strict';

// ============================================================================
// TechBIT v2.0 Diagnostics & Rule Engine (JavaScript Parity with C++ RuleEngine)
// Models:
//   - Tractor (2 unified C3 Axle Nodes -> 4 wheels: T1-L/R, T2-L/R)
//   - Trailer Bridge (C3 ESP-NOW LR AES-128 wireless gateway)
//   - Trailer (3 unified C3 Axle Nodes -> 6 wheels: P1-L/R, P2-L/R, P3-L/R)
//   - Cabin S3 Master (Mini LED indicator: GREEN / YELLOW / RED + Wheel Code,
//                      Shadow Mode, Black Box ANOMALY_BURST, BLE 15m, LTE)
// ============================================================================

const AXLE_SLOTS = [
  { slot: 1, key: 'T1', asset: 'tractor', axleNum: 1, label: 'Тягач • Передня вісь', codeL: 'T1-L', codeR: 'T1-R' },
  { slot: 2, key: 'T2', asset: 'tractor', axleNum: 2, label: 'Тягач • Задня вісь',   codeL: 'T2-L', codeR: 'T2-R' },
  { slot: 3, key: 'P1', asset: 'trailer', axleNum: 1, label: 'Причеп • Вісь 1',       codeL: 'P1-L', codeR: 'P1-R' },
  { slot: 4, key: 'P2', asset: 'trailer', axleNum: 2, label: 'Причеп • Вісь 2',       codeL: 'P2-L', codeR: 'P2-R' },
  { slot: 5, key: 'P3', asset: 'trailer', axleNum: 3, label: 'Причеп • Вісь 3',       codeL: 'P3-L', codeR: 'P3-R' },
];

const DEFAULT_CONFIG = {
  tempWarnC: 70.0,
  tempCritC: 95.0,
  axleTempDeltaWarnC: 18.0,
  axleTempDeltaCritC: 35.0,
  vibWarnRmsMmS: 3.5,
  vibCritRmsMmS: 6.5,
  vibDeltaRatioWarn: 2.2,
  shadowVibRatio: 1.65,
  yellowConfirmSec: 60,
  redConfirmSec: 5,
  shadowModeEnabled: true,
  nodeTimeoutMs: 5000,
  vrefMinMv: 1480,
  vrefMaxMv: 1820,
  humidityWarnPct: 85.0,
  configVersion: 1,
};

function createEmptySide(code, side) {
  return {
    code,
    side,
    rmsMv: 0,
    rmsMmS: 0,
    peakMmS: 0,
    crest: 1.0,
    dcOffsetMv: null,
    vrefStatus: 'UNKNOWN', // 'OK' | 'FAULT' | 'UNKNOWN'
    fDomHz: 0,
    clip: false,
    tempC: null,
    rh: null,
    shtOk: false,
    humidityWarn: false,
    spectrum: new Array(32).fill(0),
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
  const h2 = ((seq * 2654435761) >>> 16 & 0xffff).toString(16).padStart(4, '0');
  const h3 = (0x4000 | (seq & 0x0fff)).toString(16).padStart(4, '0');
  const h4 = (0x8000 | ((ts ^ seq) & 0x3fff)).toString(16).padStart(4, '0');
  const tag = String(nodeStr || 'C3000000').replace(/[^A-Fa-f0-9]/g, '').padEnd(12, '0').slice(0, 12).toLowerCase();
  return `${h1}-${h2}-${h3}-${h4}-${tag}`;
}

class TechBitV2Engine {
  constructor(initialConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...initialConfig };
    this.reset();
  }

  reset() {
    this.lastUpdateMs = 0;
    this.eventSeq = 0;
    this.tractorId = 'TR_001';
    this.trailerId = 'TL_042';
    this.deviceId = 'S3_WORKBENCH';

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
      deviceId: 'S3_WORKBENCH',
      bleActive: false,
      lteOnline: false,
      pendingQueue: 0,
      blackBoxRecs: 0,
      buzzerMuted: false,
    };

    this.indicator = {
      driverSeverity: 'STANDBY', // 'STANDBY' | 'GREEN' | 'YELLOW' | 'RED'
      wheelCode: '—',
      buzzerOn: false,
      shadowCount: 0,
      roughRoadActive: false,
      potholeCount: 0,
      activeAxles: 0,
      activeWheels: 0,
      offlineAxles: 0,
    };

    this.blackBoxRing = [];
    this.burstEvents = [];
    this.incidents = [];
  }

  updateConfig(patch) {
    const numKeys = [
      'tempWarnC',
      'tempCritC',
      'axleTempDeltaWarnC',
      'axleTempDeltaCritC',
      'vibWarnRmsMmS',
      'vibCritRmsMmS',
      'vibDeltaRatioWarn',
      'shadowVibRatio',
      'yellowConfirmSec',
      'redConfirmSec',
      'nodeTimeoutMs',
      'vrefMinMv',
      'vrefMaxMv',
      'humidityWarnPct',
    ];
    let changed = false;
    for (const k of numKeys) {
      if (patch[k] !== undefined && Number.isFinite(Number(patch[k]))) {
        this.config[k] = Number(patch[k]);
        changed = true;
      }
    }
    if (typeof patch.shadowModeEnabled === 'boolean') {
      this.config.shadowModeEnabled = patch.shadowModeEnabled;
      changed = true;
    }
    if (changed) {
      this.config.configVersion += 1;
    }
    return this.config;
  }

  assignSlot(nodeId, slotNumber) {
    const slot = Number(slotNumber);
    if (!nodeId || slot < 1 || slot > 5) return false;
    this.nodeIdToSlot.set(String(nodeId), slot);
    return true;
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
    // Auto-assign first free slot in tractor (1..2) or trailer (3..5)
    const range = fromTrailer ? [3, 4, 5] : [1, 2, 3, 4, 5];
    for (const s of range) {
      const ax = this.axles[s - 1];
      if (!ax.nodeId || ax.nodeId === nodeId) {
        if (nodeId) this.nodeIdToSlot.set(String(nodeId), s);
        return s;
      }
    }
    return fromTrailer ? 3 : 1;
  }

  evaluateSideHardware(sideObj) {
    if (sideObj.dcOffsetMv !== null && Number.isFinite(sideObj.dcOffsetMv)) {
      sideObj.vrefStatus =
        sideObj.dcOffsetMv >= this.config.vrefMinMv && sideObj.dcOffsetMv <= this.config.vrefMaxMv
          ? 'OK'
          : 'FAULT';
    } else {
      sideObj.vrefStatus = 'UNKNOWN';
    }
    sideObj.humidityWarn =
      sideObj.shtOk && sideObj.rh !== null && sideObj.rh >= this.config.humidityWarnPct;
  }

  ingestPacket(pkt, nowMs = Date.now(), slotOverride = null) {
    if (!pkt || typeof pkt !== 'object') return false;

    // 1. Unified v2 C3 Axle Node (L+R wheels + SHT40 + 32-bin FFT)
    if (pkt.type === 'techbit_c3_node') {
      const fromTrailer = Boolean(pkt.fromTrailer) || (Number(pkt.slot) >= 3);
      const slot = this.resolveSlot(
        pkt.nodeId,
        slotOverride && slotOverride !== 'auto' ? Number(slotOverride) : pkt.slot,
        fromTrailer
      );
      const ax = this.axles[slot - 1];
      ax.nodeId = pkt.nodeId || ax.nodeId || `C3_SLOT${slot}`;
      ax.seenEver = true;
      ax.online = true;
      ax.lastRxMs = nowMs;
      ax.rxCount += 1;

      if (pkt.left) {
        ax.left.rmsMv = Number(pkt.left.rmsMv ?? 0);
        ax.left.rmsMmS = Number(pkt.left.rmsMmS ?? ax.left.rmsMv * 0.045);
        ax.left.peakMmS = Number(pkt.left.peakMmS ?? ax.left.rmsMmS * 2.6);
        ax.left.crest = Number(pkt.left.crest ?? 2.6);
        ax.left.dcOffsetMv = pkt.left.dcOffsetMv !== undefined ? Number(pkt.left.dcOffsetMv) : null;
        ax.left.fDomHz = Number(pkt.left.fDomHz ?? 0);
        ax.left.clip = Boolean(pkt.left.clip);
        ax.left.tempC = pkt.left.tempC !== undefined ? Number(pkt.left.tempC) : null;
        ax.left.rh = pkt.left.rh !== undefined ? Number(pkt.left.rh) : null;
        ax.left.shtOk = Boolean(pkt.left.shtOk);
        if (Array.isArray(pkt.left.spectrum) && pkt.left.spectrum.length === 32) {
          ax.left.spectrum = pkt.left.spectrum.map((v) => Number(v) || 0);
        }
        this.evaluateSideHardware(ax.left);
      }

      if (pkt.right) {
        ax.right.rmsMv = Number(pkt.right.rmsMv ?? 0);
        ax.right.rmsMmS = Number(pkt.right.rmsMmS ?? ax.right.rmsMv * 0.045);
        ax.right.peakMmS = Number(pkt.right.peakMmS ?? ax.right.rmsMmS * 2.6);
        ax.right.crest = Number(pkt.right.crest ?? 2.6);
        ax.right.dcOffsetMv = pkt.right.dcOffsetMv !== undefined ? Number(pkt.right.dcOffsetMv) : null;
        ax.right.fDomHz = Number(pkt.right.fDomHz ?? 0);
        ax.right.clip = Boolean(pkt.right.clip);
        ax.right.tempC = pkt.right.tempC !== undefined ? Number(pkt.right.tempC) : null;
        ax.right.rh = pkt.right.rh !== undefined ? Number(pkt.right.rh) : null;
        ax.right.shtOk = Boolean(pkt.right.shtOk);
        if (Array.isArray(pkt.right.spectrum) && pkt.right.spectrum.length === 32) {
          ax.right.spectrum = pkt.right.spectrum.map((v) => Number(v) || 0);
        }
        this.evaluateSideHardware(ax.right);
      }

      if (pkt.i2c) ax.i2c = { ...ax.i2c, ...pkt.i2c };
      if (pkt.can) ax.can = { ...ax.can, ...pkt.can };

      this.pushBlackBox(ax, nowMs);
      return true;
    }

    // 2. Trailer Wireless Bridge (C3 ESP-NOW LR AES-128)
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

    // 3. Cabin S3 Master snapshot (aggregates tractor + trailer nodes)
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
              },
              right: {
                rmsMmS: n.vR,
                rmsMv: Number((n.vR / 0.045).toFixed(1)),
                tempC: n.tR,
                shtOk: true,
                fDomHz: n.fR || 0,
              },
            },
            nowMs
          );
        }
      }
      return true;
    }

    // 4. Backward compatibility: legacy v1 single-wheel packet (`type: 'techbit_node'`)
    if (pkt.type === 'techbit_node') {
      const wId = Number(pkt.wheelId ?? 0);
      const slot = slotOverride && slotOverride !== 'auto'
        ? Number(slotOverride)
        : (wId <= 1 ? 1 : 2);
      const isRight = (wId === 1 || wId === 3);
      const sideData = {
        rmsMv: Number(pkt.rmsMv ?? 0),
        rmsMmS: Number(((pkt.rmsMv ?? 0) * 0.045).toFixed(2)),
        peakMmS: Number(((pkt.peakMv ?? 0) * 0.045).toFixed(2)),
        crest: Number(pkt.crestFactor ?? 2.6),
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
        nowMs
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
    });
    if (this.blackBoxRing.length > 240) {
      this.blackBoxRing.shift();
    }
  }

  recordBurstEvent(ax, severity, wheelCode, reason, nowMs) {
    this.eventSeq += 1;
    const eventId = makeUuid(Math.floor(nowMs / 1000), ax.nodeId, this.eventSeq);
    const tsUtc = new Date(nowMs).toISOString();
    const summary = this.axles
      .filter((a) => a.online)
      .map((a) => ({
        node_id: a.nodeId,
        slot: a.key,
        temp_c: Number(Math.max(a.left.tempC ?? 0, a.right.tempC ?? 0).toFixed(1)),
        vib_rms: Number(Math.max(a.left.rmsMmS, a.right.rmsMmS).toFixed(2)),
        vib_peak: Number(Math.max(a.left.peakMmS, a.right.peakMmS).toFixed(1)),
      }));

    const sliceJson = JSON.stringify(this.blackBoxRing.slice(-16));
    const burstB64 = Buffer.from(sliceJson, 'utf-8').toString('base64');

    const packet = {
      protocol_version: 1,
      device_id: this.deviceId,
      timestamp_utc: tsUtc,
      tractor_id: this.tractorId,
      trailer_id: this.trailerId,
      packet_type: 'ANOMALY_BURST',
      event_id: eventId,
      severity,
      trigger_node_id: ax.nodeId,
      wheel_code: wheelCode,
      trigger_reason: reason,
      firmware_version: '2.0.0-mvp',
      config_version: this.config.configVersion,
      summary,
      burst_samples_base64: burstB64,
    };

    this.burstEvents.unshift(packet);
    if (this.burstEvents.length > 25) this.burstEvents.pop();

    const ticket = {
      ticket_id: `TKT-${String(this.eventSeq).padStart(3, '0')}`,
      event_id: eventId,
      created_at_utc: tsUtc,
      wheel_code: wheelCode,
      axle_label: ax.label,
      severity,
      reason,
      temp_c: Number((ax.hotSide === 'R' ? ax.right.tempC : ax.left.tempC) ?? 0),
      temp_delta_c: Number(ax.tempDeltaC.toFixed(1)),
      vib_rms: Number((ax.hotSide === 'R' ? ax.right.rmsMmS : ax.left.rmsMmS).toFixed(2)),
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

  update(nowMs = Date.now()) {
    const dtMs =
      this.lastUpdateMs === 0 || nowMs < this.lastUpdateMs
        ? 100
        : Math.min(1000, nowMs - this.lastUpdateMs);
    this.lastUpdateMs = nowMs;

    // 1. Honest timeout watchdog for all axles, bridge, and S3 Master
    let activeAxles = 0;
    let offlineAxles = 0;
    let vibSum = 0;

    for (const ax of this.axles) {
      if (ax.seenEver) {
        ax.online = nowMs - ax.lastRxMs <= this.config.nodeTimeoutMs;
      } else {
        ax.online = false;
      }

      if (ax.online) {
        activeAxles += 1;
        vibSum += 0.5 * (ax.left.rmsMmS + ax.right.rmsMmS);
      } else {
        ax.left.severity = 'OFFLINE';
        ax.right.severity = 'OFFLINE';
        if (ax.seenEver) offlineAxles += 1;
      }
    }

    if (this.bridge.seenEver) {
      this.bridge.online = nowMs - this.bridge.lastRxMs <= this.config.nodeTimeoutMs;
    }
    if (this.s3Master.seenEver) {
      this.s3Master.online = nowMs - this.s3Master.lastRxMs <= this.config.nodeTimeoutMs;
    }

    const fleetMeanVib = activeAxles > 0 ? Math.max(0.8, vibSum / activeAxles) : 1.0;

    let roughCount = 0;
    for (const ax of this.axles) {
      if (!ax.online) continue;
      if (0.5 * (ax.left.rmsMmS + ax.right.rmsMmS) >= this.config.vibWarnRmsMmS) {
        roughCount += 1;
      }
    }
    const roughRoadAllWheels = activeAxles >= 2 && roughCount >= 2;

    // 2. Evaluate rules per active axle (exact parity with C++ RuleEngine.cpp)
    let highestSev = activeAxles > 0 ? 'GREEN' : 'STANDBY';
    let highestCode = activeAxles > 0 ? 'OK' : '—';
    const yellowConfirmMs = this.config.yellowConfirmSec * 1000;
    const redConfirmMs = this.config.redConfirmSec * 1000;

    for (const ax of this.axles) {
      if (!ax.online) continue;

      const tL = ax.left.tempC ?? 25.0;
      const tR = ax.right.tempC ?? 25.0;
      const maxTemp = Math.max(tL, tR);
      const tempDelta = Math.abs(tL - tR);
      ax.tempDeltaC = tempDelta;

      const rightIsHot =
        tempDelta >= 3.0
          ? tR > tL
          : (ax.right.clip && !ax.left.clip) ||
            (!ax.left.clip && ax.right.rmsMmS > ax.left.rmsMmS);
      ax.hotSide = rightIsHot ? 'R' : 'L';
      const hotObj = rightIsHot ? ax.right : ax.left;
      const coldObj = rightIsHot ? ax.left : ax.right;

      const minSideVib = Math.max(0.6, Math.min(ax.left.rmsMmS, ax.right.rmsMmS));
      const maxSideVib = Math.max(ax.left.rmsMmS, ax.right.rmsMmS);
      const sideRatio = maxSideVib / minSideVib;
      const peerRatio = maxSideVib / fleetMeanVib;

      const transientPothole = (hotObj.crest >= 4.2 || hotObj.clip) && tempDelta < 10.0;

      const redCond =
        maxTemp >= this.config.tempCritC ||
        tempDelta >= this.config.axleTempDeltaCritC ||
        (!transientPothole &&
          !roughRoadAllWheels &&
          maxSideVib >= this.config.vibCritRmsMmS &&
          peerRatio >= this.config.vibDeltaRatioWarn);

      const yellowCond =
        redCond ||
        maxTemp >= this.config.tempWarnC ||
        tempDelta >= this.config.axleTempDeltaWarnC ||
        (!transientPothole &&
          !roughRoadAllWheels &&
          sideRatio >= this.config.vibDeltaRatioWarn &&
          maxSideVib >= this.config.vibWarnRmsMmS);

      const shadowCond =
        this.config.shadowModeEnabled &&
        !yellowCond &&
        !transientPothole &&
        !roughRoadAllWheels &&
        (sideRatio >= this.config.shadowVibRatio ||
          tempDelta >= this.config.axleTempDeltaWarnC * 0.65);

      if (redCond) {
        ax.redAccumMs = Math.min(ax.redAccumMs + dtMs, redConfirmMs + 3000);
      } else {
        ax.redAccumMs = Math.max(0, ax.redAccumMs - dtMs * 2);
        if (ax.redAccumMs === 0) ax.redLatched = false;
      }

      if (yellowCond) {
        ax.yellowAccumMs = Math.min(ax.yellowAccumMs + dtMs, yellowConfirmMs + 3000);
      } else if (transientPothole) {
        if (ax.lastReason !== 'POTHOLE_GUARD') {
          this.indicator.potholeCount += 1;
        }
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

      coldObj.severity = 'GREEN';
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

    this.indicator.driverSeverity = highestSev; // Never exposes SHADOW to driver LED
    this.indicator.wheelCode = highestCode;
    this.indicator.buzzerOn = highestSev === 'RED' && !this.s3Master.buzzerMuted;
    this.indicator.roughRoadActive = roughRoadAllWheels;
    this.indicator.activeAxles = activeAxles;
    this.indicator.activeWheels = activeAxles * 2;
    this.indicator.offlineAxles = offlineAxles;
  }

  exportGroundTruthCsv() {
    const header =
      'ticket_id,event_id,created_at_utc,wheel_code,severity,reason,temp_c,temp_delta_c,vib_rms,status,ground_truth_label';
    const lines = this.incidents.map(
      (i) =>
        `${i.ticket_id},${i.event_id},${i.created_at_utc},${i.wheel_code},${i.severity},${i.reason},${i.temp_c},${i.temp_delta_c},${i.vib_rms},${i.status},${i.resolution_code || 'UNLABELED'}`
    );
    return [header, ...lines].join('\n');
  }

  getSnapshot(nowMs = Date.now()) {
    return {
      tsUtc: new Date(nowMs).toISOString(),
      tractorId: this.tractorId,
      trailerId: this.trailerId,
      deviceId: this.deviceId,
      config: { ...this.config },
      indicator: { ...this.indicator },
      bridge: { ...this.bridge },
      s3Master: {
        ...this.s3Master,
        blackBoxRecs: Math.max(this.s3Master.blackBoxRecs, this.blackBoxRing.length),
      },
      axles: this.axles,
      burstEvents: this.burstEvents.slice(0, 8),
      incidents: this.incidents.slice(0, 15),
    };
  }
}

module.exports = {
  AXLE_SLOTS,
  DEFAULT_CONFIG,
  TechBitV2Engine,
};
