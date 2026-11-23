'use strict';

(() => {
  const WHEEL_CODES = [
    'T1-L', 'T1-R',
    'T2-L', 'T2-R',
    'P1-L', 'P1-R',
    'P2-L', 'P2-R',
    'P3-L', 'P3-R',
  ];

  const WHEEL_CAPTIONS = {
    'T1-L': 'Ліве переднє',
    'T1-R': 'Праве переднє',
    'T2-L': 'Ліве заднє (тягач)',
    'T2-R': 'Праве заднє (тягач)',
    'P1-L': 'Причеп вісь 1 · L',
    'P1-R': 'Причеп вісь 1 · R',
    'P2-L': 'Причеп вісь 2 · L',
    'P2-R': 'Причеп вісь 2 · R',
    'P3-L': 'Причеп вісь 3 · L',
    'P3-R': 'Причеп вісь 3 · R',
  };

  const PROFILE_WHEEL_MAP = {
    mvp_front: ['T1-L', 'T1-R'],
    tractor_4: ['T1-L', 'T1-R', 'T2-L', 'T2-R'],
    full_10: WHEEL_CODES,
  };

  const VIB_LABELS = {
    piezo_mcp6002: 'П\'єзо MCP6002',
    piezo_direct: 'П\'єзо прямий',
    mems_imu: 'MEMS / IMU',
  };

  const TEMP_LABELS = {
    sht40: 'GY-SHT40',
    ntc: 'NTC 10k',
    dual: 'SHT40 + NTC',
  };

  const REASON_LABELS = {
    NORMAL: 'Норма',
    TEMP_CRITICAL_BRAKE: 'Критичний перегрів гальма',
    TEMP_DELTA_HIGH: 'Перевищення ΔT на осі',
    VIB_ANOMALY_LOCAL: 'Локальна вібрація вузла',
    COBBLESTONE_FILTERED: 'Фільтр бруківки',
    POTHOLE_GUARD: 'Фільтр удару в яму',
    SHADOW_EARLY_DRIFT: 'Shadow Mode (дрейф)',
  };

  const SEVERITY_LABELS = {
    STANDBY: 'ОЧІКУВАННЯ',
    GREEN: 'НОРМА (GREEN)',
    YELLOW: 'УВАГА · ПЕРЕВІРИТИ',
    RED: 'СТОП · КРИТИЧНО',
    SHADOW: 'SHADOW',
    OFFLINE: 'OFFLINE',
  };

  const SOURCE_LABELS = {
    waiting: 'ОЧІКУВАННЯ',
    serial: 'USB SERIAL',
    wifi: 'WI-FI PUSH',
    ip_poll: 'ESP IP POLL',
    simulator: 'СИМУЛЯТОР',
  };

  const RESOLUTION_OPTIONS = [
    { code: 'BEARING_FAULT', label: 'Підшипник' },
    { code: 'BRAKE_STUCK', label: 'Гальмо' },
    { code: 'TIRE_ISSUE', label: 'Шина' },
    { code: 'SENSOR_FAULT', label: 'Датчик' },
    { code: 'FALSE_POSITIVE', label: 'Хибний' },
  ];

  const appState = {
    latest: null,
    selectedWheel: 'T1-L',
    chartsFrozen: false,
    selectedBurstIdx: 0,
    lastConfigVersion: -1,
    lastPinoutKey: '',
    lastIncidentsKey: '',
    lastBurstKey: '',
    lastLogsKey: '',
    localLogs: [],
    rmsHistory: Object.fromEntries(WHEEL_CODES.map((code) => [code, []])),
    serialPorts: {
      1: { port: null, reader: null, writer: null, reading: false, rxCount: 0 },
      2: { port: null, reader: null, writer: null, reading: false, rxCount: 0 },
    },
  };

  const $ = (id) => document.getElementById(id);

  function pushLocalLog(tag, text) {
    appState.localLogs.push({
      ts: new Date().toISOString(),
      tag,
      text: String(text).slice(0, 260),
    });
    if (appState.localLogs.length > 30) appState.localLogs.shift();
    if (appState.latest) renderConsole(appState.latest);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtNum(val, digits = 1, fallback = '—') {
    if (val === null || val === undefined || !Number.isFinite(Number(val))) return fallback;
    return Number(val).toFixed(digits);
  }

  function fmtUtcTime(iso) {
    if (!iso) return '--:--:--';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '--:--:--';
    return d.toISOString().slice(11, 19);
  }

  async function postCommand(payload) {
    try {
      const resp = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (err) {
      pushLocalLog('ERR', `Помилка команди: ${err.message}`);
      return null;
    }
  }

  function findWheelData(state, code) {
    if (!state || !Array.isArray(state.axles)) return null;
    for (const ax of state.axles) {
      if (ax.left && ax.left.code === code) return { axle: ax, side: ax.left, opposite: ax.right };
      if (ax.right && ax.right.code === code) return { axle: ax, side: ax.right, opposite: ax.left };
    }
    return null;
  }

  function triggerIconConfirm(swapEl, labelEl, doneText, defaultText, delayMs = 1500) {
    if (!swapEl || !labelEl) return;
    swapEl.dataset.active = 'true';
    labelEl.textContent = doneText;
    clearTimeout(swapEl._timer);
    swapEl._timer = setTimeout(() => {
      swapEl.dataset.active = 'false';
      labelEl.textContent = defaultText;
    }, delayMs);
  }

  // ========================================================================
  // Build Persistent DOM Skeleton for All 5 Axles (shown/hidden by profile)
  // ========================================================================
  function buildAxleCardElement(slot, key, label, codeL, codeR) {
    const card = document.createElement('article');
    card.className = 'axle-card';
    card.dataset.slot = String(slot);
    card.dataset.online = 'false';
    card.id = `axle-card-${slot}`;

    card.innerHTML = `
      <div class="axle-head">
        <div class="axle-head-left">
          <span class="axle-slot-badge">${key}</span>
          <span class="axle-name">${escapeHtml(label)}</span>
          <span class="axle-node-id" id="axle-node-${slot}">Не підключено</span>
        </div>
        <div class="axle-head-right">
          <span class="pill tabular" id="axle-dt-${slot}" data-state="OFFLINE">ΔT —</span>
          <span class="pill" id="axle-reason-${slot}" data-state="OFFLINE">OFFLINE</span>
          <span class="pill" id="axle-bus-${slot}" data-state="OFFLINE">I2C — · CAN —</span>
        </div>
      </div>
      <div class="wheels-pair">
        ${buildWheelTileMarkup(codeL)}
        ${buildWheelTileMarkup(codeR)}
      </div>
    `;
    return card;
  }

  function buildWheelTileMarkup(code) {
    const pressed = code === appState.selectedWheel ? 'true' : 'false';
    const caption = WHEEL_CAPTIONS[code] || code;
    return `
      <button type="button" class="wheel-tile" id="wheel-tile-${code}" data-code="${code}" data-severity="OFFLINE" aria-pressed="${pressed}">
        <div class="wheel-top">
          <div class="wheel-title-side">
            <span class="wheel-code-tag">${code}</span>
            <span class="wheel-side-caption">${escapeHtml(caption)}</span>
          </div>
          <span class="pill" id="wheel-sev-${code}" data-state="OFFLINE">OFFLINE</span>
        </div>
        <div class="wheel-primary-grid">
          <div class="wheel-kpi">
            <span class="wheel-kpi-label">Вібрація RMS</span>
            <span class="wheel-kpi-val tabular" id="wheel-rms-${code}">—</span>
            <span class="wheel-kpi-sub tabular" id="wheel-mv-${code}">— мВ · fDom —</span>
          </div>
          <div class="wheel-kpi">
            <span class="wheel-kpi-label">Температура</span>
            <span class="wheel-kpi-val tabular" id="wheel-temp-${code}">—</span>
            <span class="wheel-kpi-sub tabular" id="wheel-rh-${code}">Датчик —</span>
          </div>
        </div>
        <div class="wheel-hw-row">
          <span class="hw-tag tabular" id="wheel-vref-${code}" data-warn="false">Vref —</span>
          <span class="hw-tag tabular" id="wheel-crest-${code}">Crest —</span>
          <span class="hw-tag" id="wheel-clip-${code}" data-info="false" hidden>BAT54S CLIP</span>
        </div>
      </button>
    `;
  }

  function initStaticRigDom() {
    const tractorDefs = [
      [1, 'T1', 'Передня вісь (Ліве + Праве)', 'T1-L', 'T1-R'],
      [2, 'T2', 'Задня вісь тягача', 'T2-L', 'T2-R'],
    ];
    const trailerDefs = [
      [3, 'P1', 'Причеп • Вісь 1', 'P1-L', 'P1-R'],
      [4, 'P2', 'Причеп • Вісь 2', 'P2-L', 'P2-R'],
      [5, 'P3', 'Причеп • Вісь 3', 'P3-L', 'P3-R'],
    ];

    const tractorWrap = $('tractorAxlesContainer');
    const trailerWrap = $('trailerAxlesContainer');
    tractorDefs.forEach((d) => tractorWrap.appendChild(buildAxleCardElement(...d)));
    trailerDefs.forEach((d) => trailerWrap.appendChild(buildAxleCardElement(...d)));

    const selectorBar = $('wheelSelectorBar');
    WHEEL_CODES.forEach((code) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wheel-pill';
      btn.id = `wheel-pill-${code}`;
      btn.dataset.code = code;
      btn.dataset.severity = 'OFFLINE';
      btn.setAttribute('aria-pressed', code === appState.selectedWheel ? 'true' : 'false');
      btn.innerHTML = `<span class="wheel-pill-dot" aria-hidden="true"></span><span>${code}</span>`;
      btn.addEventListener('click', () => selectWheel(code));
      selectorBar.appendChild(btn);
    });

    document.querySelectorAll('.wheel-tile').forEach((tile) => {
      tile.addEventListener('click', () => selectWheel(tile.dataset.code));
    });
  }

  function selectWheel(code) {
    if (!WHEEL_CODES.includes(code)) return;
    appState.selectedWheel = code;
    document.querySelectorAll('.wheel-tile').forEach((el) => {
      el.setAttribute('aria-pressed', el.dataset.code === code ? 'true' : 'false');
    });
    document.querySelectorAll('.wheel-pill').forEach((el) => {
      el.setAttribute('aria-pressed', el.dataset.code === code ? 'true' : 'false');
    });
    if (appState.latest) renderCharts(appState.latest);
  }

  // ========================================================================
  // Dual Concurrent Web Serial (Port 1 & Port 2 — supports T1-L / T1-R / S3)
  // ========================================================================
  async function writeSerialLine(portIdx, line) {
    const slot = appState.serialPorts[portIdx];
    if (!slot || !slot.writer) return false;
    try {
      await slot.writer.write(new TextEncoder().encode(`${line.trim()}\n`));
      return true;
    } catch (err) {
      pushLocalLog(`USB${portIdx}`, `Помилка запису: ${err.message}`);
      return false;
    }
  }

  async function sendCliCommand(cmd) {
    const clean = String(cmd || '').trim();
    if (!clean) return;
    const target = $('cliTargetSelect')?.value || 'all';
    let sentUsb = 0;

    if (target === '1' || target === 'all') {
      if (await writeSerialLine(1, clean)) sentUsb += 1;
    }
    if (target === '2' || target === 'all') {
      if (await writeSerialLine(2, clean)) sentUsb += 1;
    }

    if (target === 'all' || sentUsb === 0) {
      await postCommand({ action: 'raw', cmd: clean });
    }
    pushLocalLog('CLI', `Надіслано "${clean}" (USB: ${sentUsb})`);
  }

  function updateSerialRowUi(portIdx) {
    const slot = appState.serialPorts[portIdx];
    const row = $(`serialRow${portIdx}`);
    const label = $(`serialBtnLabel${portIdx}`);
    const status = $(`serialStatus${portIdx}`);
    const connected = Boolean(slot.port && slot.reading);

    row.dataset.connected = connected ? 'true' : 'false';
    label.textContent = connected ? `Відкл. ${portIdx}` : `USB ${portIdx}`;
    status.textContent = connected ? `${slot.rxCount} pkt` : 'Вільний';
  }

  async function disconnectSerialPort(portIdx) {
    const slot = appState.serialPorts[portIdx];
    slot.reading = false;
    try {
      if (slot.reader) {
        await slot.reader.cancel();
        slot.reader.releaseLock();
      }
    } catch (_) {}
    try {
      if (slot.writer) slot.writer.releaseLock();
    } catch (_) {}
    try {
      if (slot.port) await slot.port.close();
    } catch (_) {}
    slot.reader = null;
    slot.writer = null;
    slot.port = null;
    slot.rxCount = 0;
    updateSerialRowUi(portIdx);
    pushLocalLog(`USB${portIdx}`, 'Порт відключено.');
  }

  async function toggleSerialPort(portIdx) {
    if (!('serial' in navigator)) {
      pushLocalLog('USB', 'Web Serial працює у Chrome / Edge. Використовуйте Wi-Fi Push або IP Poll.');
      return;
    }
    const slot = appState.serialPorts[portIdx];
    if (slot.port && slot.reading) {
      await disconnectSerialPort(portIdx);
      return;
    }

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      slot.port = port;
      slot.reading = true;
      slot.rxCount = 0;
      if (port.writable) slot.writer = port.writable.getWriter();
      updateSerialRowUi(portIdx);
      pushLocalLog(`USB${portIdx}`, 'Порт відкрито (115200 baud). Читання телеметрії...');

      const decoder = new TextDecoder();
      const reader = port.readable.getReader();
      slot.reader = reader;
      let buffer = '';

      while (slot.reading) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        buffer += decoder.decode(value, { stream: true });
        let nlIdx;
        while ((nlIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          if (line) handleSerialLine(portIdx, line);
        }
      }
    } catch (err) {
      if (err && err.name !== 'NotFoundError') {
        pushLocalLog(`USB${portIdx}`, `Помилка Serial: ${err.message}`);
      }
    } finally {
      if (slot.port) await disconnectSerialPort(portIdx);
    }
  }

  async function handleSerialLine(portIdx, line) {
    const slot = appState.serialPorts[portIdx];
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      pushLocalLog(`USB${portIdx}`, trimmed);
      return;
    }
    try {
      const json = JSON.parse(trimmed);
      slot.rxCount += 1;
      updateSerialRowUi(portIdx);
      const slotOverride = $(`serialSlot${portIdx}`)?.value || 'auto';
      json._source = 'serial';
      if (slotOverride !== 'auto') json._slotOverride = slotOverride;

      const resp = await fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });
      if (resp.ok) {
        const ack = await resp.json();
        if (Array.isArray(ack.commands)) {
          for (const cmd of ack.commands) await writeSerialLine(portIdx, cmd);
        }
      }
    } catch (_) {
      pushLocalLog(`USB${portIdx}`, trimmed);
    }
  }

  // ========================================================================
  // Profile Visibility & Adaptive Pinout Renderer
  // ========================================================================
  function applyRigProfileVisibility(state) {
    const cfg = state.config;
    const profileId = cfg.rigProfile || 'mvp_front';
    const profile = state.profile || { id: profileId, slots: [1], hasBridge: false, expectedWheels: 2 };
    const vibLabel = VIB_LABELS[cfg.vibSensorType] || cfg.vibSensorType;
    const tempLabel = TEMP_LABELS[cfg.tempSensorType] || cfg.tempSensorType;

    // Segmented profile buttons
    document.querySelectorAll('[data-rig-profile]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.rigProfile === profileId ? 'true' : 'false');
    });

    if ($('vibSensorSelect').value !== cfg.vibSensorType) {
      $('vibSensorSelect').value = cfg.vibSensorType;
    }
    if ($('tempSensorSelect').value !== cfg.tempSensorType) {
      $('tempSensorSelect').value = cfg.tempSensorType;
    }

    // Topbar & summary copy
    if (profileId === 'mvp_front') {
      $('couplingIdsLabel').textContent = 'MVP · T1-L / T1-R + S3';
      $('activeArchSubtitle').textContent =
        `Ліве переднє + Праве переднє + Головний модуль S3 · ${vibLabel} + ${tempLabel}`;
      $('tractorKicker').textContent = 'MVP СТЕНД · ПЕРЕДНЯ ВІСЬ · 2 КОЛЕСА';
      $('tractorBusTag').textContent = 'T1-L + T1-R → CAN 500 kbps → S3 Master';
      $('simDescText').textContent = 'Генерує потік для поточного MVP: T1-L, T1-R + S3 Master.';
      $('profileSummaryPill').textContent = '2 колеса + S3 Master';
    } else if (profileId === 'tractor_4') {
      $('couplingIdsLabel').textContent = `${state.tractorId} · 4 колеса + S3`;
      $('activeArchSubtitle').textContent =
        `Тягач 2 осі (T1, T2) + Головний модуль S3 · ${vibLabel} + ${tempLabel}`;
      $('tractorKicker').textContent = 'ТЯГАЧ · 2 ОСІ · 4 КОЛЕСА';
      $('tractorBusTag').textContent = 'T1 + T2 → CAN 500 kbps → S3 Master';
      $('simDescText').textContent = 'Генерує потік 2 осей тягача (T1, T2 = 4 колеса) + S3 Master.';
      $('profileSummaryPill').textContent = '4 колеса + S3 Master';
    } else {
      $('couplingIdsLabel').textContent = `${state.tractorId} + ${state.trailerId} (10 коліс)`;
      $('activeArchSubtitle').textContent =
        `5× C3 Вузлів + ESP-NOW LR Місток + S3 Master · ${vibLabel} + ${tempLabel}`;
      $('tractorKicker').textContent = 'ТЯГАЧ · 2 ОСІ · 4 КОЛЕСА';
      $('tractorBusTag').textContent = 'T1 + T2 → CAN 500 kbps → S3 Master';
      $('simDescText').textContent = 'Генерує повну зчіпку: 5× C3 (10 коліс) + ESP-NOW Місток + S3.';
      $('profileSummaryPill').textContent = '10 коліс + Місток + S3';
    }

    // Show/hide axle cards & trailer blocks cleanly
    const t2Card = $('axle-card-2');
    if (t2Card) t2Card.hidden = !profile.slots.includes(2);
    $('bridgeConnector').hidden = !profile.hasBridge;
    $('trailerAssetGroup').hidden = !profile.hasBridge;

    // Show/hide wheel selector pills in Oscilloscope
    const allowedWheels = PROFILE_WHEEL_MAP[profileId] || WHEEL_CODES;
    WHEEL_CODES.forEach((code) => {
      const pill = $(`wheel-pill-${code}`);
      if (pill) pill.hidden = !allowedWheels.includes(code);
    });
    if (!allowedWheels.includes(appState.selectedWheel)) {
      selectWheel(allowedWheels[0]);
    }

    renderAdaptivePinout(cfg, profile);
  }

  function renderAdaptivePinout(cfg, profile) {
    const key = `${cfg.rigProfile}|${cfg.vibSensorType}|${cfg.tempSensorType}`;
    if (key === appState.lastPinoutKey) return;
    appState.lastPinoutKey = key;

    const vibLabel = VIB_LABELS[cfg.vibSensorType] || cfg.vibSensorType;
    const tempLabel = TEMP_LABELS[cfg.tempSensorType] || cfg.tempSensorType;
    $('pinoutProfilePill').textContent = `${vibLabel} + ${tempLabel}`;
    $('pinoutSubLabel').textContent = `Активна схема: ${profile.label} (${vibLabel}, ${tempLabel}).`;

    const vibRows =
      cfg.vibSensorType === 'piezo_mcp6002'
        ? `
          <tr><td>П'єзо Ліве (T1-L)</td><td class="mono">GPIO2 (ADC1_CH2)</td><td>AFE MCP6002 Vref ≈ 1.65 В + BAT54S</td></tr>
          <tr><td>П'єзо Праве (T1-R)</td><td class="mono">GPIO3 (ADC1_CH3)</td><td>2-й канал осі · DMA 9 кГц (unit=0)</td></tr>`
        : cfg.vibSensorType === 'piezo_direct'
          ? `
          <tr><td>П'єзо прямий (L/R)</td><td class="mono">GPIO2 / GPIO3</td><td>Прямий ADC1_CH2/CH3 без зміщення Vref</td></tr>`
          : `
          <tr><td>Акселерометр MEMS/IMU</td><td class="mono">SPI / I2C (GPIO6-9)</td><td>Цифрові осі X/Y/Z → перерахунок RMS мм/с</td></tr>`;

    const tempRows =
      cfg.tempSensorType === 'sht40'
        ? `<tr><td>I2C GY-SHT40</td><td class="mono">GPIO8 / GPIO9</td><td>SDA/SCL · авто-пошук 0x44/0x45 (°C + RH%)</td></tr>`
        : cfg.tempSensorType === 'ntc'
          ? `<tr><td>Термістори NTC 10k</td><td class="mono">GPIO0 / GPIO4</td><td>ADC1_CH0 (L) / CH4 (R) · ENABLE_SHT40=0</td></tr>`
          : `
          <tr><td>I2C GY-SHT40 (осн.)</td><td class="mono">GPIO8 / GPIO9</td><td>SDA/SCL · °C + контроль конденсату RH%</td></tr>
          <tr><td>NTC 10k (резерв)</td><td class="mono">GPIO0 / GPIO4</td><td>Аварійний канал при збої I2C</td></tr>`;

    const bridgeBlock = profile.hasBridge
      ? `
        <div class="pinout-block">
          <h3>ESP32-C3 Trailer Bridge (Причеп P1–P3)</h3>
          <table class="pin-table">
            <thead><tr><th>Сигнал</th><th>GPIO</th><th>Примітка</th></tr></thead>
            <tbody>
              <tr><td>CAN SN65HVD230</td><td class="mono">GPIO21 / GPIO20</td><td>Збір осей P1, P2, P3 (500 kbps)</td></tr>
              <tr><td>ESP-NOW LR 2.4 ГГц</td><td class="mono">Зовнішня антена</td><td>1 Мбіт/с + AES-128 до S3 Master</td></tr>
              <tr><td>Кнопка Pairing</td><td class="mono">GPIO9</td><td>Прив'язка причепа Drop &amp; Hook</td></tr>
            </tbody>
          </table>
        </div>`
      : '';

    $('dynamicPinoutGrid').innerHTML = `
      <div class="pinout-block">
        <h3>ESP32-C3 SuperMini — Вузол передньої осі (T1-L / T1-R)</h3>
        <table class="pin-table">
          <thead><tr><th>Сигнал</th><th>GPIO</th><th>Примітка</th></tr></thead>
          <tbody>
            ${vibRows}
            ${tempRows}
            <tr><td>CAN SN65HVD230</td><td class="mono">GPIO21 / GPIO20</td><td>TX/RX · 500 kbps · термінатор 120 Ом</td></tr>
          </tbody>
        </table>
      </div>
      <div class="pinout-block">
        <h3>ESP32-S3 Master — Головний модуль кабіни</h3>
        <table class="pin-table">
          <thead><tr><th>Модуль / Сигнал</th><th>GPIO</th><th>Примітка</th></tr></thead>
          <tbody>
            <tr><td>CAN шина тягача</td><td class="mono">GPIO4 / GPIO5</td><td>Прийом T1-L / T1-R (і T2)</td></tr>
            <tr><td>Mini-LED + Зумер</td><td class="mono">GPIO6, 7, 14, 15</td><td>G / Y / R + код колеса (без OLED)</td></tr>
            <tr><td>LTE SIM7600</td><td class="mono">GPIO17 / GPIO18</td><td>UART TX/RX · HTTPS ANOMALY_BURST</td></tr>
            <tr><td>Кнопка BLE 15 хв</td><td class="mono">GPIO0</td><td>Service Mode лише для СТО</td></tr>
          </tbody>
        </table>
      </div>
      ${bridgeBlock}
    `;
  }

  // ========================================================================
  // State Rendering (In-Place Patching, Zero Flicker)
  // ========================================================================
  function renderTopbar(state) {
    const mode = state.source?.mode || 'waiting';
    $('sourcePill').dataset.mode = mode;
    $('sourceModeText').textContent = SOURCE_LABELS[mode] || mode.toUpperCase();

    $('ppsValue').textContent = `${state.source?.packetsPerSec ?? 0} pkt/s`;
    $('totalPktsValue').textContent = String(state.source?.packetCount ?? 0);
    $('utcClock').textContent = `${fmtUtcTime(state.tsUtc)} UTC`;

    const wifiUrls = state.source?.wifiUrls || [];
    if (wifiUrls.length > 0) $('wifiEndpointText').textContent = wifiUrls[0];

    const simActive = mode === 'simulator';
    const simBadge = $('simStateBadge');
    simBadge.textContent = simActive ? `Активний (${state.source.simScenario})` : 'Вимкнено';
    simBadge.dataset.active = simActive ? 'true' : 'false';
    $('btnSimToggle').setAttribute('aria-pressed', simActive ? 'true' : 'false');
    $('simIconSwap').dataset.active = simActive ? 'true' : 'false';
    $('simBtnLabel').textContent = simActive ? 'Стоп' : 'Старт';

    const pollActive = mode === 'ip_poll';
    const pollBadge = $('pollStateBadge');
    pollBadge.textContent = pollActive ? 'Активний' : 'Вимкнено';
    pollBadge.dataset.active = pollActive ? 'true' : 'false';
    $('btnIpPoll').textContent = pollActive ? 'Зупинити' : 'Опитувати';
    if (state.source?.espPollError) {
      $('ipPollHint').textContent = `Помилка: ${state.source.espPollError}`;
    }
  }

  function renderCabinAndS3(state) {
    const ind = state.indicator;
    const s3 = state.s3Master;
    $('cabinLedUnit').dataset.severity = ind.driverSeverity;

    $('driverSeverityText').textContent = SEVERITY_LABELS[ind.driverSeverity] || ind.driverSeverity;
    if (ind.driverSeverity === 'RED') {
      $('driverSeverityHint').textContent = ind.buzzerOn
        ? `АКТИВНИЙ ЗУМЕР · Перевірте ${ind.wheelCode} негайно!`
        : `Критична тривога ${ind.wheelCode} (зумер приглушено)`;
    } else if (ind.driverSeverity === 'YELLOW') {
      $('driverSeverityHint').textContent = `Стійка аномалія (> ${state.config.yellowConfirmSec} с) на ${ind.wheelCode}.`;
    } else if (ind.driverSeverity === 'GREEN') {
      $('driverSeverityHint').textContent = ind.roughRoadActive
        ? 'Бруківка розпізнана — хибні тривоги подавлено.'
        : 'Усі активні датчики в нормі.';
    } else {
      $('driverSeverityHint').textContent = 'Підключіть датчики по USB/Wi-Fi або запустіть симулятор.';
    }

    $('driverWheelCode').textContent = ind.wheelCode || '—';
    $('activeWheelsChip').textContent = `${ind.activeWheels} / ${ind.expectedWheels ?? 2}`;

    $('shadowCountChip').textContent = String(ind.shadowCount);
    $('shadowChip').dataset.highlight = ind.shadowCount > 0 ? 'shadow' : '';

    $('roadStateChip').textContent = ind.roughRoadActive ? 'Бруківка' : 'Рівна';
    $('roadChip').dataset.highlight = ind.roughRoadActive ? 'rough' : '';

    $('potholeCountChip').textContent = String(ind.potholeCount);
    $('lteBleChip').textContent = `${s3.lteOnline ? 'LTE' : 'OFF'} / ${s3.bleActive ? '15м' : 'OFF'}`;
    $('blackBoxChip').textContent = `${s3.blackBoxRecs} зап.`;

    $('btnMuteBuzzer').setAttribute('aria-pressed', s3.buzzerMuted ? 'true' : 'false');
    $('muteIconSwap').dataset.active = s3.buzzerMuted ? 'true' : 'false';
    $('muteLabel').textContent = s3.buzzerMuted ? 'Без звуку' : 'Зумер';

    // Dedicated S3 Master Card
    $('s3ModuleCard').dataset.online = s3.online ? 'true' : 'false';
    const s3Pill = $('s3OnlinePill');
    s3Pill.dataset.state = s3.online ? 'online' : 'offline';
    s3Pill.textContent = s3.online ? 'ONLINE' : 'OFFLINE';
    $('s3DeviceId').textContent = s3.deviceId || state.deviceId;
    $('s3TractorId').textContent = state.tractorId;
    $('s3LteText').textContent = s3.online ? (s3.lteOnline ? 'Онлайн' : 'Очікування') : 'Немає зв’язку';
    $('s3BleText').textContent = s3.bleActive ? 'АКТИВНИЙ (15 хв)' : 'OFF (у русі)';
    $('s3BufferText').textContent = `${s3.blackBoxRecs} зап. / ${s3.pendingQueue}`;
  }

  function renderBridge(state) {
    const br = state.bridge;
    $('bridgeConnector').dataset.online = br.online ? 'true' : 'false';
    const pill = $('bridgeStatusPill');
    pill.dataset.state = br.online ? 'online' : 'offline';
    pill.textContent = br.online ? 'ONLINE' : 'OFFLINE';
    $('bridgeTrailerId').textContent = br.trailerId || state.trailerId;
    $('bridgePairedText').textContent = br.online ? (br.paired ? 'AES-128 OK' : 'Пошук') : 'Немає';
    $('bridgeRssiText').textContent = br.online && br.rssi !== null ? `${br.rssi} dBm` : '—';
    $('bridgeCanText').textContent = `${br.nodeCount} / #${br.seq || 0}`;
  }

  function renderWheelSide(side, cfg) {
    const tile = $(`wheel-tile-${side.code}`);
    if (!tile) return;

    const online = Boolean(side.online);
    const sev = online ? side.severity : 'OFFLINE';
    tile.dataset.severity = sev;

    const sevPill = $(`wheel-sev-${side.code}`);
    sevPill.dataset.state = sev;
    sevPill.textContent = sev;

    const pillBtn = $(`wheel-pill-${side.code}`);
    if (pillBtn) pillBtn.dataset.severity = sev;

    if (!online) {
      $(`wheel-rms-${side.code}`).textContent = '—';
      $(`wheel-mv-${side.code}`).textContent = '— мВ · fDom —';
      $(`wheel-temp-${side.code}`).textContent = '—';
      $(`wheel-rh-${side.code}`).textContent = cfg.tempSensorType === 'ntc' ? 'NTC ADC —' : 'SHT40 —';
      const vrefEl = $(`wheel-vref-${side.code}`);
      vrefEl.textContent = cfg.vibSensorType === 'piezo_mcp6002' ? 'Vref —' : VIB_LABELS[cfg.vibSensorType];
      vrefEl.dataset.warn = 'false';
      $(`wheel-crest-${side.code}`).textContent = 'Crest —';
      $(`wheel-clip-${side.code}`).hidden = true;
      return;
    }

    $(`wheel-rms-${side.code}`).textContent = `${fmtNum(side.rmsMmS, 2)} мм/с`;
    $(`wheel-mv-${side.code}`).textContent = `${fmtNum(side.rmsMv, 1)} мВ · ${Math.round(side.fDomHz || 0)} Гц`;
    $(`wheel-temp-${side.code}`).textContent = side.tempC !== null ? `${fmtNum(side.tempC, 1)} °C` : '—';

    const rhEl = $(`wheel-rh-${side.code}`);
    if (cfg.tempSensorType === 'ntc') {
      rhEl.textContent = 'NTC 10k ADC OK';
    } else if (!side.shtOk) {
      rhEl.textContent = 'SHT40 ПОМИЛКА I2C';
    } else if (side.rh !== null) {
      rhEl.textContent = side.humidityWarn
        ? `RH ${fmtNum(side.rh, 0)}% · КОНДЕНСАТ`
        : `SHT40 · RH ${fmtNum(side.rh, 0)}%`;
    } else {
      rhEl.textContent = 'SHT40 OK';
    }

    const vrefEl = $(`wheel-vref-${side.code}`);
    if (cfg.vibSensorType !== 'piezo_mcp6002') {
      vrefEl.textContent = VIB_LABELS[cfg.vibSensorType] || 'Датчик OK';
      vrefEl.dataset.warn = 'false';
    } else if (side.dcOffsetMv !== null) {
      vrefEl.textContent = `Vref ${Math.round(side.dcOffsetMv)} мВ${side.vrefStatus === 'FAULT' ? ' !' : ''}`;
      vrefEl.dataset.warn = side.vrefStatus === 'FAULT' ? 'true' : 'false';
    } else {
      vrefEl.textContent = 'Vref —';
      vrefEl.dataset.warn = 'false';
    }

    $(`wheel-crest-${side.code}`).textContent = `Crest ${fmtNum(side.crest, 2)}`;

    const clipEl = $(`wheel-clip-${side.code}`);
    clipEl.hidden = !side.clip;
    clipEl.dataset.info = side.clip ? 'true' : 'false';
  }

  function renderAxles(state) {
    $('tractorIdHeading').textContent = state.tractorId;
    $('trailerIdHeading').textContent = state.trailerId;

    for (const ax of state.axles) {
      const card = $(`axle-card-${ax.slot}`);
      if (!card) continue;
      card.dataset.online = ax.online ? 'true' : 'false';

      $(`axle-node-${ax.slot}`).textContent = ax.nodeId
        ? `${ax.nodeId} · ${ax.rxCount} pkt`
        : 'Не підключено';

      const dtPill = $(`axle-dt-${ax.slot}`);
      const bothOnline = ax.left.online && ax.right.online;
      dtPill.textContent = bothOnline ? `ΔT ${fmtNum(ax.tempDeltaC, 1)} °C` : 'ΔT —';
      dtPill.dataset.state = !bothOnline
        ? 'OFFLINE'
        : ax.tempDeltaC >= state.config.axleTempDeltaCritC
          ? 'RED'
          : ax.tempDeltaC >= state.config.axleTempDeltaWarnC
            ? 'YELLOW'
            : 'GREEN';

      const reasonPill = $(`axle-reason-${ax.slot}`);
      reasonPill.textContent = ax.online ? (REASON_LABELS[ax.lastReason] || ax.lastReason) : 'OFFLINE';
      reasonPill.dataset.state = !ax.online
        ? 'OFFLINE'
        : ax.redLatched
          ? 'RED'
          : ax.yellowLatched
            ? 'YELLOW'
            : ax.shadowTriggered
              ? 'SHADOW'
              : 'GREEN';

      const busPill = $(`axle-bus-${ax.slot}`);
      const tempTag = state.config.tempSensorType === 'ntc' ? 'NTC' : `I2C ${ax.i2c?.addr || '—'}`;
      busPill.textContent = ax.online
        ? `${tempTag} · CAN ${ax.can?.ready ? 'OK' : '—'}`
        : 'I2C — · CAN —';
      busPill.dataset.state =
        ax.online && (state.config.tempSensorType === 'ntc' || ax.i2c?.err === 0)
          ? 'online'
          : 'offline';

      renderWheelSide(ax.left, state.config);
      renderWheelSide(ax.right, state.config);
    }
  }

  // ========================================================================
  // Live HiDPI Canvas Charts (Always Visible on SPA)
  // ========================================================================
  function pushHistorySamples(state) {
    if (appState.chartsFrozen) return;
    for (const ax of state.axles) {
      for (const side of [ax.left, ax.right]) {
        const hist = appState.rmsHistory[side.code];
        if (!hist) continue;
        hist.push(side.online ? Number(side.rmsMmS || 0) : null);
        if (hist.length > 90) hist.shift();
      }
    }
  }

  function prepareCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(280, Math.round(rect.width || 600));
    const h = Math.max(180, Math.round(rect.height || 205));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function renderCharts(state) {
    const found = findWheelData(state, appState.selectedWheel);
    if (!found) return;
    const { axle, side, opposite } = found;
    const online = Boolean(side.online);
    const cfg = state.config;

    $('selWheelCode').textContent = side.code;
    $('selRmsMmS').textContent = online ? `${fmtNum(side.rmsMmS, 2)} мм/с` : 'OFFLINE';
    $('selRmsMv').textContent = online ? `${fmtNum(side.rmsMv, 0)} мВ / ${Math.round(side.fDomHz || 0)} Гц` : '—';
    $('selPeakCrest').textContent = online ? `${fmtNum(side.peakMmS, 1)} / ${fmtNum(side.crest, 2)}` : '—';
    $('selTempDelta').textContent = online ? `${fmtNum(side.tempC, 1)}° / Δ${fmtNum(axle.tempDeltaC, 1)}` : '—';

    $('selTempSensorLabel').textContent = cfg.tempSensorType === 'ntc' ? 'NTC 10k' : 'SHT40 RH';
    $('selHumidity').textContent =
      !online
        ? '—'
        : cfg.tempSensorType === 'ntc'
          ? 'ADC OK'
          : side.shtOk && side.rh !== null
            ? `${fmtNum(side.rh, 1)}%`
            : 'I2C ERR';

    $('selVibSensorLabel').textContent = cfg.vibSensorType === 'piezo_mcp6002' ? 'Vref' : 'Вібро';
    $('selVref').textContent =
      !online
        ? '—'
        : cfg.vibSensorType !== 'piezo_mcp6002'
          ? VIB_LABELS[cfg.vibSensorType]
          : side.dcOffsetMv !== null
            ? `${Math.round(side.dcOffsetMv)} мВ (${side.vrefStatus})`
            : '—';

    $('rmsThresholdTag').textContent = `Поріг: ${cfg.vibWarnRmsMmS} / ${cfg.vibCritRmsMmS}`;
    $('rmsChartLegend').textContent = `Суцільна — ${side.code} · Пунктир — ${opposite.code}`;
    $('fftPeakTag').textContent = online ? `fDom: ${Math.round(side.fDomHz || 0)} Гц` : 'fDom: — Гц';

    drawRmsCanvas(state, side, opposite);
    drawFftCanvas(side, online);
  }

  function drawRmsCanvas(state, side, opposite) {
    const canvas = $('rmsCanvas');
    if (!canvas) return;
    const { ctx, w, h } = prepareCanvas(canvas);

    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, w, h);

    const padL = 40;
    const padR = 12;
    const padT = 12;
    const padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const mainHist = appState.rmsHistory[side.code] || [];
    const oppHist = appState.rmsHistory[opposite.code] || [];
    const maxData = Math.max(
      state.config.vibCritRmsMmS + 1.5,
      ...mainHist.filter((v) => v !== null),
      ...oppHist.filter((v) => v !== null)
    );
    const yMax = Math.ceil(maxData);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#6f7c93';
    for (let i = 0; i <= 4; i++) {
      const val = (yMax * i) / 4;
      const y = padT + plotH - (val / yMax) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillText(val.toFixed(1), 5, y + 4);
    }

    const drawThresh = (val, color, label) => {
      const y = padT + plotH - (val / yMax) * plotH;
      if (y < padT || y > padT + plotH) return;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(label, w - padR - 46, y - 4);
      ctx.restore();
    };
    drawThresh(state.config.vibWarnRmsMmS, 'rgba(245,158,11,0.75)', 'WARN');
    drawThresh(state.config.vibCritRmsMmS, 'rgba(239,68,68,0.8)', 'CRIT');

    const plotSeries = (arr, color, dashed, fillArea) => {
      if (arr.length < 2) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = dashed ? 1.5 : 2.2;
      if (dashed) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      let started = false;
      let firstX = padL;
      let lastX = padL;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (v === null) {
          started = false;
          continue;
        }
        const x = padL + (i / Math.max(1, arr.length - 1)) * plotW;
        const y = padT + plotH - (Math.min(v, yMax) / yMax) * plotH;
        if (!started) {
          ctx.moveTo(x, y);
          firstX = x;
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
        lastX = x;
      }
      ctx.stroke();

      if (fillArea && started) {
        ctx.lineTo(lastX, padT + plotH);
        ctx.lineTo(firstX, padT + plotH);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, 'rgba(56,189,248,0.22)');
        grad.addColorStop(1, 'rgba(56,189,248,0.0)');
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.restore();
    };

    plotSeries(oppHist, 'rgba(148,163,184,0.65)', true, false);
    const mainColor =
      side.severity === 'RED'
        ? '#ef4444'
        : side.severity === 'YELLOW'
          ? '#f59e0b'
          : side.severity === 'SHADOW'
            ? '#a78bfa'
            : '#38bdf8';
    plotSeries(mainHist, mainColor, false, true);

    ctx.fillStyle = '#6f7c93';
    ctx.fillText('Останні 90 відліків (мм/с)', padL, h - 6);
  }

  function drawFftCanvas(side, online) {
    const canvas = $('fftCanvas');
    if (!canvas) return;
    const { ctx, w, h } = prepareCanvas(canvas);

    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, w, h);

    const padL = 36;
    const padR = 12;
    const padT = 12;
    const padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const bins = online && Array.isArray(side.spectrum) ? side.spectrum : new Array(32).fill(0);
    const maxVal = Math.max(40, ...bins);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#6f7c93';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillText(String(Math.round(maxVal * (1 - i / 4))), 5, y + 4);
    }

    const barStep = plotW / 32;
    const barW = Math.max(3, barStep - 3);
    for (let b = 0; b < 32; b++) {
      const mag = Number(bins[b] || 0);
      const bh = (mag / maxVal) * plotH;
      const x = padL + b * barStep + 1.5;
      const y = padT + plotH - bh;
      const fCenter = b * 140 + 70;
      ctx.fillStyle = fCenter < 600 ? '#38bdf8' : fCenter < 2400 ? '#f59e0b' : '#ef4444';
      ctx.fillRect(x, y, barW, Math.max(1, bh));
    }

    ctx.fillStyle = '#6f7c93';
    [0, 700, 1400, 2100, 2800, 3500, 4480].forEach((hz) => {
      const x = padL + (hz / 4480) * plotW;
      ctx.fillText(`${hz}`, Math.min(w - 32, Math.max(padL, x - 12)), h - 6);
    });
  }

  // ========================================================================
  // Incidents, Black Box JSON, Config Sync & Console
  // ========================================================================
  function renderIncidents(state) {
    const list = state.incidents || [];
    const openCount = list.filter((x) => x.status === 'OPEN').length;
    const badge = $('openIncidentsCounter');
    badge.hidden = openCount === 0;
    badge.textContent = String(openCount);

    const fp = JSON.stringify(list);
    if (fp === appState.lastIncidentsKey) return;
    appState.lastIncidentsKey = fp;

    const wrap = $('incidentsContainer');
    if (list.length === 0) {
      wrap.innerHTML =
        '<div class="empty-state"><p>Інцидентів ще немає. Увімкніть сценарій <strong>«Перегрів гальма»</strong> або підключіть живі датчики.</p></div>';
      return;
    }

    wrap.innerHTML = list
      .map((t) => {
        const isClosed = t.status === 'CLOSED';
        const actionsHtml = isClosed
          ? `<span class="pill" data-state="online">Закрито: ${escapeHtml(t.resolution_code || 'OK')}</span>`
          : RESOLUTION_OPTIONS.map(
              (opt) =>
                `<button type="button" class="btn btn-sm btn-secondary" data-resolve-ticket="${escapeHtml(t.ticket_id)}" data-resolve-code="${opt.code}">${opt.label}</button>`
            ).join('');

        return `
          <article class="incident-card">
            <div class="incident-top">
              <div class="incident-id-row">
                <strong class="mono">${escapeHtml(t.ticket_id)}</strong>
                <span class="pill" data-state="${escapeHtml(t.severity)}">${escapeHtml(t.severity)}</span>
                <span class="pill">${escapeHtml(t.wheel_code)}</span>
                <span class="incident-meta">${escapeHtml(REASON_LABELS[t.reason] || t.reason)}</span>
              </div>
              <span class="incident-meta tabular">${fmtUtcTime(t.created_at_utc)} UTC</span>
            </div>
            <div class="incident-meta tabular">
              T = ${fmtNum(t.temp_c, 1)} °C · ΔT = ${fmtNum(t.temp_delta_c, 1)} °C · RMS = ${fmtNum(t.vib_rms, 2)} мм/с
            </div>
            <div class="incident-actions">${actionsHtml}</div>
          </article>
        `;
      })
      .join('');
  }

  function renderBurstViewer(state) {
    const bursts = state.burstEvents || [];
    const fp = JSON.stringify(bursts.map((b) => b.event_id)) + ':' + appState.selectedBurstIdx;
    if (fp === appState.lastBurstKey) return;
    appState.lastBurstKey = fp;

    const sel = $('burstSelector');
    const prevVal = Number(sel.value) || 0;
    sel.innerHTML =
      bursts.length === 0
        ? '<option value="0">Немає пакетів</option>'
        : bursts
            .map(
              (b, idx) =>
                `<option value="${idx}">#${idx + 1} · ${b.severity} · ${b.wheel_code} (${fmtUtcTime(b.timestamp_utc)})</option>`
            )
            .join('');

    const idx = Math.min(prevVal, Math.max(0, bursts.length - 1));
    sel.value = String(idx);
    appState.selectedBurstIdx = idx;

    $('burstJsonViewer').textContent =
      bursts.length === 0
        ? '// Очікування першого пакету ANOMALY_BURST...'
        : JSON.stringify(bursts[idx], null, 2);
  }

  function syncConfigForm(state) {
    const cfg = state.config;
    if (!cfg) return;
    $('configVersionPill').textContent = `v${cfg.configVersion}`;

    const form = $('configForm');
    if ((form && form.contains(document.activeElement)) || appState.lastConfigVersion === cfg.configVersion) {
      return;
    }
    appState.lastConfigVersion = cfg.configVersion;

    for (const [k, v] of Object.entries(cfg)) {
      const field = form.elements.namedItem(k);
      if (!field) continue;
      if (field.type === 'checkbox') field.checked = Boolean(v);
      else field.value = String(v);
    }
  }

  function readConfigFormValues() {
    const form = $('configForm');
    const out = {};
    const numKeys = [
      'tempWarnC',
      'tempCritC',
      'axleTempDeltaWarnC',
      'axleTempDeltaCritC',
      'vibWarnRmsMmS',
      'vibCritRmsMmS',
      'yellowConfirmSec',
      'redConfirmSec',
      'vrefMinMv',
      'vrefMaxMv',
    ];
    for (const k of numKeys) {
      const el = form.elements.namedItem(k);
      if (el && Number.isFinite(Number(el.value))) out[k] = Number(el.value);
    }
    const shadowEl = form.elements.namedItem('shadowModeEnabled');
    if (shadowEl) out.shadowModeEnabled = Boolean(shadowEl.checked);
    return out;
  }

  function renderConsole(state) {
    const merged = [...(state.logs || []), ...appState.localLogs]
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
      .slice(-50);

    const fp = merged.map((m) => `${m.ts}|${m.tag}|${m.text}`).join('\n');
    if (fp === appState.lastLogsKey) return;
    appState.lastLogsKey = fp;

    $('consoleCountPill').textContent = String(merged.length);
    const box = $('consoleBox');
    const stickBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 36;

    box.innerHTML = merged
      .map(
        (m) => `
        <div class="console-line">
          <span class="console-ts tabular">${fmtUtcTime(m.ts)}</span>
          <span class="console-tag">[${escapeHtml(m.tag)}]</span>
          <span class="console-text">${escapeHtml(m.text)}</span>
        </div>`
      )
      .join('');

    if (stickBottom) box.scrollTop = box.scrollHeight;
  }

  // ========================================================================
  // Event Bindings & SSE
  // ========================================================================
  function bindControls() {
    if (!('serial' in navigator)) {
      $('serialSupportBadge').textContent = 'Тільки Chrome / Edge';
      $('btnSerial1').disabled = true;
      $('btnSerial2').disabled = true;
    }

    // Rig profile selector buttons
    document.querySelectorAll('[data-rig-profile]').forEach((btn) => {
      btn.addEventListener('click', () => {
        postCommand({ action: 'config', config: { rigProfile: btn.dataset.rigProfile } });
      });
    });

    // Sensor type selectors
    $('vibSensorSelect').addEventListener('change', (e) => {
      postCommand({ action: 'config', config: { vibSensorType: e.target.value } });
    });

    $('tempSensorSelect').addEventListener('change', (e) => {
      postCommand({ action: 'config', config: { tempSensorType: e.target.value } });
    });

    $('btnSerial1').addEventListener('click', () => toggleSerialPort(1));
    $('btnSerial2').addEventListener('click', () => toggleSerialPort(2));

    $('btnResetAlerts').addEventListener('click', () => postCommand({ action: 'reset' }));
    $('btnMuteBuzzer').addEventListener('click', () => postCommand({ action: 'mute' }));
    $('btnClearState').addEventListener('click', () => {
      for (const k of WHEEL_CODES) appState.rmsHistory[k] = [];
      postCommand({ action: 'clear' });
    });

    $('btnCopyWifi').addEventListener('click', async () => {
      const url = $('wifiEndpointText').textContent;
      try {
        await navigator.clipboard.writeText(url);
        triggerIconConfirm($('copyWifiIconSwap'), $('copyWifiLabel'), 'Скопійовано', 'Копіювати');
      } catch (_) {}
    });

    $('ipPollForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (appState.latest?.source?.mode === 'ip_poll') {
        postCommand({ action: 'ip_poll', url: null });
      } else {
        const val = $('ipPollInput').value.trim();
        if (val) postCommand({ action: 'ip_poll', url: val });
      }
    });

    $('btnSimToggle').addEventListener('click', () => {
      const active = appState.latest?.source?.mode === 'simulator';
      postCommand({
        action: 'simulator',
        enabled: !active,
        scenario: $('simScenarioSelect').value,
      });
    });

    $('simScenarioSelect').addEventListener('change', () => {
      if (appState.latest?.source?.mode === 'simulator') {
        postCommand({
          action: 'simulator',
          enabled: true,
          scenario: $('simScenarioSelect').value,
        });
      }
    });

    $('btnFreezeCharts').addEventListener('click', () => {
      appState.chartsFrozen = !appState.chartsFrozen;
      $('btnFreezeCharts').setAttribute('aria-pressed', appState.chartsFrozen ? 'true' : 'false');
      $('freezeChartsLabel').textContent = appState.chartsFrozen ? 'Продовжити' : 'Пауза';
    });

    $('btnClearCharts').addEventListener('click', () => {
      for (const k of WHEEL_CODES) appState.rmsHistory[k] = [];
      if (appState.latest) renderCharts(appState.latest);
    });

    $('incidentsContainer').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-resolve-ticket]');
      if (!btn) return;
      postCommand({
        action: 'resolve_ticket',
        ticketId: btn.dataset.resolveTicket,
        resolutionCode: btn.dataset.resolveCode,
      });
    });

    $('burstSelector').addEventListener('change', (e) => {
      appState.selectedBurstIdx = Number(e.target.value) || 0;
      appState.lastBurstKey = '';
      if (appState.latest) renderBurstViewer(appState.latest);
    });

    $('btnCopyBurst').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('burstJsonViewer').textContent);
        triggerIconConfirm($('copyBurstIconSwap'), $('copyBurstLabel'), 'Скопійовано', 'Копіювати JSON');
      } catch (_) {}
    });

    $('configForm').addEventListener('submit', (e) => {
      e.preventDefault();
      postCommand({ action: 'config', config: readConfigFormValues() });
    });

    $('btnPushCfgToS3').addEventListener('click', async () => {
      const cfg = readConfigFormValues();
      await postCommand({ action: 'config', config: cfg });
      const s3Payload = {
        temp_warn_c: cfg.tempWarnC,
        temp_crit_c: cfg.tempCritC,
        axle_temp_delta_warn_c: cfg.axleTempDeltaWarnC,
        axle_temp_delta_crit_c: cfg.axleTempDeltaCritC,
        vib_warn_rms: cfg.vibWarnRmsMmS,
        vib_crit_rms: cfg.vibCritRmsMmS,
        yellow_confirm_sec: cfg.yellowConfirmSec,
        red_confirm_sec: cfg.redConfirmSec,
        shadow_mode: cfg.shadowModeEnabled,
      };
      await sendCliCommand(`cfg ${JSON.stringify(s3Payload)}`);
    });

    document.querySelectorAll('[data-cli]').forEach((btn) => {
      btn.addEventListener('click', () => sendCliCommand(btn.dataset.cli));
    });

    $('rawCommandForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('rawCommandInput');
      const val = inp.value.trim();
      if (!val) return;
      sendCliCommand(val);
      inp.value = '';
    });

    window.addEventListener('resize', () => {
      if (appState.latest) renderCharts(appState.latest);
    });
  }

  function applyState(state) {
    appState.latest = state;
    applyRigProfileVisibility(state);
    pushHistorySamples(state);
    renderTopbar(state);
    renderCabinAndS3(state);
    renderBridge(state);
    renderAxles(state);
    renderCharts(state);
    renderIncidents(state);
    renderBurstViewer(state);
    syncConfigForm(state);
    renderConsole(state);
  }

  function startSse() {
    const es = new EventSource('/api/events');
    es.onmessage = (evt) => {
      try {
        applyState(JSON.parse(evt.data));
      } catch (_) {}
    };
    es.onerror = () => {
      $('sourcePill').dataset.mode = 'waiting';
      $('sourceModeText').textContent = 'ПЕРЕПІДКЛЮЧЕННЯ...';
    };
  }

  initStaticRigDom();
  bindControls();
  startSse();
})();
