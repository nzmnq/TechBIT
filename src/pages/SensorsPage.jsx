import React, { useState } from 'react';
import {
  REASON_LABELS,
  S3_LINK_OPTIONS,
  S3_MODE_OPTIONS,
  TEMP_OPTIONS,
  VIB_OPTIONS,
  fmtNum,
  getS3LinkShort,
  getS3ModeShort,
  getTempShort,
  getVibShort,
  useWorkbench,
} from '../context/WorkbenchContext';
import {
  CheckIcon,
  CopyIcon,
  CpuIcon,
  GlobeIcon,
  IconSwap,
  PlayIcon,
  PlugIcon,
  RadioIcon,
  SlidersIcon,
  StopIcon,
  UsbIcon,
  WifiIcon,
} from '../components/Icons';
import LiveCharts from '../components/LiveCharts';

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

function WheelCard({ side, sensorCfg, selected, onSelect }) {
  const online = Boolean(side.online);
  const sev = online ? side.severity : 'OFFLINE';

  return (
    <button
      type="button"
      className="wheel-tile"
      data-side={side.side}
      data-severity={sev}
      aria-pressed={selected}
      onClick={() => onSelect(side.code)}
    >
      <div className="wheel-top">
        <div className="wheel-title-side">
          <div className="wheel-code-line">
            <span className="side-accent-bar" data-side={side.side} aria-hidden="true" />
            <span className="wheel-code-tag">{side.code}</span>
          </div>
          <span className="wheel-side-caption">
            {WHEEL_CAPTIONS[side.code] || side.code} · {getVibShort(sensorCfg.vib)} / {getTempShort(sensorCfg.temp)}
          </span>
        </div>
        <span className="pill" data-state={sev}>
          {sev}
        </span>
      </div>

      <div className="wheel-primary-grid">
        <div className="wheel-kpi">
          <span className="wheel-kpi-label">Вібрація RMS</span>
          <span className="wheel-kpi-val tabular">
            {online ? `${fmtNum(side.rmsMmS, 2)} мм/с` : '—'}
          </span>
          <span className="wheel-kpi-sub tabular">
            {online ? `${fmtNum(side.rmsMv, 1)} мВ · ${Math.round(side.fDomHz || 0)} Гц` : '— мВ · fDom —'}
          </span>
        </div>

        <div className="wheel-kpi">
          <span className="wheel-kpi-label">Температура</span>
          <span className="wheel-kpi-val tabular">
            {online && side.tempC !== null ? `${fmtNum(side.tempC, 1)} °C` : '—'}
          </span>
          <span className="wheel-kpi-sub tabular">
            {!online
              ? sensorCfg.temp === 'ntc'
                ? 'NTC ADC —'
                : 'SHT40 —'
              : sensorCfg.temp === 'ntc'
                ? 'NTC 10k ADC OK'
                : !side.shtOk
                  ? 'SHT40 ПОМИЛКА I2C'
                  : side.rh !== null
                    ? side.humidityWarn
                      ? `RH ${fmtNum(side.rh, 0)}% · КОНДЕНСАТ`
                      : `SHT40 · RH ${fmtNum(side.rh, 0)}%`
                    : 'SHT40 OK'}
          </span>
        </div>
      </div>

      <div className="wheel-hw-row">
        <span
          className="hw-tag tabular"
          data-warn={online && sensorCfg.vib === 'piezo_mcp6002' && side.vrefStatus === 'FAULT' ? 'true' : 'false'}
        >
          {sensorCfg.vib !== 'piezo_mcp6002'
            ? getVibShort(sensorCfg.vib)
            : online && side.dcOffsetMv !== null
              ? `Vref ${Math.round(side.dcOffsetMv)} мВ${side.vrefStatus === 'FAULT' ? ' !' : ''}`
              : 'Vref —'}
        </span>
        <span className="hw-tag tabular">
          {online ? `Crest ${fmtNum(side.crest, 2)}` : 'Crest —'}
        </span>
        {online && side.clip && (
          <span className="hw-tag" data-info="true">
            BAT54S CLIP
          </span>
        )}
      </div>
    </button>
  );
}

