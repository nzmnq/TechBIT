'use strict';

const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'];
const WHEEL_LABELS = ['Переднє ліве', 'Переднє праве', 'Заднє ліве', 'Заднє праве'];
const WHEEL_COLORS = ['#38bdf8', '#f59e0b', '#a78bfa', '#22c55e'];

let latestState = null;
let selectedFftWheel = 0;
let freezeCharts = false;
const rmsHistory = [[], [], [], []];
const MAX_HISTORY = 160;

// CSV Dataset recording buffer (exact format for esp-code/ml_trainer/train_classifier.py)
let csvRecording = false;
const csvRows = [];
const lastRecordedRxCounts = [0, 0, 0, 0];

// Web Serial state (2 concurrent USB ports)
function createSerialSlot(idx) {
  return {
    idx,
    port: null,
    reader: null,
    writer: null,
    keepReading: false,
    rxPackets: 0,
    lastRawWheelId: null,
    lastWheelName: null,
    mapMode: 'auto',
    btnId: idx === 0 ? 'btn-web-serial' : 'btn-web-serial-2',
    statusId: idx === 0 ? 'serial-status-text' : 'serial-status-text-2',
    badgeId: idx === 0 ? 'port-badge-1' : 'port-badge-2',
    mapId: idx === 0 ? 'port-wheel-map-1' : 'port-wheel-map-2',
    label: `USB Порт ${idx + 1}`,
    logTag: `USB${idx + 1}`,
  };
}

const serialSlots = [createSerialSlot(0), createSerialSlot(1)];
const consoleLines = [];

function pushConsole(tag, text) {
  const time = new Date().toLocaleTimeString('uk-UA');
  consoleLines.push(`[${time}] [${tag}] ${text}`);
  if (consoleLines.length > 60) consoleLines.shift();
  const el = document.getElementById('raw-console');
  if (el) {
    el.textContent = consoleLines.join('\n');
    el.scrollTop = el.scrollHeight;
  }
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function sendCommand(action, extra = {}) {
  const res = await apiPost('/api/command', { action, ...extra });
  if (action === 'cal' || action === 'reset' || action === 'mute') {
    await writeSerialLine(action, 'all');
  }
  return res;
}

async function writeSerialSlot(slotIdx, line) {
  const slot = serialSlots[slotIdx];
  if (!slot || !slot.writer) return false;
  try {
    const encoder = new TextEncoder();
    await slot.writer.write(encoder.encode(`${line.trim()}\n`));
    pushConsole(`TX->${slot.logTag}`, line.trim());
    return true;
  } catch (err) {
    pushConsole(`${slot.logTag} ERR`, err.message);
    return false;
  }
}

async function writeSerialLine(line, target = 'all') {
  if (target === '0' || target === 0) return writeSerialSlot(0, line);
  if (target === '1' || target === 1) return writeSerialSlot(1, line);
  const results = await Promise.all([
    serialSlots[0].writer ? writeSerialSlot(0, line) : Promise.resolve(false),
    serialSlots[1].writer ? writeSerialSlot(1, line) : Promise.resolve(false),
  ]);
  return results.some(Boolean);
}

// ---- Tabs (modern-web-guidance: tabs) ----
function initTabs() {
  const tablist = document.querySelector('.tablist');
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const panels = tabs.map((t) => document.querySelector(`[aria-labelledby="${t.id}"]`));

  function selectTab(targetTab, focusTab = false) {
    tabs.forEach((tab, idx) => {
      const selected = tab === targetTab;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.toggleAttribute('focusgroupstart', selected);
      const panel = panels[idx];
      if (selected) {
        panel.removeAttribute('hidden');
        panel.setAttribute('tabindex', '0');
      } else {
        panel.setAttribute('hidden', 'until-found');
        panel.removeAttribute('tabindex');
      }
    });
    targetTab.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' });
    if (focusTab) targetTab.focus();
    if (targetTab.id === 'tab-charts') {
      drawRmsChart();
      drawFftChart();
    }
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        selectTab(tabs[(i + 1) % tabs.length], true);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        selectTab(tabs[(i - 1 + tabs.length) % tabs.length], true);
      } else if (e.key === 'Home') {
        e.preventDefault();
        selectTab(tabs[0], true);
      } else if (e.key === 'End') {
        e.preventDefault();
        selectTab(tabs[tabs.length - 1], true);
      }
    });
  });

  panels.forEach((panel, idx) => {
    panel.addEventListener('beforematch', () => selectTab(tabs[idx]));
  });

  if (!CSS.supports('animation-timeline', 'scroll()') && tabs.length >= 2) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, intersectionRatio } of entries) {
          tablist.classList.toggle(
            target === tabs[0] ? 'more-start' : 'more-end',
            intersectionRatio < 1
          );
        }
      },
      { root: tablist, threshold: 1, rootMargin: '1px' }
    );
    observer.observe(tabs[0]);
    observer.observe(tabs[tabs.length - 1]);
  }
}

