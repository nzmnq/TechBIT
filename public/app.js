'use strict';

(() => {
  const WHEEL_CODES = [
    'T1-L', 'T1-R',
    'T2-L', 'T2-R',
    'P1-L', 'P1-R',
    'P2-L', 'P2-R',
    'P3-L', 'P3-R',
  ];

  const REASON_LABELS = {
    NORMAL: 'Норма',
    TEMP_CRITICAL_BRAKE: 'Критичний перегрів гальма',
    TEMP_DELTA_HIGH: 'Перевищення ΔT на осі',
    VIB_ANOMALY_LOCAL: 'Локальна вібрація вузла',
    COBBLESTONE_FILTERED: 'Фільтр бруківки (всі осі)',
    POTHOLE_GUARD: 'Фільтр удару в яму',
    SHADOW_EARLY_DRIFT: 'Shadow Mode (ранній дрейф)',
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
    waiting: 'ОЧІКУВАННЯ ДАТЧИКІВ',
    serial: 'USB WEB SERIAL',
    wifi: 'WI-FI HTTP PUSH',
    ip_poll: 'ОПИТУВАННЯ ESP IP',
    simulator: 'СИМУЛЯТОР ЗЧІПКИ V2',
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
    activeTab: 'rig',
    selectedWheel: 'P2-L',
    chartsFrozen: false,
    selectedBurstIdx: 0,
    lastConfigVersion: -1,
    lastIncidentsKey: '',
    lastBurstKey: '',
    lastLogsKey: '',
    localLogs: [],
    rmsHistory: Object.fromEntries(WHEEL_CODES.map((code) => [code, []])),
    serialPorts: {
      1: { port: null, reader: null, writer: null, reading: false, rxCount: 0, lastLine: '' },
      2: { port: null, reader: null, writer: null, reading: false, rxCount: 0, lastLine: '' },
    },
  };

  const $ = (id) => document.getElementById(id);

  // ========================================================================
  // Helpers & Local Console Logging
  // ========================================================================
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
      if (ax.left && ax.left.code === code) {
        return { axle: ax, side: ax.left, opposite: ax.right };
      }
      if (ax.right && ax.right.code === code) {
        return { axle: ax, side: ax.right, opposite: ax.left };
      }
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
  // Tabs (instant / <=120ms high-frequency switch, ARIA compliant)
  // ========================================================================
  function switchTab(tabName) {
    appState.activeTab = tabName;
    const tabs = document.querySelectorAll('.tab-btn[role="tab"]');
    tabs.forEach((btn) => {
      const selected = btn.dataset.tab === tabName;
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    const panels = document.querySelectorAll('.tab-panel[role="tabpanel"]');
    panels.forEach((panel) => {
      panel.hidden = panel.id !== `panel-${tabName}`;
    });
    if (tabName === 'charts' && appState.latest) {
      renderCharts(appState.latest);
    }
  }

  function bindTabs() {
    const tabs = Array.from(document.querySelectorAll('.tab-btn[role="tab"]'));
    tabs.forEach((btn, idx) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          const next = tabs[(idx + 1) % tabs.length];
          next.focus();
          switchTab(next.dataset.tab);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
          prev.focus();
          switchTab(prev.dataset.tab);
        }
      });
    });
  }

  // ========================================================================
  // Build Persistent DOM Skeleton for 5 Axles (10 Wheels) + Wheel Selector
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
    return `
      <button type="button" class="wheel-tile" id="wheel-tile-${code}" data-code="${code}" data-severity="OFFLINE" aria-pressed="${pressed}">
        <div class="wheel-top">
          <span class="wheel-code-tag">${code}</span>
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
            <span class="wheel-kpi-sub tabular" id="wheel-rh-${code}">SHT40 —</span>
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
      [1, 'T1', 'Тягач • Передня вісь', 'T1-L', 'T1-R'],
      [2, 'T2', 'Тягач • Задня вісь', 'T2-L', 'T2-R'],
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
      tile.addEventListener('dblclick', () => {
        selectWheel(tile.dataset.code);
        switchTab('charts');
      });
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
    if (appState.latest) {
      renderCharts(appState.latest);
    }
  }

  // ========================================================================
  // Dual Concurrent Web Serial (Port 1 & Port 2)
  // ========================================================================
  async function writeSerialLine(portIdx, line) {
    const slot = appState.serialPorts[portIdx];
    if (!slot || !slot.writer) return false;
    try {
      const data = new TextEncoder().encode(`${line.trim()}\n`);
      await slot.writer.write(data);
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
      if (slot.writer) {
        slot.writer.releaseLock();
      }
    } catch (_) {}
    try {
      if (slot.port) {
        await slot.port.close();
      }
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
      pushLocalLog('USB', 'Web Serial підтримується у Chrome / Edge. Використовуйте Wi-Fi Push або IP Poll.');
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
      if (port.writable) {
        slot.writer = port.writable.getWriter();
      }
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
          if (!line) continue;
          handleSerialLine(portIdx, line);
        }
      }
    } catch (err) {
      if (err && err.name !== 'NotFoundError') {
        pushLocalLog(`USB${portIdx}`, `Помилка Serial: ${err.message}`);
      }
    } finally {
      if (slot.port) {
        await disconnectSerialPort(portIdx);
      }
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
      if (slotOverride !== 'auto') json._slotOverride = Number(slotOverride);

      const resp = await fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });
      if (resp.ok) {
        const ack = await resp.json();
        if (Array.isArray(ack.commands)) {
          for (const cmd of ack.commands) {
            await writeSerialLine(portIdx, cmd);
          }
        }
      }
    } catch (_) {
      pushLocalLog(`USB${portIdx}`, trimmed);
    }
  }

  // ========================================================================
  // State Rendering (In-place updates, zero flicker)
  // ========================================================================
  function renderTopbar(state) {
    $('couplingIdsLabel').textContent = `${state.tractorId} + ${state.trailerId}`;

    const mode = state.source?.mode || 'waiting';
    const pill = $('sourcePill');
    pill.dataset.mode = mode;
    $('sourceModeText').textContent = SOURCE_LABELS[mode] || mode.toUpperCase();

    $('ppsValue').textContent = `${state.source?.packetsPerSec ?? 0} pkt/s`;
    $('totalPktsValue').textContent = String(state.source?.packetCount ?? 0);
    $('utcClock').textContent = `${fmtUtcTime(state.tsUtc)} UTC`;

    const wifiUrls = state.source?.wifiUrls || [];
    if (wifiUrls.length > 0) {
      $('wifiEndpointText').textContent = wifiUrls[0];
    }

    const simActive = mode === 'simulator';
    const simBadge = $('simStateBadge');
    simBadge.textContent = simActive ? `Активний (${state.source.simScenario})` : 'Вимкнено';
    simBadge.dataset.active = simActive ? 'true' : 'false';
    const simBtn = $('btnSimToggle');
    simBtn.setAttribute('aria-pressed', simActive ? 'true' : 'false');
    $('simIconSwap').dataset.active = simActive ? 'true' : 'false';
    $('simBtnLabel').textContent = simActive ? 'Стоп' : 'Старт';

    const pollActive = mode === 'ip_poll';
    const pollBadge = $('pollStateBadge');
    pollBadge.textContent = pollActive ? 'Активний' : 'Вимкнено';
    pollBadge.dataset.active = pollActive ? 'true' : 'false';
    $('btnIpPoll').textContent = pollActive ? 'Зупинити' : 'Опитувати';
    if (state.source?.espPollError) {
      $('ipPollHint').textContent = `Помилка опитування: ${state.source.espPollError}`;
    } else if (pollActive && state.source?.espPollUrl) {
      $('ipPollHint').textContent = `Опитування: ${state.source.espPollUrl}`;
    } else {
      $('ipPollHint').textContent = 'Живий пакет з USB або Wi-Fi автоматично має пріоритет.';
    }
  }

  function renderCabinBar(state) {
    const ind = state.indicator;
    const s3 = state.s3Master;
    const unit = $('cabinLedUnit');
    unit.dataset.severity = ind.driverSeverity;

    $('driverSeverityText').textContent = SEVERITY_LABELS[ind.driverSeverity] || ind.driverSeverity;
    if (ind.driverSeverity === 'RED') {
      $('driverSeverityHint').textContent = ind.buzzerOn
        ? `АКТИВНИЙ ЗУМЕР · Перевірте колесо ${ind.wheelCode} негайно!`
        : `Критична тривога ${ind.wheelCode} (зумер приглушено)`;
    } else if (ind.driverSeverity === 'YELLOW') {
      $('driverSeverityHint').textContent = `Стійка аномалія (> ${state.config.yellowConfirmSec} с) на ${ind.wheelCode}. Заплануйте огляд.`;
    } else if (ind.driverSeverity === 'GREEN') {
      $('driverSeverityHint').textContent = ind.roughRoadActive
        ? 'Бруківка / нерівна дорога розпізнана — хибні тривоги подавлено.'
        : 'Усі активні осі працюють стабільно. Водій не відволікається.';
    } else {
      $('driverSeverityHint').textContent = 'Підключіть плату ESP32 по USB/Wi-Fi або запустіть симулятор.';
    }

    $('driverWheelCode').textContent = ind.wheelCode || '—';
    $('activeWheelsChip').textContent = `${ind.activeWheels} / 10`;

    const shadowChip = $('shadowChip');
    $('shadowCountChip').textContent = String(ind.shadowCount);
    shadowChip.dataset.highlight = ind.shadowCount > 0 ? 'shadow' : '';

    const roadChip = $('roadChip');
    $('roadStateChip').textContent = ind.roughRoadActive ? 'Бруківка' : 'Рівна';
    roadChip.dataset.highlight = ind.roughRoadActive ? 'rough' : '';

    $('potholeCountChip').textContent = String(ind.potholeCount);
    $('lteBleChip').textContent = `${s3.lteOnline ? 'LTE' : 'OFF'} / ${s3.bleActive ? '15м' : 'OFF'}`;
    $('blackBoxChip').textContent = `${s3.blackBoxRecs} зап.`;

    const muteBtn = $('btnMuteBuzzer');
    muteBtn.setAttribute('aria-pressed', s3.buzzerMuted ? 'true' : 'false');
    $('muteIconSwap').dataset.active = s3.buzzerMuted ? 'true' : 'false';
    $('muteLabel').textContent = s3.buzzerMuted ? 'Без звуку' : 'Зумер';
  }

  function renderBridge(state) {
    const br = state.bridge;
    $('bridgeConnector').dataset.online = br.online ? 'true' : 'false';
    const pill = $('bridgeStatusPill');
    pill.dataset.state = br.online ? 'online' : 'offline';
    pill.textContent = br.online ? 'ONLINE' : 'OFFLINE';

    $('bridgeTrailerId').textContent = br.trailerId || state.trailerId;
    $('bridgePairedText').textContent = br.online ? (br.paired ? 'Спарено (AES-128)' : 'Пошук') : 'Немає зв’язку';
    $('bridgeRssiText').textContent = br.online && br.rssi !== null ? `${br.rssi} dBm` : '—';
    $('bridgeCanText').textContent = `${br.nodeCount} вузл. / ${br.canRx}`;
    $('bridgeSeqText').textContent = String(br.seq || 0);
  }

  function renderWheelSide(side, online) {
    const tile = $(`wheel-tile-${side.code}`);
    if (!tile) return;

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
      $(`wheel-rh-${side.code}`).textContent = 'SHT40 —';
      const vrefEl = $(`wheel-vref-${side.code}`);
      vrefEl.textContent = 'Vref —';
      vrefEl.dataset.warn = 'false';
      $(`wheel-crest-${side.code}`).textContent = 'Crest —';
      $(`wheel-clip-${side.code}`).hidden = true;
      return;
    }

    $(`wheel-rms-${side.code}`).textContent = `${fmtNum(side.rmsMmS, 2)} мм/с`;
    $(`wheel-mv-${side.code}`).textContent = `${fmtNum(side.rmsMv, 1)} мВ · ${Math.round(side.fDomHz || 0)} Гц`;
    $(`wheel-temp-${side.code}`).textContent = side.tempC !== null ? `${fmtNum(side.tempC, 1)} °C` : '—';

    const rhEl = $(`wheel-rh-${side.code}`);
    if (!side.shtOk) {
      rhEl.textContent = 'SHT40 ПОМИЛКА I2C';
    } else if (side.rh !== null) {
      rhEl.textContent = side.humidityWarn
        ? `RH ${fmtNum(side.rh, 0)}% · КОНДЕНСАТ`
        : `SHT40 · RH ${fmtNum(side.rh, 0)}%`;
    } else {
      rhEl.textContent = 'SHT40 OK';
    }

    const vrefEl = $(`wheel-vref-${side.code}`);
    if (side.dcOffsetMv !== null) {
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
      dtPill.textContent = ax.online ? `ΔT ${fmtNum(ax.tempDeltaC, 1)} °C` : 'ΔT —';
      dtPill.dataset.state = !ax.online
        ? 'OFFLINE'
        : ax.tempDeltaC >= state.config.axleTempDeltaCritC
          ? 'RED'
          : ax.tempDeltaC >= state.config.axleTempDeltaWarnC
            ? 'YELLOW'
            : 'GREEN';

      const reasonPill = $(`axle-reason-${ax.slot}`);
      const reasonText = ax.online ? (REASON_LABELS[ax.lastReason] || ax.lastReason) : 'OFFLINE';
      reasonPill.textContent = reasonText;
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
      busPill.textContent = ax.online
        ? `I2C ${ax.i2c?.addr || '—'} · CAN ${ax.can?.ready ? 'OK' : '—'}`
        : 'I2C — · CAN —';
      busPill.dataset.state = ax.online && ax.i2c?.err === 0 ? 'online' : 'offline';

      renderWheelSide(ax.left, ax.online);
      renderWheelSide(ax.right, ax.online);
    }
  }

  // ========================================================================
  // RMS History & HiDPI Canvas Rendering (Oscilloscope + 32-Bin FFT)
  // ========================================================================
  function pushHistorySamples(state) {
    if (appState.chartsFrozen) return;
    for (const ax of state.axles) {
      for (const side of [ax.left, ax.right]) {
        const hist = appState.rmsHistory[side.code];
        if (!hist) continue;
        hist.push(ax.online ? Number(side.rmsMmS || 0) : null);
        if (hist.length > 90) hist.shift();
      }
    }
  }

  function prepareCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(300, Math.round(rect.width || 720));
    const h = Math.max(200, Math.round(rect.height || 255));
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
    const online = axle.online;

    $('selWheelCode').textContent = side.code;
    $('selRmsMmS').textContent = online ? `${fmtNum(side.rmsMmS, 2)} мм/с` : 'OFFLINE';
    $('selRmsMv').textContent = online ? `${fmtNum(side.rmsMv, 1)} мВ` : '—';
    $('selPeakCrest').textContent = online ? `${fmtNum(side.peakMmS, 1)} / ${fmtNum(side.crest, 2)}` : '—';
    $('selFdom').textContent = online ? `${Math.round(side.fDomHz || 0)} Гц` : '—';
    $('selTempDelta').textContent = online ? `${fmtNum(side.tempC, 1)} °C / Δ${fmtNum(axle.tempDeltaC, 1)}` : '—';
    $('selHumidity').textContent = online && side.shtOk && side.rh !== null ? `${fmtNum(side.rh, 1)}%` : (online ? 'I2C ERR' : '—');
    $('selVref').textContent = online && side.dcOffsetMv !== null ? `${Math.round(side.dcOffsetMv)} мВ (${side.vrefStatus})` : '—';

    $('rmsThresholdTag').textContent = `Поріг: ${state.config.vibWarnRmsMmS} / ${state.config.vibCritRmsMmS} мм/с`;
    $('rmsChartLegend').textContent = `Суцільна — ${side.code} · Пунктир — ${opposite.code} (та сама вісь)`;
    $('fftPeakTag').textContent = online ? `fDom: ${Math.round(side.fDomHz || 0)} Гц` : 'fDom: — Гц';

    if (appState.activeTab !== 'charts') return;
    drawRmsCanvas(state, side, opposite);
    drawFftCanvas(side, online);
  }

  function drawRmsCanvas(state, side, opposite) {
    const canvas = $('rmsCanvas');
    if (!canvas) return;
    const { ctx, w, h } = prepareCanvas(canvas);

    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, w, h);

    const padL = 44;
    const padR = 14;
    const padT = 14;
    const padB = 26;
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

    // Grid
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
      ctx.fillText(val.toFixed(1), 6, y + 4);
    }

    // Warn & Crit threshold lines
    const drawThresh = (val, color, label) => {
      const y = padT + plotH - (val / yMax) * plotH;
      if (y < padT || y > padT + plotH) return;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(label, w - padR - 54, y - 4);
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
    ctx.fillText('Останні 90 відліків (мм/с)', padL, h - 7);
  }

  function drawFftCanvas(side, online) {
    const canvas = $('fftCanvas');
    if (!canvas) return;
    const { ctx, w, h } = prepareCanvas(canvas);

    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, w, h);

    const padL = 38;
    const padR = 14;
    const padT = 14;
    const padB = 26;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const bins = online && Array.isArray(side.spectrum) ? side.spectrum : new Array(32).fill(0);
    const maxVal = Math.max(40, ...bins);

    // Horizontal grid
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
      const label = Math.round(maxVal * (1 - i / 4));
      ctx.fillText(String(label), 6, y + 4);
    }

    const barStep = plotW / 32;
    const barW = Math.max(3, barStep - 3);
    for (let b = 0; b < 32; b++) {
      const mag = Number(bins[b] || 0);
      const bh = (mag / maxVal) * plotH;
      const x = padL + b * barStep + 1.5;
      const y = padT + plotH - bh;
      const fCenter = b * 140 + 70;

      // Color by physical frequency band: road / bearing / brake friction
      ctx.fillStyle =
        fCenter < 600
          ? '#38bdf8'
          : fCenter < 2400
            ? '#f59e0b'
            : '#ef4444';
      ctx.fillRect(x, y, barW, Math.max(1, bh));
    }

    // Frequency ticks along X axis
    ctx.fillStyle = '#6f7c93';
    const ticks = [0, 700, 1400, 2100, 2800, 3500, 4480];
    ticks.forEach((hz) => {
      const x = padL + (hz / 4480) * plotW;
      ctx.fillText(`${hz}`, Math.min(w - 34, Math.max(padL, x - 12)), h - 7);
    });
  }

  // ========================================================================
  // Panel 3: Incidents & Black Box ANOMALY_BURST
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
        '<div class="empty-state"><p>Інцидентів ще не зафіксовано. Увімкніть сценарій <strong>«Заклинило гальмо P2-L»</strong> або <strong>«Shadow Mode»</strong>, або підключіть реальний датчик.</p></div>';
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
              ${escapeHtml(t.axle_label)} · T = ${fmtNum(t.temp_c, 1)} °C · ΔT = ${fmtNum(t.temp_delta_c, 1)} °C · RMS = ${fmtNum(t.vib_rms, 2)} мм/с
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

    const viewer = $('burstJsonViewer');
    if (bursts.length === 0) {
      viewer.textContent = '// Очікування першого пакету ANOMALY_BURST від S3 Master або Rule Engine...';
    } else {
      viewer.textContent = JSON.stringify(bursts[idx], null, 2);
    }
  }

  // ========================================================================
  // Panel 4: Config Sync & Console
  // ========================================================================
  function syncConfigForm(state) {
    const cfg = state.config;
    if (!cfg) return;
    $('configVersionPill').textContent = `v${cfg.configVersion}`;

    const form = $('configForm');
    const editingForm = form && form.contains(document.activeElement);
    if (editingForm || appState.lastConfigVersion === cfg.configVersion) return;
    appState.lastConfigVersion = cfg.configVersion;

    for (const [k, v] of Object.entries(cfg)) {
      const field = form.elements.namedItem(k);
      if (!field) continue;
      if (field.type === 'checkbox') {
        field.checked = Boolean(v);
      } else {
        field.value = String(v);
      }
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
      'humidityWarnPct',
    ];
    for (const k of numKeys) {
      const el = form.elements.namedItem(k);
      if (el && Number.isFinite(Number(el.value))) {
        out[k] = Number(el.value);
      }
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

    $('consoleCountPill').textContent = `${merged.length} записів`;
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
  // Event Bindings & SSE Stream
  // ========================================================================
  function bindControls() {
    if (!('serial' in navigator)) {
      $('serialSupportBadge').textContent = 'Тільки Chrome / Edge';
      $('btnSerial1').disabled = true;
      $('btnSerial2').disabled = true;
    }

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
      } catch (_) {
        pushLocalLog('COPY', url);
      }
    });

    $('ipPollForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const active = appState.latest?.source?.mode === 'ip_poll';
      if (active) {
        postCommand({ action: 'ip_poll', url: null });
      } else {
        const val = $('ipPollInput').value.trim();
        if (!val) return;
        postCommand({ action: 'ip_poll', url: val });
      }
    });

    $('btnSimToggle').addEventListener('click', () => {
      const active = appState.latest?.source?.mode === 'simulator';
      const scenario = $('simScenarioSelect').value;
      postCommand({ action: 'simulator', enabled: !active, scenario });
    });

    $('simScenarioSelect').addEventListener('change', () => {
      if (appState.latest?.source?.mode === 'simulator') {
        postCommand({ action: 'simulator', enabled: true, scenario: $('simScenarioSelect').value });
      }
    });

    $('btnFreezeCharts').addEventListener('click', () => {
      appState.chartsFrozen = !appState.chartsFrozen;
      const btn = $('btnFreezeCharts');
      btn.setAttribute('aria-pressed', appState.chartsFrozen ? 'true' : 'false');
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
      const txt = $('burstJsonViewer').textContent;
      try {
        await navigator.clipboard.writeText(txt);
        triggerIconConfirm($('copyBurstIconSwap'), $('copyBurstLabel'), 'Скопійовано', 'Копіювати JSON');
      } catch (_) {}
    });

    $('configForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const cfg = readConfigFormValues();
      postCommand({ action: 'config', config: cfg });
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

    $('btnSendTractorId').addEventListener('click', () => {
      const val = $('cliTractorId').value.trim();
      if (val) sendCliCommand(`tractor ${val}`);
    });

    $('btnSendTrailerId').addEventListener('click', () => {
      const val = $('cliTrailerId').value.trim();
      if (val) sendCliCommand(`trailer ${val}`);
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
      if (appState.activeTab === 'charts' && appState.latest) {
        renderCharts(appState.latest);
      }
    });
  }

  function applyState(state) {
    appState.latest = state;
    pushHistorySamples(state);
    renderTopbar(state);
    renderCabinBar(state);
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
        const state = JSON.parse(evt.data);
        applyState(state);
      } catch (_) {}
    };
    es.onerror = () => {
      $('sourcePill').dataset.mode = 'waiting';
      $('sourceModeText').textContent = 'ПЕРЕПІДКЛЮЧЕННЯ SSE...';
    };
  }

  // Bootstrap
  initStaticRigDom();
  bindTabs();
  bindControls();
  startSse();
})();
