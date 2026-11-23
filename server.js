'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { RIG_PROFILES, TechBitV2Engine } = require('./v2_engine');

const DIST_DIR = path.join(__dirname, 'dist');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SIM_SCENARIOS = [
  'smooth',
  'cobblestone',
  'pothole_clip',
  'brake_drag',
  'bearing_wear',
  'shadow_early',
  'link_loss',
  'sensor_fault',
  'brake_drag_p2l',
  'bearing_t2r',
  'bridge_loss',
  'sht40_vref_fault',
];

function normalizeScenario(s) {
  if (s === 'brake_drag_p2l') return 'brake_drag';
  if (s === 'bearing_t2r') return 'bearing_wear';
  if (s === 'bridge_loss') return 'link_loss';
  if (s === 'sht40_vref_fault') return 'sensor_fault';
  return SIM_SCENARIOS.includes(s) ? s : 'smooth';
}

function isPrivateLanIpv4(ip) {
  if (/^192\.168\./.test(ip) || /^10\./.test(ip)) return true;
  const m = ip.match(/^172\.(\d+)\./);
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

function getLanUrls(port) {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const info of nets[name] || []) {
      if (info.family === 'IPv4' && !info.internal) ips.push(info.address);
    }
  }
  ips.sort((a, b) => Number(isPrivateLanIpv4(b)) - Number(isPrivateLanIpv4(a)));
  return ips.map((ip) => `http://${ip}:${port}/api/telemetry`);
}

function buildSimSpectrum(rmsMv, domFreqHz, isRough, phase) {
  const bins = new Array(32).fill(0);
  for (let b = 0; b < 32; b++) {
    const fCenter = b * 140 + 70;
    const dist = Math.abs(fCenter - domFreqHz);
    const peak = dist < 170 ? (1 - dist / 180) * 1.45 : 0;
    const lowFloor = fCenter < 600 ? (isRough ? 0.55 : 0.25) : 0.08;
    const ripple = 0.86 + 0.14 * Math.sin(phase + b * 0.7);
    bins[b] = Number((rmsMv * (lowFloor + peak) * ripple).toFixed(1));
  }
  return bins;
}