// ---- Web Serial (115200 baud direct USB-C connection to up to 2 ESP32-C3 boards) ----
function setSlotUiDisconnected(slot, statusText = 'Не підключено') {
  const btn = document.getElementById(slot.btnId);
  const statusEl = document.getElementById(slot.statusId);
  const badgeEl = document.getElementById(slot.badgeId);
  if (btn) btn.textContent = `Підключити ${slot.label}`;
  if (statusEl) statusEl.textContent = statusText;
  if (badgeEl) badgeEl.classList.remove('port-live');
}

async function closeSerialSlot(slotIdx, reasonText = 'Не підключено') {
  const slot = serialSlots[slotIdx];
  slot.keepReading = false;
  try {
    if (slot.reader) await slot.reader.cancel();
  } catch (_) {}
  try {
    if (slot.writer) slot.writer.releaseLock();
  } catch (_) {}
  try {
    if (slot.port) await slot.port.close();
  } catch (_) {}
  slot.port = null;
  slot.reader = null;
  slot.writer = null;
  slot.rxPackets = 0;
  slot.lastRawWheelId = null;
  slot.lastWheelName = null;
  setSlotUiDisconnected(slot, reasonText);
}

async function toggleWebSerial(slotIdx) {
  const slot = serialSlots[slotIdx];
  const btn = document.getElementById(slot.btnId);
  const statusEl = document.getElementById(slot.statusId);
  const badgeEl = document.getElementById(slot.badgeId);

  if (slot.port) {
    await closeSerialSlot(slotIdx, 'Не підключено');
    pushConsole(slot.logTag, 'COM-порт закрито');
    return;
  }

  if (!('serial' in navigator)) {
    statusEl.textContent = 'Web Serial не підтримується (потрібен Chrome або Edge)';
    pushConsole(`${slot.logTag} ERR`, 'navigator.serial недоступний');
    return;
  }

  try {
    const requestedPort = await navigator.serial.requestPort();
    const otherSlot = serialSlots[1 - slotIdx];
    if (otherSlot.port === requestedPort) {
      statusEl.textContent = `Цей порт вже відкритий у ${otherSlot.label}!`;
      pushConsole(`${slot.logTag} ERR`, `Вибраний порт вже підключений як ${otherSlot.label}`);
      return;
    }

    await requestedPort.open({ baudRate: 115200 });
    slot.port = requestedPort;
    slot.keepReading = true;
    slot.rxPackets = 0;
    slot.lastRawWheelId = null;
    slot.lastWheelName = null;
    slot.writer = slot.port.writable.getWriter();

    if (btn) btn.textContent = `Відключити ${slot.label}`;
    if (statusEl) statusEl.textContent = 'Підключено @ 115200 (очікування...)';
    if (badgeEl) badgeEl.classList.add('port-live');
    pushConsole(slot.logTag, 'Порт відкрито @ 115200 baud, перемикання на JSON...');

    await writeSerialSlot(slotIdx, 'json');
    await writeSerialSlot(slotIdx, 'status');
    readSerialLoop(slotIdx);
  } catch (err) {
    slot.port = null;
    slot.writer = null;
    setSlotUiDisconnected(slot, `Помилка: ${err.message}`);
    pushConsole(`${slot.logTag} ERR`, err.message);
  }
}

async function readSerialLoop(slotIdx) {
  const slot = serialSlots[slotIdx];
  const decoder = new TextDecoderStream();
  const inputDone = slot.port.readable.pipeTo(decoder.writable);
  const reader = decoder.readable.getReader();
  slot.reader = reader;

  let buffer = '';
  let lostConnection = false;
  try {
    while (slot.keepReading) {
      const { value, done } = await reader.read();
      if (done) {
        lostConnection = slot.keepReading;
        break;
      }
      if (!value) continue;
      buffer += value;
      let nlIdx;
      while ((nlIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line) continue;
        if (line.startsWith('{') && line.endsWith('}')) {
          try {
            const parsed = JSON.parse(line);
            let autoRemapNote = '';
            if (parsed.type !== 'techbit_hub' && parsed.wheelId !== undefined && parsed.wheelId !== null) {
              const rawId = Number(parsed.wheelId);
              slot.lastRawWheelId = rawId;
              const otherSlot = serialSlots[1 - slotIdx];

              if (slot.mapMode !== 'auto') {
                const mappedId = Number(slot.mapMode);
                parsed.wheelId = mappedId;
                parsed.wheel = WHEEL_NAMES[mappedId];
              } else if (
                slotIdx === 1 &&
                otherSlot.port &&
                otherSlot.lastRawWheelId !== null &&
                otherSlot.lastRawWheelId === rawId
              ) {
                const autoMappedId = (rawId + 1) % 4;
                parsed.wheelId = autoMappedId;
                parsed.wheel = WHEEL_NAMES[autoMappedId];
                autoRemapNote = ` [Авто→${WHEEL_NAMES[autoMappedId]}]`;
              }
            }

            slot.rxPackets += 1;
            slot.lastWheelName = parsed.wheel || WHEEL_NAMES[parsed.wheelId] || 'HUB';
            const statusEl = document.getElementById(slot.statusId);
            if (statusEl) {
              statusEl.textContent = `Live: ${slot.lastWheelName} • ${slot.rxPackets} pkt${autoRemapNote}`;
            }

            const resp = await apiPost('/api/telemetry', { source: 'serial', payload: parsed });
            if (resp && Array.isArray(resp.commands)) {
              for (const cmd of resp.commands) {
                await writeSerialSlot(slotIdx, cmd);
              }
            }
          } catch (e) {
            pushConsole(`${slot.logTag} JSON ERR`, `${e.message}: ${line.slice(0, 80)}`);
          }
        } else {
          pushConsole(`${slot.logTag} LOG`, line);
        }
      }
    }
  } catch (err) {
    if (slot.keepReading) {
      lostConnection = true;
      pushConsole(`${slot.logTag} ERR`, err.message);
    }
  } finally {
    try {
      reader.releaseLock();
      await inputDone.catch(() => {});
    } catch (_) {}
    if (lostConnection) {
      await closeSerialSlot(slotIdx, 'Відключено (USB витягнуто)');
    }
  }
}

