'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WheelClassifierEngine } = require('./classifier_engine');

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
  'axle_transition',
  'pothole_clip',
  'brake_drag_heat',
  'bearing_wear',
  'dead_piezo',
  'vref_fault',
];

function isPrivateLanIpv4(ip) {
  if (/^192\.168\./.test(ip) || /^10\./.test(ip)) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m) {
    const second = Number(m[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function getLanUrls(port) {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const info of nets[name] || []) {
      if (info.family === 'IPv4' && !info.internal) {
        ips.push(info.address);
      }
    }
  }
  ips.sort((a, b) => Number(isPrivateLanIpv4(b)) - Number(isPrivateLanIpv4(a)));
  return ips.map((ip) => `http://${ip}:${port}/api/telemetry`);
}

function buildSimulatedSpectrum(bandLow, bandMid, bandHigh, rmsMv, domFreqHz, seedPhase) {
  const bins = new Array(32).fill(0);
  for (let b = 0; b < 32; b++) {
    const fCenter = b * 250 + 125;
    let weight = 0.08;
    if (fCenter < 600) weight = bandLow;
    else if (fCenter < 2500) weight = bandMid * 0.6;
    else weight = bandHigh * 0.35;

    const distHz = Math.abs(fCenter - domFreqHz);
    const peakBoost = distHz < 260 ? (1.0 - distHz / 280) * 1.4 : 0;
    const ripple = 0.85 + 0.15 * Math.sin(seedPhase + b * 0.9);
    bins[b] = Number((rmsMv * (weight * 0.42 + peakBoost * 0.55) * ripple).toFixed(1));
  }
  return bins;
}

function generateSimulatorPackets(scenario, elapsedMs, tickIdx) {
  const phase = tickIdx * 0.35;
  const packets = [];

  for (let w = 0; w < 4; w++) {
    const jitter = 0.96 + 0.06 * Math.sin(phase + w * 1.3);
    let rms = 27.5 * jitter;
    let peak = rms * 2.65;
    let bL = 0.56;
    let bM = 0.31;
    let bH = 0.13;
    let fDom = 240 + w * 12;
    let fCent = 740;
    let ton = 2.7;
    let kurt = 3.0;
    let clip = false;
    let dcOffsetMv = 1650 + Math.sin(phase + w) * 8;
    let tempC = 32.0 + w * 0.7;
    let humidityPct = 41.0 + w * 1.1;
    const sht40Ok = true;

    if (scenario === 'cobblestone') {
      rms = (165 + w * 11) * jitter;
      peak = rms * 3.25;
      bL = 0.63;
      bM = 0.27;
      bH = 0.10;
      fDom = 285;
      fCent = 790;
      ton = 3.1;
      kurt = 3.6;
    } else if (scenario === 'axle_transition') {
      if (w === 0 || w === 1) {
        rms = 178 * jitter;
        peak = rms * 3.15;
        bL = 0.61;
        bM = 0.29;
        bH = 0.10;
        fDom = 275;
        fCent = 780;
        ton = 3.1;
        kurt = 3.5;
      }
    } else if (scenario === 'pothole_clip') {
      const cycle = elapsedMs % 4500;
      if (w === 0 && cycle >= 600 && cycle < 850) {
        rms = 215;
        peak = 890;
        bL = 0.49;
        bM = 0.36;
        bH = 0.15;
        fDom = 415;
        fCent = 1180;
        ton = 3.4;
        kurt = 7.4;
        clip = true;
      } else if (w === 2 && cycle >= 850 && cycle < 1100) {
        rms = 185;
        peak = 720;
        bL = 0.46;
        bM = 0.37;
        bH = 0.17;
        fDom = 440;
        fCent = 1220;
        ton = 3.5;
        kurt = 5.6;
      }
    } else if (scenario === 'brake_drag_heat') {
      if (w === 1) {
        rms = 158 * jitter;
        peak = rms * 2.85;
        bL = 0.09;
        bM = 0.25;
        bH = 0.66;
        fDom = 3450;
        fCent = 4150;
        ton = 8.9;
        kurt = 3.3;
        tempC = 78.4;
      }
    } else if (scenario === 'bearing_wear') {
      if (w === 3) {
        rms = 142 * jitter;
        peak = rms * 2.80;
        bL = 0.13;
        bM = 0.61;
        bH = 0.26;
        fDom = 1480;
        fCent = 1890;
        ton = 9.1;
        kurt = 3.5;
        tempC = 54.2;
      }
    } else if (scenario === 'dead_piezo') {
      rms = w === 2 ? 0.6 : 46.0 * jitter;
      peak = w === 2 ? 1.5 : rms * 2.6;
      if (w === 2) {
        fDom = 0;
        fCent = 0;
        ton = 1.0;
      }
    } else if (scenario === 'vref_fault') {
      if (w === 0) {
        dcOffsetMv = 740.0;
        rms = 112.0;
        peak = 310.0;
      }
      if (w === 2) {
        humidityPct = 91.5;
      }
    }

    packets.push({
      type: 'techbit_node',
      mcu: 'SIM_ESP32-C3',
      wheelId: w,
      tsMs: elapsedMs,
      rmsMv: Number(rms.toFixed(2)),
      peakMv: Number(peak.toFixed(2)),
      dcOffsetMv: Number(dcOffsetMv.toFixed(1)),
      crestFactor: Number((rms > 0.5 ? peak / rms : 1.0).toFixed(2)),
      kurtosis: Number(kurt.toFixed(2)),
      bandLowRatio: bL,
      bandMidRatio: bM,
      bandHighRatio: bH,
      dominantFreqHz: Math.round(fDom),
      spectralCentroidHz: Math.round(fCent),
      tonalityRatio: Number(ton.toFixed(2)),
      zeroCrossingsHz: Math.round(fDom),
      surgeClipping: clip,
      tempC: Number(tempC.toFixed(2)),
      humidityPct: Number(humidityPct.toFixed(1)),
      sht40Ok,
      canReady: true,
      canTx: tickIdx * 2,
      canRx: 1,
      canErr: 0,
      canBusOff: 0,
      adcDropped: 0,
      spectrum: buildSimulatedSpectrum(bL, bM, bH, rms, fDom, phase + w),
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
      if (!raw) {
        resolve({});
        return;
      }
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
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function createServer(options = {}) {
  const engine = new WheelClassifierEngine(options.engineConfig || {});
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
    if (rawLogs.length > 40) rawLogs.shift();
  }

  function queueEspCommand(cmd) {
    const clean = String(cmd || '').trim();
    if (!clean) return;
    pendingEspCommands.push({ cmd: clean, createdAt: Date.now() });
    if (pendingEspCommands.length > 16) pendingEspCommands.shift();
    addLog('CMD->ESP', clean);

    if (sourceMeta.mode === 'ip_poll' && sourceMeta.espPollUrl) {
      const base = sourceMeta.espPollUrl.replace(/\/api\/telemetry.*$/, '');
      fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: clean }),
        signal: AbortSignal.timeout(400),
      }).catch(() => {});
    }
  }

  function popEspCommands() {
    const now = Date.now();
    const out = [];
    while (pendingEspCommands.length > 0) {
      const item = pendingEspCommands.shift();
      if (now - item.createdAt <= 12000) {
        out.push(item.cmd);
      }
    }
    return out;
  }

  function buildStatePayload(port) {
    const now = Date.now();
    const snap = engine.getSnapshot(now);
    const activePort = port || 5050;
    return {
      ...snap,
      sourceMeta: {
        ...sourceMeta,
        lastPacketAgeMs: sourceMeta.lastPacketAt ? Math.max(0, now - sourceMeta.lastPacketAt) : null,
      },
      networkUrls: getLanUrls(activePort),
      recentLogs: rawLogs.slice(-15),
    };
  }

  let lastBroadcastAt = 0;
  function broadcastState(port, force = false) {
    if (sseClients.size === 0) return;
    const now = Date.now();
    if (!force && now - lastBroadcastAt < 65) return;
    lastBroadcastAt = now;
    const payload = `data: ${JSON.stringify(buildStatePayload(port))}\n\n`;
    for (const client of sseClients) {
      client.write(payload);
    }
  }

  function ingestTelemetryObject(obj, sourceKind, senderIp) {
    const now = Date.now();
    let ok = false;
    if (obj && obj.type === 'techbit_hub' && Array.isArray(obj.wheels)) {
      ok = engine.ingestHubPacket(obj, now);
    } else if (obj && (obj.wheelId !== undefined || obj.rmsMv !== undefined)) {
      ok = engine.ingestNodePacket(obj, now);
    }

    if (!ok) return false;

    // Auto-stop simulator immediately if physical hardware sends data
    if (sourceKind !== 'simulator' && sourceMeta.mode === 'simulator') {
      sourceMeta.simStartedAt = null;
      addLog('SYSTEM', 'Симулятор автоматично вимкнено: отримано реальний пакет ESP32-C3');
    }

    sourceMeta.mode = sourceKind;
    sourceMeta.lastPacketAt = now;
    sourceMeta.packetCount += 1;
    sourceMeta.packetsWindow += 1;
    if (senderIp) sourceMeta.senderIp = senderIp;
    engine.update(now);
    return true;
  }

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    const boundPort = server.address() ? server.address().port : 5050;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      engine.update(Date.now());
      sendJson(res, 200, buildStatePayload(boundPort));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(`data: ${JSON.stringify(buildStatePayload(boundPort))}\n\n`);
      sseClients.add(res);
      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/telemetry') {
      try {
        const body = await readJsonBody(req);
        const senderIp = req.socket.remoteAddress || null;
        let sourceKind = 'wifi';
        let payload = body;
        if (body && body.payload && typeof body.payload === 'object') {
          sourceKind = body.source === 'serial' ? 'serial' : 'wifi';
          payload = body.payload;
        }

        const ok = ingestTelemetryObject(payload, sourceKind, senderIp);
        if (!ok) {
          sendJson(res, 400, { ok: false, error: 'Unsupported or incomplete telemetry JSON' });
          return;
        }
        broadcastState(boundPort);
        sendJson(res, 200, { ok: true, commands: popEspCommands() });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/command') {
      try {
        const body = await readJsonBody(req);
        const action = String(body.action || '');
        const now = Date.now();

        if (action === 'cal') {
          engine.startCalibration(now);
          queueEspCommand('cal');
        } else if (action === 'reset') {
          engine.resetFaultLatches();
          queueEspCommand('reset');
        } else if (action === 'mute') {
          engine.toggleBuzzerMute();
          queueEspCommand('mute');
        } else if (action === 'clear') {
          engine.resetAll();
          pendingEspCommands.length = 0;
          rawLogs.length = 0;
          sourceMeta.mode = 'waiting';
          sourceMeta.lastPacketAt = null;
          sourceMeta.packetCount = 0;
          sourceMeta.packetsPerSec = 0;
          sourceMeta.senderIp = null;
          sourceMeta.espPollUrl = null;
          sourceMeta.espPollError = null;
          addLog('SYSTEM', 'Буфери та стани очищено — очікування ESP32-C3');
        } else if (action === 'simulator') {
          const enabled = Boolean(body.enabled);
          if (enabled) {
            const scenario = SIM_SCENARIOS.includes(body.scenario) ? body.scenario : 'smooth';
            engine.resetAll();
            sourceMeta.mode = 'simulator';
            sourceMeta.simScenario = scenario;
            sourceMeta.simStartedAt = now;
            sourceMeta.simTick = 0;
            sourceMeta.espPollUrl = null;
            addLog('SIM', `Запущено стендовий симулятор: ${scenario}`);
          } else {
            engine.resetAll();
            sourceMeta.mode = 'waiting';
            sourceMeta.simStartedAt = null;
            sourceMeta.lastPacketAt = null;
            addLog('SIM', 'Симулятор зупинено');
          }
        } else if (action === 'esp_command') {
          queueEspCommand(body.rawCmd);
        } else {
          sendJson(res, 400, { ok: false, error: `Unknown action: ${action}` });
          return;
        }

        broadcastState(boundPort, true);
        sendJson(res, 200, { ok: true, state: buildStatePayload(boundPort) });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/config') {
      try {
        const body = await readJsonBody(req);
        engine.updateConfig(body);
        engine.update(Date.now());
        addLog('CONFIG', 'Оновлено пороги / базові рівні');
        broadcastState(boundPort, true);
        sendJson(res, 200, { ok: true, config: engine.config });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/esp-proxy') {
      try {
        const body = await readJsonBody(req);
        if (!body.enabled || !body.url) {
          sourceMeta.espPollUrl = null;
          sourceMeta.espPollError = null;
          if (sourceMeta.mode === 'ip_poll') sourceMeta.mode = 'waiting';
          addLog('IP_POLL', 'Опитування ESP32-C3 IP вимкнено');
        } else {
          let target = String(body.url).trim();
          if (!/^https?:\/\//i.test(target)) target = `http://${target}`;
          if (!target.endsWith('/api/telemetry')) {
            target = `${target.replace(/\/+$/, '')}/api/telemetry`;
          }
          sourceMeta.espPollUrl = target;
          sourceMeta.espPollError = null;
          sourceMeta.mode = 'ip_poll';
          addLog('IP_POLL', `Підключення до ${target}`);
        }
        broadcastState(boundPort, true);
        sendJson(res, 200, { ok: true, espPollUrl: sourceMeta.espPollUrl });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
      return;
    }

    // Serve static frontend files cleanly
    if (req.method === 'GET') {
      const safeRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const fullPath = path.resolve(PUBLIC_DIR, safeRel);
      if (!fullPath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(fullPath, (err, content) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(fullPath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(content);
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  // Periodic loop: packet rate meter, timeout watchdog, optional simulator & IP poller
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
      const boundPort = server.address() ? server.address().port : 5050;

      if (sourceMeta.mode === 'simulator' && sourceMeta.simStartedAt !== null) {
        sourceMeta.simTick += 1;
        const pkts = generateSimulatorPackets(
          sourceMeta.simScenario,
          now - sourceMeta.simStartedAt,
          sourceMeta.simTick
        );
        for (const p of pkts) {
          engine.ingestNodePacket(p, now);
        }
        sourceMeta.lastPacketAt = now;
        sourceMeta.packetCount += pkts.length;
        sourceMeta.packetsWindow += pkts.length;
        engine.update(now);
        broadcastState(boundPort);
        return;
      }

      if (sourceMeta.mode === 'ip_poll' && sourceMeta.espPollUrl && !pollInFlight) {
        pollInFlight = true;
        try {
          const resp = await fetch(sourceMeta.espPollUrl, {
            signal: AbortSignal.timeout(350),
          });
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

      // Always tick timeout watchdog so offline wheels honestly show OFFLINE after nodeTimeoutMs
      engine.update(now);
      broadcastState(boundPort);
    }, 100);
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
    console.log(`\n[TechBIT Test Workbench] http://localhost:${PORT}`);
    const urls = getLanUrls(PORT);
    if (urls.length > 0) {
      console.log(`[TechBIT Wi-Fi Telemetry Endpoint] ${urls.join(' | ')}`);
    }
  });
}

module.exports = { createServer, generateSimulatorPackets };