function generateV2SimPackets(rawScenario, elapsedMs, tickIdx, rigProfile = 'mvp_front', config = {}) {
  const scenario = normalizeScenario(rawScenario);
  const profile = RIG_PROFILES[rigProfile] || RIG_PROFILES.mvp_front;
  const slots = profile.slots;
  const isMvpFront = profile.id === 'mvp_front';
  const isFull10 = profile.id === 'full_10';
  const phase = tickIdx * 0.32;
  const packets = [];
  const nodeIds = ['C3_T1_FRONT', 'C3_T2_REAR', 'C3_P1_TRL', 'C3_P2_TRL', 'C3_P3_TRL'];

  const s3Cfg = config.moduleSensors?.s3Master || { mode: 's3_can_lte_led', link: 'can_500k' };
  const flCfg = config.moduleSensors?.frontLeft || { vib: config.vibSensorType || 'piezo_mcp6002', temp: config.tempSensorType || 'sht40' };
  const frCfg = config.moduleSensors?.frontRight || { vib: config.vibSensorType || 'piezo_mcp6002', temp: config.tempSensorType || 'sht40' };

  if (profile.hasBridge && scenario !== 'link_loss') {
    packets.push({
      type: 'techbit_trailer_bridge',
      mcu: 'SIM_ESP32-C3',
      trailerId: 'TL_042',
      paired: true,
      rssi: Math.round(-54 + Math.sin(phase) * 3),
      seq: tickIdx,
      nodeCount: 3,
      canRx: tickIdx * 6,
    });
  }

  packets.push({
    type: 'techbit_s3_master',
    mcu: 'SIM_ESP32-S3',
    deviceId: isMvpFront ? 'S3_MASTER_MVP' : 'S3_A1B2C3',
    tractorId: 'TR_001',
    trailerId: profile.hasBridge ? 'TL_042' : '—',
    bleActive: s3Cfg.mode === 's3_ble_bridge',
    lteOnline: s3Cfg.mode !== 's3_usb_bench',
    pendingQueue: 0,
  });

  const brakeSlot = isFull10 ? 4 : 1;
  const brakeRight = !isFull10;
  const bearingSlot = isMvpFront ? 1 : 2;
  const bearingRight = !isMvpFront;
  const potholeSlot = isFull10 ? 4 : 1;
  const shadowSlot = isFull10 ? 3 : 1;
  const shadowRight = !isFull10;
  const shtFaultSlot = isFull10 ? 4 : 1;

  for (const slot of slots) {
    if (scenario === 'link_loss') {
      if (isFull10 && slot >= 3) continue;
      if (!isFull10 && slot === 1 && elapsedMs > 1200) continue;
    }

    const leftTempType = slot === 1 ? flCfg.temp : (config.tempSensorType || 'sht40');
    const rightTempType = slot === 1 ? frCfg.temp : (config.tempSensorType || 'sht40');

    const jL = 0.95 + 0.07 * Math.sin(phase + slot * 1.1);
    const jR = 0.95 + 0.07 * Math.cos(phase + slot * 1.4);

    let vL = 1.15 * jL;
    let vR = 1.18 * jR;
    let pL = vL * 2.6;
    let pR = vR * 2.6;
    let cL = 2.65;
    let cR = 2.62;
    let tL = 33.2 + slot * 0.5;
    let tR = 33.5 + slot * 0.5;
    let rhL = 42.0 + slot;
    let rhR = 42.5 + slot;
    let shtOkL = leftTempType !== 'ntc';
    let shtOkR = rightTempType !== 'ntc';
    let vrefL = 1650 + Math.sin(phase + slot) * 7;
    let vrefR = 1648 + Math.cos(phase + slot) * 7;
    let fL = 240 + slot * 10;
    let fR = 245 + slot * 10;
    let clipL = false;
    let clipR = false;
    let rough = false;

    if (scenario === 'cobblestone') {
      rough = true;
      vL = (4.6 + slot * 0.12) * jL;
      vR = (4.7 + slot * 0.11) * jR;
      pL = vL * 3.1;
      pR = vR * 3.1;
      cL = 3.15;
      cR = 3.12;
      fL = 285;
      fR = 290;
    } else if (scenario === 'pothole_clip') {
      const cyc = elapsedMs % 5000;
      if (slot === potholeSlot && cyc >= 700 && cyc < 1100) {
        vL = 5.9;
        pL = 24.5;
        cL = 6.2;
        clipL = true;
        fL = 410;
      }
    } else if (scenario === 'brake_drag') {
      if (slot === brakeSlot) {
        const ramp = Math.min(1.0, elapsedMs / 9000);
        if (brakeRight) {
          tR = 58.0 + ramp * 44.0;
          vR = (3.9 + ramp * 2.6) * jR;
          pR = vR * 2.9;
          fR = 3420;
        } else {
          tL = 58.0 + ramp * 44.0;
          vL = (3.9 + ramp * 2.6) * jL;
          pL = vL * 2.9;
          fL = 3420;
        }
      }
    } else if (scenario === 'bearing_wear') {
      if (slot === bearingSlot) {
        if (bearingRight) {
          tR = 62.5;
          vR = 4.65 * jR;
          pR = vR * 2.85;
          fR = 1480;
        } else {
          tL = 62.5;
          vL = 4.65 * jL;
          pL = vL * 2.85;
          fL = 1480;
        }
      }
    } else if (scenario === 'shadow_early') {
      if (slot === shadowSlot) {
        if (shadowRight) {
          tR = 46.5;
          vR = 2.25 * jR;
          fR = 960;
        } else {
          tL = 46.5;
          vL = 2.25 * jL;
          fL = 960;
        }
      }
    } else if (scenario === 'sensor_fault') {
      if (slot === 1) {
        vrefL = 780.0;
      }
      if (slot === shtFaultSlot) {
        shtOkL = false;
        rhR = 92.4;
      }
    }

    const mvL = Number((vL / 0.045).toFixed(1));
    const mvR = Number((vR / 0.045).toFixed(1));

    packets.push({
      type: 'techbit_c3_node',
      mcu: 'SIM_ESP32-C3',
      nodeId: nodeIds[slot - 1],
      slot,
      fromTrailer: slot >= 3,
      tsMs: elapsedMs,
      left: {
        rmsMv: mvL,
        rmsMmS: Number(vL.toFixed(2)),
        peakMmS: Number(pL.toFixed(2)),
        crest: Number(cL.toFixed(2)),
        dcOffsetMv: Number(vrefL.toFixed(1)),
        fDomHz: Math.round(fL),
        clip: clipL,
        tempC: Number(tL.toFixed(1)),
        rh: leftTempType === 'ntc' ? null : Number(rhL.toFixed(1)),
        shtOk: shtOkL,
        spectrum: buildSimSpectrum(mvL, fL, rough, phase + slot),
      },
      right: {
        rmsMv: mvR,
        rmsMmS: Number(vR.toFixed(2)),
        peakMmS: Number(pR.toFixed(2)),
        crest: Number(cR.toFixed(2)),
        dcOffsetMv: Number(vrefR.toFixed(1)),
        fDomHz: Math.round(fR),
        clip: clipR,
        tempC: Number(tR.toFixed(1)),
        rh: rightTempType === 'ntc' ? null : Number(rhR.toFixed(1)),
        shtOk: shtOkR,
        spectrum: buildSimSpectrum(mvR, fR, rough, phase + slot + 2),
      },
      i2c: {
        sda: 8,
        scl: 9,
        addr: leftTempType === 'ntc' && rightTempType === 'ntc' ? 'NTC' : shtOkL ? '0x44' : 'ERR',
        err: leftTempType === 'ntc' && rightTempType === 'ntc' ? 0 : shtOkL ? 0 : 2,
      },
      can: { ready: true, tx: tickIdx * 2, err: 0 },
    });
  }

  return packets;
}

function readJsonBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function createServer(options = {}) {
  const engine = new TechBitV2Engine(options.engineConfig || {});
  const sseClients = new Set();
  const pendingEspCommands = [];
  const rawLogs = [];

  const sourceMeta = {
    mode: 'waiting',
    lastPacketAt: null,
    packetCount: 0,
    packetsWindow: 0,
    packetsPerSec: 0,
    senderIp: null,
    simScenario: 'smooth',
    simStartedAt: null,
    simTick: 0,
    espPollUrl: null,
    espPollError: null,
  };

  function addLog(tag, text) {
    rawLogs.push({
      ts: new Date().toISOString(),
      tag,
      text: String(text).slice(0, 320),
    });
    if (rawLogs.length > 80) rawLogs.shift();
  }

  function queueEspCommand(cmd) {
    const clean = String(cmd || '').trim();
    if (!clean) return;
    pendingEspCommands.push({ cmd: clean, createdAt: Date.now() });
    if (pendingEspCommands.length > 16) pendingEspCommands.shift();
    addLog('CMD->ESP', clean);
  }

  function popEspCommands() {
    const now = Date.now();
    const out = [];
    while (pendingEspCommands.length > 0) {
      const item = pendingEspCommands.shift();
      if (now - item.createdAt <= 12000) out.push(item.cmd);
    }
    return out;
  }

  function ingestTelemetryObject(obj, sourceKind, senderLabel = null, slotOverride = null) {
    const now = Date.now();
    if (sourceKind !== 'simulator' && sourceMeta.mode === 'simulator') {
      sourceMeta.mode = sourceKind;
      sourceMeta.simStartedAt = null;
      addLog('SYSTEM', `Живий пакет (${sourceKind}) автоматично вимкнув симулятор.`);
    } else if (sourceKind !== 'simulator' || sourceMeta.mode === 'simulator') {
      sourceMeta.mode = sourceKind;
    }

    const ok = engine.ingestPacket(obj, now, slotOverride);
    if (ok) {
      sourceMeta.lastPacketAt = now;
      sourceMeta.packetCount += 1;
      sourceMeta.packetsWindow += 1;
      if (senderLabel) sourceMeta.senderIp = senderLabel;
    }
    return ok;
  }

  function buildStatePayload(port) {
    const now = Date.now();
    const snap = engine.getSnapshot(now);
    const activePort = port || 5050;
    return {
      ...snap,
      source: {
        ...sourceMeta,
        wifiUrls: getLanUrls(activePort),
      },
      logs: rawLogs.slice(-40),
    };
  }

  function broadcastState(port) {
    if (sseClients.size === 0) return;
    const msg = `data: ${JSON.stringify(buildStatePayload(port))}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(msg);
      } catch (_) {
        sseClients.delete(client);
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const boundPort = server.address()?.port || 5050;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      sseClients.add(res);
      res.write(`data: ${JSON.stringify(buildStatePayload(boundPort))}\n\n`);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      return sendJson(res, 200, buildStatePayload(boundPort));
    }

    if (req.method === 'GET' && pathname === '/api/export.csv') {
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="techbit_v2_ground_truth.csv"',
      });
      res.end(engine.exportGroundTruthCsv());
      return;
    }

    if (req.method === 'POST' && pathname === '/api/telemetry') {
      try {
        const body = await readJsonBody(req);
        const source = body._source === 'serial' ? 'serial' : 'wifi';
        const slotOverride = body._slotOverride || null;
        const ok = ingestTelemetryObject(body, source, req.socket.remoteAddress, slotOverride);
        engine.update(Date.now());
        broadcastState(boundPort);
        return sendJson(res, ok ? 200 : 400, {
          ok,
          commands: popEspCommands(),
        });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    if (req.method === 'POST' && pathname === '/api/command') {
      try {
        const body = await readJsonBody(req);
        const { action } = body;

        if (action === 'reset') {
          engine.resetAlerts();
          addLog('CMD', 'Скинуто зафіксовані тривоги й лічильник ям.');
        } else if (action === 'clear') {
          engine.reset();
          sourceMeta.mode = 'waiting';
          sourceMeta.packetCount = 0;
          sourceMeta.simStartedAt = null;
          addLog('CMD', 'Стан стенду очищено.');
        } else if (action === 'mute') {
          const muted = engine.toggleMute();
          addLog('CMD', `Зумер кабіни: ${muted ? 'ВИМКНЕНО (MUTE)' : 'УВІМКНЕНО'}`);
        } else if (action === 'config' && body.config) {
          const prevProfile = engine.config.rigProfile;
          engine.updateConfig(body.config);
          if (body.config.rigProfile && body.config.rigProfile !== prevProfile) {
            engine.resetAlerts();
            addLog('PROFILE', `Профіль стенду: ${engine.getProfileMeta().shortLabel}`);
          } else {
            const ms = engine.config.moduleSensors;
            addLog(
              'CFG',
              `Оновлено v${engine.config.configVersion} · L:${ms.frontLeft.vib}/${ms.frontLeft.temp} · R:${ms.frontRight.vib}/${ms.frontRight.temp} · S3:${ms.s3Master.mode}`
            );
          }
        } else if (action === 'resolve_ticket') {
          const tkt = engine.resolveIncident(body.ticketId, body.resolutionCode);
          if (tkt) addLog('TICKET', `${tkt.ticket_id} закрито -> ${tkt.resolution_code}`);
        } else if (action === 'simulator') {
          if (body.enabled) {
            sourceMeta.mode = 'simulator';
            sourceMeta.simScenario = normalizeScenario(body.scenario);
            sourceMeta.simStartedAt = Date.now();
            sourceMeta.simTick = 0;
            if (engine.config.yellowConfirmSec === 60) {
              engine.updateConfig({ yellowConfirmSec: 6 });
            }
            addLog(
              'SIM',
              `Симулятор [${engine.getProfileMeta().shortLabel}]: ${sourceMeta.simScenario}`
            );
          } else {
            sourceMeta.mode = 'waiting';
            sourceMeta.simStartedAt = null;
            addLog('SIM', 'Симулятор зупинено.');
          }
        } else if (action === 'ip_poll') {
          if (body.url) {
            const cleanUrl = String(body.url).trim();
            sourceMeta.espPollUrl = cleanUrl.startsWith('http')
              ? cleanUrl
              : `http://${cleanUrl}/api/telemetry`;
            sourceMeta.mode = 'ip_poll';
            sourceMeta.espPollError = null;
            addLog('POLL', `Опитування ${sourceMeta.espPollUrl}`);
          } else {
            sourceMeta.espPollUrl = null;
            sourceMeta.mode = 'waiting';
          }
        } else if (action === 'raw' && body.cmd) {
          queueEspCommand(body.cmd);
        }

        engine.update(Date.now());
        broadcastState(boundPort);
        return sendJson(res, 200, { ok: true, state: buildStatePayload(boundPort) });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    // Static assets & React Router SPA fallback from dist/
    const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const safePath = path.normalize(path.join(DIST_DIR, relPath));
    if (safePath.startsWith(DIST_DIR) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(safePath).pipe(res);
      return;
    }

    // SPA client-side route fallback (/blackbox, /cli, etc.)
    const indexHtml = path.join(DIST_DIR, 'index.html');
    if (!pathname.startsWith('/api/') && !path.extname(pathname) && fs.existsSync(indexHtml)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexHtml).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      fs.existsSync(indexHtml)
        ? 'Not found'
        : 'Frontend bundle missing. Run: npm run build'
    );
  });

  let ppsTimer = null;
  let tickTimer = null;
  let pollInFlight = false;

  if (!options.disableTimers) {
    ppsTimer = setInterval(() => {
      sourceMeta.packetsPerSec = sourceMeta.packetsWindow;
      sourceMeta.packetsWindow = 0;
    }, 1000);

    tickTimer = setInterval(async () => {
      const now = Date.now();
      const boundPort = server.address()?.port || 5050;

      if (sourceMeta.mode === 'simulator') {
        const elapsed = now - (sourceMeta.simStartedAt || now);
        sourceMeta.simTick += 1;
        const simPkts = generateV2SimPackets(
          sourceMeta.simScenario,
          elapsed,
          sourceMeta.simTick,
          engine.config.rigProfile,
          engine.config
        );
        for (const p of simPkts) {
          ingestTelemetryObject(p, 'simulator', 'SIMULATOR');
        }
      } else if (sourceMeta.mode === 'ip_poll' && sourceMeta.espPollUrl && !pollInFlight) {
        pollInFlight = true;
        try {
          const resp = await fetch(sourceMeta.espPollUrl, { signal: AbortSignal.timeout(350) });
          if (resp.ok) {
            const json = await resp.json();
            if (json && json.status !== 'waiting') {
              ingestTelemetryObject(json, 'ip_poll', sourceMeta.espPollUrl);
              sourceMeta.espPollError = null;
            }
          } else {
            sourceMeta.espPollError = `HTTP ${resp.status}`;
          }
        } catch (err) {
          sourceMeta.espPollError = err.message;
        } finally {
          pollInFlight = false;
        }
      }

      engine.update(now);
      broadcastState(boundPort);
    }, 200);
  }

  server.on('close', () => {
    if (ppsTimer) clearInterval(ppsTimer);
    if (tickTimer) clearInterval(tickTimer);
    for (const c of sseClients) c.end();
    sseClients.clear();
  });

  return { server, engine, sourceMeta, ingestTelemetryObject };
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 5050;
  const { server } = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n[TechBIT v2.2 React SPA Workbench] http://localhost:${PORT}`);
    const urls = getLanUrls(PORT);
    if (urls.length > 0) {
      console.log(`[TechBIT Wi-Fi Telemetry Endpoint] ${urls.join(' | ')}`);
    }
  });
}

module.exports = { createServer, generateV2SimPackets };