function AxleBlock({ axle, config, selectedWheel, onSelectWheel }) {
  const bothOnline = axle.left.online && axle.right.online;
  const dtState = !bothOnline
    ? 'OFFLINE'
    : axle.tempDeltaC >= config.axleTempDeltaCritC
      ? 'RED'
      : axle.tempDeltaC >= config.axleTempDeltaWarnC
        ? 'YELLOW'
        : 'GREEN';

  const reasonState = !axle.online
    ? 'OFFLINE'
    : axle.redLatched
      ? 'RED'
      : axle.yellowLatched
        ? 'YELLOW'
        : axle.shadowTriggered
          ? 'SHADOW'
          : 'GREEN';

  const leftCfg =
    axle.slot === 1
      ? config.moduleSensors.frontLeft
      : { vib: config.vibSensorType, temp: config.tempSensorType };
  const rightCfg =
    axle.slot === 1
      ? config.moduleSensors.frontRight
      : { vib: config.vibSensorType, temp: config.tempSensorType };

  const bothNtc = leftCfg.temp === 'ntc' && rightCfg.temp === 'ntc';

  return (
    <article className="axle-card" data-online={axle.online ? 'true' : 'false'}>
      <div className="axle-head">
        <div className="axle-head-left">
          <span className="axle-slot-badge">{axle.key}</span>
          <span className="axle-name">{axle.slot === 1 ? 'Передня вісь (Ліве + Праве)' : axle.label}</span>
          <span className="axle-node-id">
            {axle.nodeId ? `${axle.nodeId} · ${axle.rxCount} pkt` : 'Не підключено'}
          </span>
        </div>
        <div className="axle-head-right">
          <span className="pill tabular" data-state={dtState}>
            {bothOnline ? `ΔT ${fmtNum(axle.tempDeltaC, 1)} °C` : 'ΔT —'}
          </span>
          <span className="pill" data-state={reasonState}>
            {axle.online ? REASON_LABELS[axle.lastReason] || axle.lastReason : 'OFFLINE'}
          </span>
          <span
            className="pill"
            data-state={axle.online && (bothNtc || axle.i2c?.err === 0) ? 'online' : 'offline'}
          >
            {axle.online ? `${bothNtc ? 'NTC' : `I2C ${axle.i2c?.addr || '—'}`} · CAN ${axle.can?.ready ? 'OK' : '—'}` : 'I2C — · CAN —'}
          </span>
        </div>
      </div>

      <div className="wheels-pair">
        <WheelCard
          side={axle.left}
          sensorCfg={leftCfg}
          selected={selectedWheel === axle.left.code}
          onSelect={onSelectWheel}
        />
        <WheelCard
          side={axle.right}
          sensorCfg={rightCfg}
          selected={selectedWheel === axle.right.code}
          onSelect={onSelectWheel}
        />
      </div>
    </article>
  );
}

