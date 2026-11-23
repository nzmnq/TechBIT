'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { TechBitV2Engine } = require('./v2_engine');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SIM_SCENARIOS = [
  'smooth',
  'cobblestone',
  'pothole_clip',
  'brake_drag_p2l',
  'bearing_t2r',
  'shadow_early',
  'bridge_loss',
  'sht40_vref_fault',
];

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
    const fCenter = b * 140 + 70; // 0..4480 Hz
    const dist = Math.abs(fCenter - domFreqHz);
    const peak = dist < 170 ? (1 - dist / 180) * 1.45 : 0;
    const lowFloor = fCenter < 600 ? (isRough ? 0.55 : 0.25) : 0.08;
    const ripple = 0.86 + 0.14 * Math.sin(phase + b * 0.7);
    bins[b] = Number((rmsMv * (lowFloor + peak) * ripple).toFixed(1));
  }
  return bins;
}

function generateV2SimPackets(scenario, elapsedMs, tickIdx) {
  const phase = tickIdx * 0.32;
  const packets = [];
  const nodeIds = ['C3_110011', 'C3_110012', 'C3_998876', 'C3_998877', 'C3_998878'];

  // Trailer Bridge status (dropped during bridge_loss)
  if (scenario !== 'bridge_loss') {
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

  // S3 Master telemetry meta
  packets.push({
    type: 'techbit_s3_master',
    mcu: 'SIM_ESP32-S3',
    deviceId: 'S3_A1B2C3',
    tractorId: 'TR_001',
    trailerId: 'TL_042',
    bleActive: false,
    lteOnline: true,
    pendingQueue: 0,
  });

  // Generate 5 unified C3 Axle Nodes (Tractor T1..T2, Trailer P1..P3 = 10 wheels)
  for (let slot = 1; slot <= 5; slot++) {
    if (scenario === 'bridge_loss' && slot >= 3) continue; // Trailer ESP-NOW lost

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
    let shtOkL = true;
    let shtOkR = true;
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
      if (slot === 4 && cyc >= 700 && cyc < 1100) {
        vL = 5.9;
        pL = 24.5;
        cL = 6.2;
        clipL = true;
        fL = 410;
      }
    } else if (scenario === 'brake_drag_p2l') {
      if (slot === 4) {
        // Trailer Axle 2 Left (P2-L) sticking brake caliper
        const ramp = Math.min(1.0, elapsedMs / 9000);
        tL = 58.0 + ramp * 44.0; // Ramps from 58°C (YELLOW ΔT) to 102°C (RED!)
        vL = (3.9 + ramp * 2.6) * jL;
        pL = vL * 2.9;
        fL = 3420;
      }
    } else if (scenario === 'bearing_t2r') {
      if (slot === 2) {
        // Tractor Rear Axle Right (T2-R) hub bearing wear
        tR = 62.5;
        vR = 4.65 * jR;
        pR = vR * 2.85;
        fR = 1480;
      }
    } else if (scenario === 'shadow_early') {
      if (slot === 3) {
        // Subtle drift below YELLOW threshold -> silently captured in SHADOW mode!
        tL = 46.5;
        vL = 2.25 * jL;
        fL = 960;
      }
    } else if (scenario === 'sht40_vref_fault') {
      if (slot === 1) {
        vrefL = 780.0; // Broken Vref divider on MCP6002
      }
      if (slot === 4) {
        shtOkL = false;
        rhR = 92.4; // Condensation inside enclosure
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
        rh: Number(rhL.toFixed(1)),
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
        rh: Number(rhR.toFixed(1)),
        shtOk: shtOkR,
        spectrum: buildSimSpectrum(mvR, fR, rough, phase + slot + 2),
      },
      i2c: { sda: 8, scl: 9, addr: shtOkL ? '0x44' : 'ERR', err: shtOkL ? 0 : 2 },
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
      } catch (err) {
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
    mode: 'waiting', // 'waiting' | 'wifi' | 'serial' | 'ip_poll' | 'simulator'
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
    if (rawLogs.length > 50) rawLogs.shift();
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
    // Live hardware automatically supersedes simulator (Truthfulness guarantee)
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
      logs: rawLogs.slice(-25),
    };
  }

  function broadcastState(port) {
    if (sseClients.size === 0) return;
    const msg = `data: ${JSON.stringify(buildStatePayload(port))}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(msg);
      } catch (err) {
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

    // SSE real-time stream
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

    // Telemetry ingest (Wi-Fi push from ESP32 or Web Serial relay from Browser)
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

    // Workbench commands (reset, mute, simulator, ip_poll, config, resolve_ticket, raw)
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
          engine.updateConfig(body.config);
          addLog('CFG', `Оновлено пороги v${engine.config.configVersion}`);
        } else if (action === 'resolve_ticket') {
          const tkt = engine.resolveIncident(body.ticketId, body.resolutionCode);
          if (tkt) addLog('TICKET', `${tkt.ticket_id} закрито -> ${tkt.resolution_code}`);
        } else if (action === 'simulator') {
          if (body.enabled) {
            sourceMeta.mode = 'simulator';
            sourceMeta.simScenario = SIM_SCENARIOS.includes(body.scenario) ? body.scenario : 'smooth';
            sourceMeta.simStartedAt = Date.now();
            sourceMeta.simTick = 0;
            // Fast 6-second YELLOW confirm during bench simulator unless explicitly overridden
            if (engine.config.yellowConfirmSec === 60) {
              engine.updateConfig({ yellowConfirmSec: 6 });
            }
            addLog('SIM', `Симулятор запущено: ${sourceMeta.simScenario} (YELLOW гістерезис 6 с для тесту)`);
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

    // Static files from public/
    const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const safePath = path.normalize(path.join(PUBLIC_DIR, relPath));
    if (safePath.startsWith(PUBLIC_DIR) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(safePath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  // Periodic background timers
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
        const simPkts = generateV2SimPackets(sourceMeta.simScenario, elapsed, sourceMeta.simTick);
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
    console.log(`\n[TechBIT v2 Test Workbench] http://localhost:${PORT}`);
    const urls = getLanUrls(PORT);
    if (urls.length > 0) {
      console.log(`[TechBIT Wi-Fi Telemetry Endpoint] ${urls.join(' | ')}`);
    }
  });
}

module.exports = { createServer, generateV2SimPackets };