// ---- Rendering ----
function classChipClass(clsName, online, faultConfirmed, sensorDead) {
  if (!online) return 'chip-off';
  if (faultConfirmed || sensorDead) return 'chip-fault';
  if (clsName === 'ANOMALY') return 'chip-warn';
  if (clsName === 'POTHOLE') return 'chip-pothole';
  if (clsName === 'BAD_ROAD') return 'chip-road';
  return 'chip-ok';
}

function renderTopAndVerdict(state) {
  const { sourceMeta, summary, networkUrls } = state;
  const sourcePill = document.getElementById('source-pill');
  const ratePill = document.getElementById('rate-pill');
  const simBanner = document.getElementById('sim-warning-banner');
  const simScenarioEl = document.getElementById('sim-banner-scenario');
  const btnSim = document.getElementById('btn-sim-toggle');

  const modeLabels = {
    waiting: ['ОЧІКУВАННЯ ESP32-C3', 'pill-waiting'],
    wifi: ['WI-FI PUSH LIVE', 'pill-live'],
    serial: ['USB SERIAL LIVE', 'pill-live'],
    ip_poll: ['ESP IP POLL LIVE', 'pill-live'],
    simulator: ['СТЕНДОВИЙ СИМУЛЯТОР', 'pill-sim'],
  };
  const [label, cls] = modeLabels[sourceMeta.mode] || modeLabels.waiting;
  sourcePill.textContent = label;
  sourcePill.className = `pill ${cls}`;
  ratePill.textContent = `${sourceMeta.packetsPerSec || 0} pkt/s | всього ${sourceMeta.packetCount || 0}`;

  if (sourceMeta.mode === 'simulator') {
    simBanner.removeAttribute('hidden');
    simScenarioEl.textContent = sourceMeta.simScenario;
    btnSim.textContent = 'Вимкнути симулятор';
    btnSim.className = 'btn btn-danger btn-sm';
  } else {
    simBanner.setAttribute('hidden', '');
    btnSim.textContent = 'Увімкнути симулятор';
    btnSim.className = 'btn btn-warning btn-sm';
  }

  document.getElementById('btn-ip-stop').hidden = sourceMeta.mode !== 'ip_poll';

  const wifiUrlEl = document.getElementById('wifi-url-text');
  if (Array.isArray(networkUrls) && networkUrls.length > 0) {
    const span = wifiUrlEl.querySelector('span') || wifiUrlEl;
    span.textContent = `POST ${networkUrls[0]}`;
    wifiUrlEl.classList.toggle('truncated', wifiUrlEl.scrollWidth > wifiUrlEl.clientWidth);
  }

  // System verdict banner
  const vBadge = document.getElementById('verdict-badge');
  const vTitle = document.getElementById('verdict-title');
  const vDetails = document.getElementById('verdict-details');

  const hwFaults = [];
  if (summary.vrefFaultMask !== 0) hwFaults.push('Помилка Vref MCP6002 (норма ~1650 мВ)');
  if (summary.deadSensorMask !== 0) hwFaults.push('Обрив п’єзодатчика (Dead Piezo)');
  if (summary.offlineWheelMask !== 0) hwFaults.push(`Таймаут CAN/вузла (mask 0x${summary.offlineWheelMask.toString(16)})`);
  if (summary.activeWheelCount > 0 && summary.sht40FaultMask !== 0) {
    hwFaults.push(`GY-SHT40 не відповідає (mask 0x${summary.sht40FaultMask.toString(16)})`);
  }

  if (summary.calibrating) {
    vBadge.textContent = `CAL ${summary.calProgressPct}%`;
    vBadge.className = 'verdict-badge verdict-road';
    vTitle.textContent = 'Виконується 5-секундне калібрування базового шуму';
    vDetails.textContent = 'Тримайте рух по рівному покриттю для розрахунку Welford Baseline RMS.';
  } else if (summary.activeWheelCount === 0) {
    vBadge.textContent = 'STANDBY';
    vBadge.className = 'verdict-badge verdict-ok';
    vTitle.textContent = 'Очікування живих даних від ESP32-C3';
    vDetails.textContent =
      sourceMeta.espPollError
        ? `Помилка опитування ESP IP: ${sourceMeta.espPollError}`
        : 'Підключіть плату по USB-C (Web Serial) або надішліть JSON по Wi-Fi POST.';
  } else if (summary.alertLevel === 3) {
    vBadge.textContent = 'ALERT_SERVICE_TO';
    vBadge.className = 'verdict-badge verdict-danger';
    const faultWheels = state.wheels.filter((w) => w.faultConfirmed).map((w) => w.name).join(', ');
    vTitle.textContent = `ПІДТВЕРДЖЕНА ПОЛОМКА (>3с): ${faultWheels}`;
    vDetails.textContent = hwFaults.length ? hwFaults.join(' • ') : 'Рекомендовано заїзд на ТО (підклинювання гальм або дефект підшипника).';
  } else if (summary.alertLevel === 2) {
    vBadge.textContent = 'WARNING_ACCUM';
    vBadge.className = 'verdict-badge verdict-warn';
    vTitle.textContent = 'Накопичення локальної аномалії (1.8..3.0 с)';
    vDetails.textContent = hwFaults.length ? hwFaults.join(' • ') : 'Перевірка стійкості аномалії перед запуском тривоги ТО.';
  } else if (hwFaults.length > 0) {
    vBadge.textContent = 'HW_DIAG_WARN';
    vBadge.className = 'verdict-badge verdict-warn';
    vTitle.textContent = `Апаратна діагностика: ${hwFaults[0]}`;
    vDetails.textContent = hwFaults.join(' • ');
  } else if (summary.badRoadActive) {
    vBadge.textContent = 'BAD_ROAD_FILTERED';
    vBadge.className = 'verdict-badge verdict-road';
    vTitle.textContent = 'Виявлено нерівну дорогу / бруківку — тривогу приглушено';
    vDetails.textContent = `Активних коліс: ${summary.activeWheelCount} • Стан: ${summary.roadState}`;
  } else {
    vBadge.textContent = summary.standstill ? 'STANDSTILL' : 'SYSTEM_OK';
    vBadge.className = 'verdict-badge verdict-ok';
    vTitle.textContent = summary.standstill
      ? 'Авто зупинено / холостий режим (< 7 мВ RMS)'
      : 'Штатний рух — усі активні колеса в нормі';
    vDetails.textContent = `Активних коліс: ${summary.activeWheelCount} • Стан: ${summary.roadState}`;
  }

  const btnMute = document.getElementById('btn-mute');
  btnMute.textContent = summary.buzzerMuted ? 'Увімкнути зумер' : 'Приглушити зумер (mute)';
}