export default function SensorsPage() {
  const {
    state,
    selectedWheel,
    setSelectedWheel,
    simScenario,
    setSimScenario,
    serialSupported,
    serialSlots,
    setSerialSlots,
    serialMeta,
    toggleSerialPort,
    postCommand,
    updateConfig,
    updateModuleSensor,
    sendCliCommand,
  } = useWorkbench();

  const [ipInput, setIpInput] = useState('');
  const [copiedWifi, setCopiedWifi] = useState(false);

  const cfg = state?.config || {
    rigProfile: 'mvp_front',
    vibSensorType: 'piezo_mcp6002',
    tempSensorType: 'sht40',
    axleTempDeltaWarnC: 18,
    axleTempDeltaCritC: 35,
    moduleSensors: {
      frontLeft: { vib: 'piezo_mcp6002', temp: 'sht40' },
      frontRight: { vib: 'piezo_mcp6002', temp: 'sht40' },
      s3Master: { mode: 's3_can_lte_led', link: 'can_500k' },
    },
  };
  const profile = state?.profile || { id: 'mvp_front', slots: [1], hasBridge: false, expectedWheels: 2 };
  const source = state?.source || { mode: 'waiting', packetCount: 0, wifiUrls: [] };
  const s3 = state?.s3Master || { online: false, deviceId: 'S3_MASTER_MVP', lteOnline: false, bleActive: false, blackBoxRecs: 0, pendingQueue: 0 };
  const bridge = state?.bridge || { online: false, trailerId: 'TL_042', paired: false, rssi: null, nodeCount: 0, seq: 0 };
  const axles = state?.axles || [];

  const tractorAxles = axles.filter((a) => a.asset === 'tractor' && profile.slots.includes(a.slot));
  const trailerAxles = axles.filter((a) => a.asset === 'trailer' && profile.slots.includes(a.slot));

  const wifiUrl = source.wifiUrls?.[0] || 'http://localhost:5050/api/telemetry';
  const simActive = source.mode === 'simulator';
  const pollActive = source.mode === 'ip_poll';

  const handleCopyWifi = async () => {
    try {
      await navigator.clipboard.writeText(wifiUrl);
      setCopiedWifi(true);
      setTimeout(() => setCopiedWifi(false), 1600);
    } catch (_) {}
  };

  const handleIpPoll = (e) => {
    e.preventDefault();
    if (pollActive) {
      postCommand({ action: 'ip_poll', url: null });
    } else if (ipInput.trim()) {
      postCommand({ action: 'ip_poll', url: ipInput.trim() });
    }
  };

  const handleSimToggle = () => {
    postCommand({ action: 'simulator', enabled: !simActive, scenario: simScenario });
  };

  const handleScenarioChange = (nextScenario) => {
    setSimScenario(nextScenario);
    if (simActive) {
      postCommand({ action: 'simulator', enabled: true, scenario: nextScenario });
    }
  };

  const syncRightFromLeft = () => {
    updateConfig({
      moduleSensors: {
        frontRight: {
          vib: cfg.moduleSensors.frontLeft.vib,
          temp: cfg.moduleSensors.frontLeft.temp,
        },
      },
    });
  };

  return (
    <div className="page-stack">
      {/* SECTION 1: RIG PROFILE + PER-MODULE SENSOR PICKER (T1-L, T1-R, S3 MASTER) */}
      <section className="surface module-config-panel" aria-label="Конфігурація датчиків по модулях">
        <div className="module-config-top">
          <div className="panel-title-inline">
            <SlidersIcon />
            <div>
              <h2>Конфігурація стенду та типів датчиків</h2>
              <p className="panel-sub">
                Оберіть тип датчиків незалежно для лівого переднього, правого переднього та головного модуля S3.
              </p>
            </div>
          </div>

          <div className="profile-switcher-row">
            <div className="seg-control" role="group" aria-label="Профіль кількості коліс">
              <button
                type="button"
                className="seg-btn"
                aria-pressed={cfg.rigProfile === 'mvp_front'}
                onClick={() => updateConfig({ rigProfile: 'mvp_front' })}
              >
                MVP: Перед L/R + S3
              </button>
              <button
                type="button"
                className="seg-btn"
                aria-pressed={cfg.rigProfile === 'tractor_4'}
                onClick={() => updateConfig({ rigProfile: 'tractor_4' })}
              >
                Тягач: 4 колеса
              </button>
              <button
                type="button"
                className="seg-btn"
                aria-pressed={cfg.rigProfile === 'full_10'}
                onClick={() => updateConfig({ rigProfile: 'full_10' })}
              >
                Зчіпка: 10 коліс
              </button>
            </div>

            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={syncRightFromLeft}
              title="Скопіювати налаштування датчиків з Лівого на Праве"
            >
              L → R
            </button>
          </div>
        </div>

        <div className="modules-picker-grid">
          {/* Module 1: Front Left (T1-L) */}
          <div className="module-picker-card" data-tone="cyan">
            <div className="module-picker-head">
              <span className="module-tag" data-tone="cyan">T1-L</span>
              <strong>Ліве переднє колесо</strong>
            </div>
            <div className="module-picker-fields">
              <label className="field">
                <span>Датчик вібрації</span>
                <select
                  className="select"
                  value={cfg.moduleSensors.frontLeft.vib}
                  onChange={(e) => updateModuleSensor('frontLeft', 'vib', e.target.value)}
                >
                  {VIB_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Датчик температури</span>
                <select
                  className="select"
                  value={cfg.moduleSensors.frontLeft.temp}
                  onChange={(e) => updateModuleSensor('frontLeft', 'temp', e.target.value)}
                >
                  {TEMP_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Module 2: Front Right (T1-R) */}
          <div className="module-picker-card" data-tone="rose">
            <div className="module-picker-head">
              <span className="module-tag" data-tone="rose">T1-R</span>
              <strong>Праве переднє колесо</strong>
            </div>
            <div className="module-picker-fields">
              <label className="field">
                <span>Датчик вібрації</span>
                <select
                  className="select"
                  value={cfg.moduleSensors.frontRight.vib}
                  onChange={(e) => updateModuleSensor('frontRight', 'vib', e.target.value)}
                >
                  {VIB_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Датчик температури</span>
                <select
                  className="select"
                  value={cfg.moduleSensors.frontRight.temp}
                  onChange={(e) => updateModuleSensor('frontRight', 'temp', e.target.value)}
                >
                  {TEMP_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Module 3: Main S3 Master Module */}
          <div className="module-picker-card" data-tone="indigo">
            <div className="module-picker-head">
              <span className="module-tag" data-tone="indigo">S3</span>
              <strong>Головний модуль (Кабіна)</strong>
            </div>
            <div className="module-picker-fields">
              <label className="field">
                <span>Конфігурація модуля S3</span>
                <select
                  className="select"
                  value={cfg.moduleSensors.s3Master.mode}
                  onChange={(e) => updateModuleSensor('s3Master', 'mode', e.target.value)}
                >
                  {S3_MODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Шина прийому телеметрії</span>
                <select
                  className="select"
                  value={cfg.moduleSensors.s3Master.link}
                  onChange={(e) => updateModuleSensor('s3Master', 'link', e.target.value)}
                >
                  {S3_LINK_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: 4 SYMMETRIC CONNECTION & SIMULATOR CARDS */}
      <section className="controls-grid" aria-label="Підключення плат та симулятор">
        {/* USB Serial 2 Ports */}
        <article className="control-card surface">
          <div className="control-head">
            <div className="control-title">
              <UsbIcon />
              <h2>USB-C Web Serial</h2>
            </div>
            <span className="control-badge">
              {serialSupported ? '115200 baud' : 'Chrome / Edge'}
            </span>
          </div>

          <div className="port-stack">
            {[1, 2].map((portIdx) => (
              <div
                key={portIdx}
                className="port-row"
                data-connected={serialMeta[portIdx].connected ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className="btn btn-sm btn-primary btn-icon-start"
                  disabled={!serialSupported}
                  onClick={() => toggleSerialPort(portIdx)}
                >
                  <PlugIcon />
                  <span>{serialMeta[portIdx].connected ? `Відкл. ${portIdx}` : `USB ${portIdx}`}</span>
                </button>
                <select
                  className="select select-sm"
                  aria-label={`Призначення USB порту ${portIdx}`}
                  value={serialSlots[portIdx]}
                  onChange={(e) =>
                    setSerialSlots((prev) => ({ ...prev, [portIdx]: e.target.value }))
                  }
                >
                  <option value="auto">Авто (JSON)</option>
                  <option value="T1-L">T1-L · Ліве пер.</option>
                  <option value="T1-R">T1-R · Праве пер.</option>
                  <option value="1">T1 · Вся вісь</option>
                  <option value="s3">S3 · Головний</option>
                  <option value="2">T2 · Тягач зад.</option>
                  <option value="3">P1 · Причеп 1</option>
                  <option value="4">P2 · Причеп 2</option>
                  <option value="5">P3 · Причеп 3</option>
                </select>
                <span className="port-status tabular">
                  {serialMeta[portIdx].connected ? `${serialMeta[portIdx].rxCount} pkt` : 'Вільний'}
                </span>
              </div>
            ))}
          </div>
        </article>

        {/* Wi-Fi HTTP Push */}
        <article className="control-card surface">
          <div className="control-head">
            <div className="control-title">
              <WifiIcon />
              <h2>Wi-Fi HTTP Push</h2>
            </div>
            <span className="control-badge">POST JSON</span>
          </div>
          <p className="control-desc">
            Приймає <code>techbit_c3_node</code>, <code>techbit_s3_master</code>,{' '}
            <code>techbit_trailer_bridge</code> та legacy <code>techbit_node</code>.
          </p>
          <div className="copy-row">
            <code className="endpoint-box" title={wifiUrl}>{wifiUrl}</code>
            <button
              type="button"
              className="btn btn-sm btn-secondary btn-icon-start"
              onClick={handleCopyWifi}
            >
              <IconSwap
                active={copiedWifi}
                inactiveIcon={<CopyIcon />}
                activeIcon={<CheckIcon />}
              />
              <span>{copiedWifi ? 'Є' : 'Копія'}</span>
            </button>
          </div>
        </article>

        {/* ESP32 IP Polling */}
        <article className="control-card surface">
          <div className="control-head">
            <div className="control-title">
              <GlobeIcon />
              <h2>Опитування по IP</h2>
            </div>
            <span className="control-badge" data-active={pollActive ? 'true' : 'false'}>
              {pollActive ? 'Активний' : 'Вимкнено'}
            </span>
          </div>
          <p className="control-desc">
            Опитує HTTP-ендпоінт плати кожні 200 мс. Всього пакетів:{' '}
            <strong className="tabular">{source.packetCount}</strong>.
          </p>
          <form className="inline-form" onSubmit={handleIpPoll}>
            <input
              type="text"
              className="input"
              placeholder="192.168.1.50"
              value={ipInput}
              onChange={(e) => setIpInput(e.target.value)}
              aria-label="IP-адреса ESP32"
            />
            <button type="submit" className="btn btn-sm btn-secondary">
              {pollActive ? 'Стоп' : 'Старт'}
            </button>
          </form>
        </article>

        {/* Adaptive Simulator */}
        <article className="control-card surface">
          <div className="control-head">
            <div className="control-title">
              <CpuIcon />
              <h2>Симулятор стенду</h2>
            </div>
            <span className="control-badge" data-active={simActive ? 'true' : 'false'}>
              {simActive ? 'Працює' : 'Вимкнено'}
            </span>
          </div>
          <p className="control-desc">
            Генерує живий потік під обраний профіль ({profile.shortLabel}) та типи датчиків.
          </p>
          <div className="inline-form">
            <select
              className="select"
              aria-label="Сценарій симулятора"
              value={simScenario}
              onChange={(e) => handleScenarioChange(e.target.value)}
            >
              <option value="smooth">1. Рівна траса (норма)</option>
              <option value="cobblestone">2. Бруківка (фільтр)</option>
              <option value="pothole_clip">3. Яма (BAT54S clip)</option>
              <option value="brake_drag">4. Перегрів гальма (RED)</option>
              <option value="bearing_wear">5. Знос підшипника (1480 Гц)</option>
              <option value="shadow_early">6. Shadow Mode (тихий)</option>
              <option value="link_loss">7. Обрив зв&apos;язку</option>
              <option value="sensor_fault">8. Збій Vref / SHT40 RH</option>
            </select>
            <button
              type="button"
              className="btn btn-sm btn-accent btn-icon-start"
              aria-pressed={simActive}
              onClick={handleSimToggle}
            >
              <IconSwap
                active={simActive}
                inactiveIcon={<PlayIcon />}
                activeIcon={<StopIcon />}
              />
              <span>{simActive ? 'Стоп' : 'Старт'}</span>
            </button>
          </div>
        </article>
      </section>

      {/* SECTION 3: LIVE SENSORS (LEFT) + LIVE OSCILLOSCOPE & FFT (RIGHT) */}
      <section className="live-workspace" aria-label="Живі модулі та графіки">
        <div className="rig-column">
          {/* Main S3 Master Card */}
          <article className="s3-module-card surface" data-online={s3.online ? 'true' : 'false'}>
            <div className="s3-head">
              <div className="s3-title-block">
                <div className="s3-icon-box">
                  <CpuIcon />
                </div>
                <div>
                  <div className="s3-title-row">
                    <h2>Головний модуль · ESP32-S3 Master</h2>
                    <span className="pill" data-state={s3.online ? 'online' : 'offline'}>
                      {s3.online ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </div>
                  <p className="s3-sub">
                    {getS3ModeShort(cfg.moduleSensors.s3Master.mode)} ·{' '}
                    {getS3LinkShort(cfg.moduleSensors.s3Master.link)} · Чорна скринька + Mini-LED
                  </p>
                </div>
              </div>

              <div className="s3-quick-btns">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => sendCliCommand('ble on')}>
                  BLE ON
                </button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => sendCliCommand('ble off')}>
                  BLE OFF
                </button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => sendCliCommand('status')}>
                  Статус
                </button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => sendCliCommand('sim')}>
                  Імпульс
                </button>
              </div>
            </div>

            <div className="s3-metrics-row">
              <div className="s3-stat">
                <span className="meta-label">Device ID</span>
                <strong className="mono">{s3.deviceId || state?.deviceId || 'S3_MASTER_MVP'}</strong>
              </div>
              <div className="s3-stat">
                <span className="meta-label">Тягач</span>
                <strong className="mono">{state?.tractorId || 'TR_001'}</strong>
              </div>
              <div className="s3-stat">
                <span className="meta-label">LTE модем</span>
                <strong>{s3.online ? (s3.lteOnline ? 'Онлайн' : 'Вимкнено') : 'Немає зв’язку'}</strong>
              </div>
              <div className="s3-stat">
                <span className="meta-label">BLE Сервіс</span>
                <strong>{s3.bleActive ? 'АКТИВНИЙ 15м' : 'OFF (у русі)'}</strong>
              </div>
              <div className="s3-stat">
                <span className="meta-label">Буфер / Черга</span>
                <strong className="tabular">
                  {s3.blackBoxRecs} / {s3.pendingQueue}
                </strong>
              </div>
            </div>
          </article>

          {/* Tractor Axles */}
          <div className="asset-group surface">
            <div className="asset-header">
              <div>
                <span className="asset-kicker">
                  {cfg.rigProfile === 'mvp_front'
                    ? 'MVP СТЕНД · ПЕРЕДНЯ ВІСЬ · 2 КОЛЕСА'
                    : 'ТЯГАЧ · 2 ОСІ · 4 КОЛЕСА'}
                </span>
                <h2 className="asset-heading">
                  <span>{state?.tractorId || 'TR_001'}</span>
                  <span className="asset-bus-tag">
                    {cfg.rigProfile === 'mvp_front'
                      ? `T1-L + T1-R → ${getS3LinkShort(cfg.moduleSensors.s3Master.link)} → S3`
                      : `T1 + T2 → ${getS3LinkShort(cfg.moduleSensors.s3Master.link)} → S3`}
                  </span>
                </h2>
              </div>
              <span className="asset-note">Клік по колесу перемикає графік праворуч</span>
            </div>

            <div className="axles-stack">
              {tractorAxles.map((ax) => (
                <AxleBlock
                  key={ax.slot}
                  axle={ax}
                  config={cfg}
                  selectedWheel={selectedWheel}
                  onSelectWheel={setSelectedWheel}
                />
              ))}
            </div>
          </div>

          {/* Trailer Bridge & Axles (Only in 10-wheel profile) */}
          {profile.hasBridge && (
            <>
              <div className="bridge-connector surface" data-online={bridge.online ? 'true' : 'false'}>
                <div className="bridge-left">
                  <div className="bridge-icon-box">
                    <RadioIcon />
                  </div>
                  <div>
                    <div className="bridge-title-row">
                      <h3>C3 Trailer Bridge · ESP-NOW LR + AES-128</h3>
                      <span className="pill" data-state={bridge.online ? 'online' : 'offline'}>
                        {bridge.online ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </div>
                    <p className="bridge-sub">Бездротове зчеплення причепа Drop &amp; Hook · 2.4 ГГц</p>
                  </div>
                </div>
                <div className="bridge-metrics">
                  <div className="bridge-stat">
                    <span className="meta-label">Причеп</span>
                    <strong className="mono">{bridge.trailerId || state?.trailerId}</strong>
                  </div>
                  <div className="bridge-stat">
                    <span className="meta-label">Спарення</span>
                    <strong>{bridge.online ? (bridge.paired ? 'AES-128 OK' : 'Пошук') : 'Немає'}</strong>
                  </div>
                  <div className="bridge-stat">
                    <span className="meta-label">RSSI</span>
                    <strong className="tabular">
                      {bridge.online && bridge.rssi !== null ? `${bridge.rssi} dBm` : '—'}
                    </strong>
                  </div>
                  <div className="bridge-stat">
                    <span className="meta-label">Вузлів / Seq</span>
                    <strong className="tabular">
                      {bridge.nodeCount} / #{bridge.seq || 0}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="asset-group surface">
                <div className="asset-header">
                  <div>
                    <span className="asset-kicker">ПРИЧЕП · 3 ОСІ · 6 КОЛІС</span>
                    <h2 className="asset-heading">
                      <span>{state?.trailerId || 'TL_042'}</span>
                      <span className="asset-bus-tag">P1–P3 → C3 Bridge → ESP-NOW LR</span>
                    </h2>
                  </div>
                </div>
                <div className="axles-stack">
                  {trailerAxles.map((ax) => (
                    <AxleBlock
                      key={ax.slot}
                      axle={ax}
                      config={cfg}
                      selectedWheel={selectedWheel}
                      onSelectWheel={setSelectedWheel}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Live RMS & FFT Charts Right Beside Sensors */}
        <LiveCharts />
      </section>
    </div>
  );
}