function renderWheelCards(state) {
  const { wheels, config } = state;

  for (let i = 0; i < 4; i++) {
    const w = wheels[i];
    const card = document.getElementById(`wheel-card-${i}`);
    const t = w.telemetry;

    let cardClass = 'wheel-card';
    if (!w.online) cardClass += ' state-offline';
    else if (w.faultConfirmed || w.sensorDead || w.vrefStatus === 'LOW_RAIL' || w.vrefStatus === 'HIGH_RAIL') {
      cardClass += ' state-fault';
    } else if (w.anomalyAccumMs >= config.warningDelayMs || w.condensationRisk) {
      cardClass += ' state-warn';
    }
    card.className = cardClass;

    if (!w.online || !t) {
      const offlineMsg = w.seenEver
        ? `OFFLINE (${((w.ageMs || 0) / 1000).toFixed(1)} с без пакетів)`
        : 'OFFLINE (немає даних)';
      card.innerHTML = `
        <div class="wheel-head">
          <div class="wheel-title"><span class="wheel-code">${w.name}</span><span>${WHEEL_LABELS[i]}</span></div>
          <span class="status-chip chip-off">OFFLINE</span>
        </div>
        <div class="muted">${offlineMsg} • Baseline: ${w.baselineRmsMv.toFixed(1)} мВ • Пакетів: ${w.rxPacketCount}</div>
        <div class="metrics-grid">
          <div class="metric-item"><span>RMS / Peak</span><strong>— / —</strong></div>
          <div class="metric-item"><span>Vref MCP6002</span><strong>—</strong></div>
          <div class="metric-item"><span>SHT40 Темп / RH</span><strong>— / —</strong></div>
          <div class="metric-item"><span>fDom / Tonality</span><strong>— / —</strong></div>
        </div>
      `;
      continue;
    }

    const chipCls = classChipClass(w.predictedClassName, w.online, w.faultConfirmed, w.sensorDead);
    const accumPct = Math.min(100, Math.round((w.anomalyAccumMs / config.faultConfirmDurationMs) * 100));

    // Truthful GY-SHT40 display
    const shtText = t.sht40Ok
      ? `${t.tempC.toFixed(1)}°C (${w.tempDeltaC >= 0 ? '+' : ''}${w.tempDeltaC.toFixed(1)}°) / ${t.humidityPct.toFixed(0)}%`
      : 'НЕ ПІДКЛ. (0x44)';
    const shtClass = !t.sht40Ok ? 'val-warn' : w.thermalOverheat || w.condensationRisk ? 'val-bad' : 'val-ok';

    // Truthful MCP6002 Vref display
    const vrefText = t.dcOffsetMv !== null ? `${t.dcOffsetMv.toFixed(0)} мВ (${w.vrefStatus})` : '— (CAN Hub)';
    const vrefClass =
      w.vrefStatus === 'OK' ? 'val-ok'
      : w.vrefStatus === 'UNKNOWN' ? ''
      : 'val-bad';

    const pctL = Math.round(t.bandLowRatio * 100);
    const pctM = Math.round(t.bandMidRatio * 100);
    const pctH = Math.round(t.bandHighRatio * 100);

    const hwTags = [];
    if (w.mcu) hwTags.push(`<span class="hw-tag">${w.mcu}</span>`);
    if (t.sht40Ok) hwTags.push(`<span class="hw-tag ok">I2C 0x44 OK</span>`);
    else hwTags.push(`<span class="hw-tag warn">I2C 0x44 N/A</span>`);
    if (t.surgeClipping) hwTags.push(`<span class="hw-tag warn">BAT54S CLIP</span>`);
    if (w.sensorDead) hwTags.push(`<span class="hw-tag err">DEAD PIEZO</span>`);
    if (w.condensationRisk) hwTags.push(`<span class="hw-tag warn">ВОЛОГА &gt;85%</span>`);
    if (t.adcDropped !== null && t.adcDropped > 0) hwTags.push(`<span class="hw-tag err">ADC DROP ${t.adcDropped}</span>`);
    if (t.canTx !== null) hwTags.push(`<span class="hw-tag">CAN TX:${t.canTx}${t.canErr ? ` E:${t.canErr}` : ''}</span>`);
    for (const g of w.guardReasons || []) {
      hwTags.push(`<span class="hw-tag">${g}</span>`);
    }

    card.innerHTML = `
      <div class="wheel-head">
        <div class="wheel-title">
          <span class="wheel-code">${w.name}</span>
          <span>${WHEEL_LABELS[i]}</span>
        </div>
        <span class="status-chip ${chipCls}">${w.faultConfirmed ? 'SERVICE TO!' : w.predictedClassName} (${Math.round(w.probs[w.predictedClass] * 100)}%)</span>
      </div>

      <div class="metrics-grid">
        <div class="metric-item"><span>RMS / Peak</span><strong>${t.rmsMv.toFixed(1)} / ${t.peakMv.toFixed(0)} мВ</strong></div>
        <div class="metric-item"><span>Base / Peer / Axle</span><strong>${w.baselineRmsMv.toFixed(0)} / ${w.peerRatio.toFixed(2)}x / ${w.axleRatio.toFixed(2)}x</strong></div>
        <div class="metric-item"><span>fDom / fCent</span><strong>${t.dominantFreqHz} / ${t.spectralCentroidHz} Гц</strong></div>
        <div class="metric-item"><span>Crest / Kurt / Ton</span><strong>${t.crestFactor.toFixed(2)} / ${t.kurtosis.toFixed(1)} / ${t.tonalityRatio.toFixed(1)}</strong></div>
        <div class="metric-item"><span>Vref MCP6002</span><strong class="${vrefClass}">${vrefText}</strong></div>
        <div class="metric-item"><span>GY-SHT40 T / RH</span><strong class="${shtClass}">${shtText}</strong></div>
      </div>

      <div class="bands-wrap">
        <div class="band-row">
          <span>80–600 Гц</span>
          <div class="bar-track"><div class="bar-fill bar-low" style="width:${pctL}%"></div></div>
          <span>${pctL}%</span>
        </div>
        <div class="band-row">
          <span>600–2500 Гц</span>
          <div class="bar-track"><div class="bar-fill bar-mid" style="width:${pctM}%"></div></div>
          <span>${pctM}%</span>
        </div>
        <div class="band-row">
          <span>2.5–8 кГц</span>
          <div class="bar-track"><div class="bar-fill bar-high" style="width:${pctH}%"></div></div>
          <span>${pctH}%</span>
        </div>
        <div class="band-row">
          <span>3с Лічильник</span>
          <div class="bar-track"><div class="bar-fill bar-accum" style="width:${accumPct}%"></div></div>
          <span>${(w.anomalyAccumMs / 1000).toFixed(1)}с</span>
        </div>
      </div>

      <div class="hw-badges">${hwTags.join('')}</div>
    `;
  }
}

function drawRmsChart() {
  const canvas = document.getElementById('canvas-rms');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  let maxY = 120;
  for (let w = 0; w < 4; w++) {
    for (const v of rmsHistory[w]) {
      if (v !== null && v > maxY) maxY = v * 1.15;
    }
  }
  maxY = Math.ceil(maxY / 50) * 50;

  // Grid & Y labels
  ctx.strokeStyle = '#1e293b';
  ctx.fillStyle = '#93a4bc';
  ctx.font = '11px Consolas, monospace';
  for (let i = 0; i <= 4; i++) {
    const y = 16 + ((H - 36) * i) / 4;
    const val = Math.round(maxY * (1 - i / 4));
    ctx.beginPath();
    ctx.moveTo(44, y);
    ctx.lineTo(W - 10, y);
    ctx.stroke();
    ctx.fillText(`${val}`, 6, y + 4);
  }

  for (let w = 0; w < 4; w++) {
    const arr = rmsHistory[w];
    if (arr.length < 2) continue;
    ctx.strokeStyle = WHEEL_COLORS[w];
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < arr.length; i++) {
      const val = arr[i];
      if (val === null) {
        started = false;
        continue;
      }
      const x = 44 + (i / (MAX_HISTORY - 1)) * (W - 56);
      const y = 16 + (1 - Math.min(val, maxY) / maxY) * (H - 36);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}

function drawFftChart() {
  const canvas = document.getElementById('canvas-fft');
  const noteEl = document.getElementById('fft-honest-note');
  const metaEl = document.getElementById('fft-meta');
  if (!canvas || !latestState) return;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const w = latestState.wheels[selectedFftWheel];
  const t = w && w.online ? w.telemetry : null;
  if (!t) {
    metaEl.textContent = `${WHEEL_NAMES[selectedFftWheel]}: OFFLINE`;
    noteEl.hidden = true;
    ctx.fillStyle = '#64748b';
    ctx.font = '13px sans-serif';
    ctx.fillText(`Немає даних для колеса ${WHEEL_NAMES[selectedFftWheel]}`, 20, H / 2);
    return;
  }

  metaEl.textContent = `${w.name} | fDom: ${t.dominantFreqHz} Гц | fCent: ${t.spectralCentroidHz} Гц | Ton: ${t.tonalityRatio.toFixed(2)}`;
  const bins = Array.isArray(t.spectrum) && t.spectrum.length === 32 ? t.spectrum : null;
  if (!bins) {
    noteEl.hidden = false;
    ctx.fillStyle = '#93a4bc';
    ctx.font = '13px sans-serif';
    ctx.fillText('32-біновий спектр не передається через CAN Hub (підключіть ESP32-C3 напряму).', 20, H / 2);
    return;
  }
  noteEl.hidden = true;

  const padL = 42;
  const padR = 12;
  const padT = 18;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Background band zones: 0..600 (2.4 bins), 600..2500 (10 bins), 2500..8000 (32 bins)
  const xLowEnd = padL + (600 / 8000) * plotW;
  const xMidEnd = padL + (2500 / 8000) * plotW;
  ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
  ctx.fillRect(padL, padT, xLowEnd - padL, plotH);
  ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
  ctx.fillRect(xLowEnd, padT, xMidEnd - xLowEnd, plotH);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
  ctx.fillRect(xMidEnd, padT, padL + plotW - xMidEnd, plotH);

  let maxMag = 20;
  for (const v of bins) if (v > maxMag) maxMag = v * 1.15;
  maxMag = Math.ceil(maxMag / 10) * 10;

  ctx.strokeStyle = '#1e293b';
  ctx.fillStyle = '#93a4bc';
  ctx.font = '10px Consolas, monospace';
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(maxMag * (1 - i / 4))}`, 6, y + 3);
  }

  const barW = plotW / 32;
  for (let b = 0; b < 32; b++) {
    const val = Math.max(0, bins[b]);
    const bh = (val / maxMag) * plotH;
    const x = padL + b * barW + 2;
    const y = padT + plotH - bh;
    const fCenter = b * 250 + 125;
    ctx.fillStyle = fCenter < 600 ? '#38bdf8' : fCenter < 2500 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(x, y, Math.max(2, barW - 4), bh);
  }

  // Frequency axis labels
  ctx.fillStyle = '#93a4bc';
  for (let f = 0; f <= 8000; f += 1000) {
    const x = padL + (f / 8000) * plotW;
    ctx.fillText(`${f / 1000}k`, x - 6, H - 8);
  }

  // Dominant frequency vertical marker
  if (t.dominantFreqHz > 0 && t.dominantFreqHz <= 8000) {
    const xDom = padL + (t.dominantFreqHz / 8000) * plotW;
    ctx.strokeStyle = '#f8fafc';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(xDom, padT);
    ctx.lineTo(xDom, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(`${t.dominantFreqHz} Hz`, Math.min(xDom + 4, W - 62), padT + 12);
  }
}

function renderMlTable(state) {
  const tbody = document.getElementById('ml-table-body');
  const activeWheels = state.wheels.filter((w) => w.online && w.features);
  if (activeWheels.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="muted">Немає активних коліс для аналізу.</td></tr>';
    return;
  }

  tbody.innerHTML = activeWheels
    .map((w) => {
      const fCells = w.features.map((v) => `<td>${v.toFixed(3)}</td>`).join('');
      const probsStr = w.probs.map((p) => `${Math.round(p * 100)}%`).join(' / ');
      const guards = w.guardReasons && w.guardReasons.length ? ` [${w.guardReasons.join(',')}]` : '';
      return `
        <tr>
          <th>${w.name}</th>
          ${fCells}
          <td>${probsStr}</td>
          <td>${w.predictedClassName}${guards}</td>
        </tr>
      `;
    })
    .join('');
}

function syncConfigForms(state) {
  const cfgForm = document.getElementById('config-form');
  if (cfgForm && state.config) {
    for (const input of cfgForm.querySelectorAll('input[name]')) {
      if (document.activeElement !== input && state.config[input.name] !== undefined) {
        input.value = state.config[input.name];
      }
    }
  }
  const baseForm = document.getElementById('baselines-form');
  if (baseForm && state.wheels) {
    for (let i = 0; i < 4; i++) {
      const input = baseForm.querySelector(`input[name="base${i}"]`);
      if (input && document.activeElement !== input) {
        input.value = state.wheels[i].baselineRmsMv;
      }
    }
  }
}

function recordCsvIfEnabled(state) {
  if (!csvRecording) return;
  const labelSel = document.getElementById('csv-label-select').value;
  for (let i = 0; i < 4; i++) {
    const w = state.wheels[i];
    if (!w.online || !w.features) continue;
    if (w.rxPacketCount === lastRecordedRxCounts[i]) continue;
    lastRecordedRxCounts[i] = w.rxPacketCount;

    const label = labelSel === 'auto' ? w.predictedClass : Number(labelSel);
    const ts = w.telemetry && w.telemetry.deviceTsMs ? w.telemetry.deviceTsMs : Date.now();
    csvRows.push([ts, i, ...w.features.map((v) => v.toFixed(4)), label].join(','));
  }
  document.getElementById('csv-count').textContent = String(csvRows.length);
  document.getElementById('btn-csv-download').disabled = csvRows.length === 0;
}

function onNewState(state) {
  latestState = state;

  if (!freezeCharts) {
    for (let i = 0; i < 4; i++) {
      const w = state.wheels[i];
      rmsHistory[i].push(w.online && w.telemetry ? w.telemetry.rmsMv : null);
      if (rmsHistory[i].length > MAX_HISTORY) rmsHistory[i].shift();
    }
  }

  renderTopAndVerdict(state);
  renderWheelCards(state);
  renderMlTable(state);
  syncConfigForms(state);
  recordCsvIfEnabled(state);

  if (!freezeCharts) {
    drawRmsChart();
    drawFftChart();
  }
}

function initEventStream() {
  const es = new EventSource('/api/stream');
  es.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      onNewState(data);
    } catch (_) {}
  };
  es.onerror = () => {
    pushConsole('SSE', 'Втрачено з’єднання з локальним Node-сервером, перепідключення...');
  };
}

function getTargetSerialPort() {
  const sel = document.getElementById('esp-target-port');
  return sel ? sel.value : 'all';
}

function bindControls() {
  document.getElementById('btn-web-serial').addEventListener('click', () => toggleWebSerial(0));
  document.getElementById('btn-web-serial-2').addEventListener('click', () => toggleWebSerial(1));

  serialSlots.forEach((slot) => {
    const mapEl = document.getElementById(slot.mapId);
    if (!mapEl) return;
    mapEl.addEventListener('change', async (e) => {
      slot.mapMode = e.target.value;
      if (slot.port && slot.mapMode !== 'auto') {
        await writeSerialSlot(slot.idx, `wheel ${slot.mapMode}`);
      }
    });
  });

  document.getElementById('btn-cal').addEventListener('click', () => sendCommand('cal'));
  document.getElementById('btn-reset').addEventListener('click', () => sendCommand('reset'));
  document.getElementById('btn-mute').addEventListener('click', () => sendCommand('mute'));
  document.getElementById('btn-clear').addEventListener('click', () => {
    for (let i = 0; i < 4; i++) rmsHistory[i].length = 0;
    sendCommand('clear');
  });

  document.getElementById('btn-sim-toggle').addEventListener('click', () => {
    const active = latestState && latestState.sourceMeta.mode === 'simulator';
    const scenario = document.getElementById('sim-scenario-select').value;
    sendCommand('simulator', { enabled: !active, scenario });
  });

  document.getElementById('sim-scenario-select').addEventListener('change', (e) => {
    if (latestState && latestState.sourceMeta.mode === 'simulator') {
      sendCommand('simulator', { enabled: true, scenario: e.target.value });
    }
  });

  document.getElementById('ip-poll-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = document.getElementById('esp-ip-input').value.trim();
    if (!url) return;
    await apiPost('/api/esp-proxy', { enabled: true, url });
    pushConsole('IP_POLL', `Активовано опитування ${url}`);
  });

  document.getElementById('btn-ip-stop').addEventListener('click', async () => {
    await apiPost('/api/esp-proxy', { enabled: false });
    pushConsole('IP_POLL', 'Опитування зупинено');
  });

  document.getElementById('fft-wheel-select').addEventListener('change', (e) => {
    selectedFftWheel = Number(e.target.value);
    drawFftChart();
  });

  document.getElementById('chk-freeze-charts').addEventListener('change', (e) => {
    freezeCharts = e.target.checked;
  });

  document.getElementById('btn-clear-charts').addEventListener('click', () => {
    for (let i = 0; i < 4; i++) rmsHistory[i].length = 0;
    drawRmsChart();
  });

  // CSV Recorder
  const btnCsvRec = document.getElementById('btn-csv-record');
  btnCsvRec.addEventListener('click', () => {
    csvRecording = !csvRecording;
    btnCsvRec.textContent = csvRecording ? 'Пауза запису CSV' : 'Почати запис CSV';
    btnCsvRec.className = csvRecording ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm';
  });

  document.getElementById('btn-csv-clear').addEventListener('click', () => {
    csvRows.length = 0;
    document.getElementById('csv-count').textContent = '0';
    document.getElementById('btn-csv-download').disabled = true;
  });

  document.getElementById('btn-csv-download').addEventListener('click', () => {
    const header = 'ts_ms,wheel_id,f0,f1,f2,f3,f4,f5,f6,f7,f8,f9,label\n';
    const blob = new Blob([header + csvRows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `techbit_road_log_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Threshold & Baselines Forms
  document.getElementById('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const patch = {};
    for (const [k, v] of fd.entries()) {
      patch[k] = Number(v);
    }
    await apiPost('/api/config', patch);
    pushConsole('CONFIG', 'Пороги класифікатора оновлено');
  });

  document.getElementById('baselines-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const baselines = [0, 1, 2, 3].map((i) => Number(fd.get(`base${i}`)));
    await apiPost('/api/config', { baselines });
    pushConsole('CONFIG', `Базові рівні встановлено: [${baselines.join(', ')}] мВ`);
  });

  document.getElementById('btn-set-esp-wheel').addEventListener('click', async () => {
    const id = document.getElementById('esp-wheel-assign').value;
    const cmd = `wheel ${id}`;
    const target = getTargetSerialPort();
    await sendCommand('esp_command', { rawCmd: cmd });
    await writeSerialLine(cmd, target);
  });

  document.getElementById('wifi-provision-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ssid = document.getElementById('wifi-ssid').value.trim();
    const pass = document.getElementById('wifi-pass').value.trim() || '-';
    let url = document.getElementById('wifi-url').value.trim();
    if (!url && latestState && latestState.networkUrls && latestState.networkUrls[0]) {
      url = latestState.networkUrls[0];
    }
    if (!ssid) return;
    const cmd = url ? `wifi ${ssid} ${pass} ${url}` : `wifi ${ssid} ${pass}`;
    const target = getTargetSerialPort();
    await writeSerialLine(cmd, target);
    await sendCommand('esp_command', { rawCmd: cmd });
  });

  document.getElementById('raw-cmd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('raw-cmd-input');
    const cmd = input.value.trim();
    if (!cmd) return;
    const target = getTargetSerialPort();
    await writeSerialLine(cmd, target);
    await sendCommand('esp_command', { rawCmd: cmd });
    input.value = '';
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  bindControls();
  const wifiUrlEl = document.getElementById('wifi-url-text');
  if (wifiUrlEl && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        target.classList.toggle('truncated', target.scrollWidth > target.clientWidth);
      }
    });
    ro.observe(wifiUrlEl);
  }
  try {
    const res = await fetch('/api/state');
    if (res.ok) {
      onNewState(await res.json());
    }
  } catch (_) {}
  initEventStream();
});
