import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  fmtUtcTime,
  getS3LinkShort,
  getS3ModeShort,
  getTempShort,
  getVibShort,
  useWorkbench,
} from '../context/WorkbenchContext';

const LOG_TAGS = ['ALL', 'CLI', 'USB', 'SIM', 'CFG', 'TICKET', 'SYSTEM'];

function buildWheelPinRows(code, sensorCfg) {
  const isRight = code.endsWith('-R');
  const piezoPin = isRight ? 'GPIO3 (ADC1_CH3)' : 'GPIO2 (ADC1_CH2)';
  const ntcPin = isRight ? 'GPIO4 (ADC1_CH4)' : 'GPIO0 (ADC1_CH0)';

  const rows = [];
  if (sensorCfg.vib === 'piezo_mcp6002') {
    rows.push(['Вібрація (П\'єзо AFE)', piezoPin, 'MCP6002 Vref ≈ 1.65 В + BAT54S · DMA 9 кГц (unit=0)']);
  } else if (sensorCfg.vib === 'piezo_direct') {
    rows.push(['Вібрація (Прямий п\'єзо)', piezoPin, 'Прямий ADC без зміщення Vref']);
  } else {
    rows.push(['Вібрація (MEMS / IMU)', 'GPIO6 / GPIO7 (SPI/I2C)', 'Цифровий акселерометр → RMS мм/с']);
  }

  if (sensorCfg.temp === 'sht40') {
    rows.push(['Темп. + Вологість (GY-SHT40)', 'GPIO8 (SDA) / GPIO9 (SCL)', 'I2C 0x44/0x45 · контроль конденсату RH ≥ 85%']);
  } else if (sensorCfg.temp === 'ntc') {
    rows.push(['Температура (NTC 10k)', ntcPin, 'Аналоговий подільник · ENABLE_SHT40=0']);
  } else {
    rows.push(['GY-SHT40 (Основний)', 'GPIO8 / GPIO9', 'I2C °C + RH%']);
    rows.push(['NTC 10k (Резерв)', ntcPin, 'Аварійний канал при обриві I2C']);
  }

  rows.push(['Шина CAN (SN65HVD230)', 'GPIO21 (TX) / GPIO20 (RX)', '500 kbps · термінатор 120 Ом']);
  return rows;
}

export default function CliPage() {
  const { state, localLogs, updateConfig, sendCliCommand } = useWorkbench();

  const cfg = state?.config;
  const profile = state?.profile || { id: 'mvp_front', hasBridge: false, label: 'MVP Стенд' };
  const ms = cfg?.moduleSensors || {
    frontLeft: { vib: 'piezo_mcp6002', temp: 'sht40' },
    frontRight: { vib: 'piezo_mcp6002', temp: 'sht40' },
    s3Master: { mode: 's3_can_lte_led', link: 'can_500k' },
  };

  const [formState, setFormState] = useState({
    tempWarnC: 70,
    tempCritC: 95,
    axleTempDeltaWarnC: 18,
    axleTempDeltaCritC: 35,
    vibWarnRmsMmS: 3.5,
    vibCritRmsMmS: 6.5,
    yellowConfirmSec: 60,
    redConfirmSec: 5,
    vrefMinMv: 1480,
    vrefMaxMv: 1820,
    humidityWarnPct: 85,
    shadowModeEnabled: true,
  });
  const syncedVersionRef = useRef(-1);

  useEffect(() => {
    if (!cfg || syncedVersionRef.current === cfg.configVersion) return;
    syncedVersionRef.current = cfg.configVersion;
    setFormState({
      tempWarnC: cfg.tempWarnC,
      tempCritC: cfg.tempCritC,
      axleTempDeltaWarnC: cfg.axleTempDeltaWarnC,
      axleTempDeltaCritC: cfg.axleTempDeltaCritC,
      vibWarnRmsMmS: cfg.vibWarnRmsMmS,
      vibCritRmsMmS: cfg.vibCritRmsMmS,
      yellowConfirmSec: cfg.yellowConfirmSec,
      redConfirmSec: cfg.redConfirmSec,
      vrefMinMv: cfg.vrefMinMv,
      vrefMaxMv: cfg.vrefMaxMv,
      humidityWarnPct: cfg.humidityWarnPct,
      shadowModeEnabled: Boolean(cfg.shadowModeEnabled),
    });
  }, [cfg]);

  const [cliTarget, setCliTarget] = useState('all');
  const [tractorIdInput, setTractorIdInput] = useState('TR_001');
  const [trailerIdInput, setTrailerIdInput] = useState('TL_042');
  const [rawInput, setRawInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState([]);
  const [histCursor, setHistCursor] = useState(-1);
  const [logFilter, setLogFilter] = useState('ALL');
  const consoleRef = useRef(null);

  const mergedLogs = useMemo(() => {
    const all = [...(state?.logs || []), ...localLogs]
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
      .slice(-80);
    if (logFilter === 'ALL') return all;
    return all.filter((m) => String(m.tag || '').toUpperCase().includes(logFilter));
  }, [state?.logs, localLogs, logFilter]);

  useEffect(() => {
    const el = consoleRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [mergedLogs]);

  const handleField = (name, value) => {
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleApplyThresholds = (e) => {
    e.preventDefault();
    updateConfig(formState);
  };

  const handlePushToS3 = async () => {
    await updateConfig(formState);
    const s3Payload = {
      temp_warn_c: Number(formState.tempWarnC),
      temp_crit_c: Number(formState.tempCritC),
      axle_temp_delta_warn_c: Number(formState.axleTempDeltaWarnC),
      axle_temp_delta_crit_c: Number(formState.axleTempDeltaCritC),
      vib_warn_rms: Number(formState.vibWarnRmsMmS),
      vib_crit_rms: Number(formState.vibCritRmsMmS),
      yellow_confirm_sec: Number(formState.yellowConfirmSec),
      red_confirm_sec: Number(formState.redConfirmSec),
      shadow_mode: Boolean(formState.shadowModeEnabled),
    };
    await sendCliCommand(`cfg ${JSON.stringify(s3Payload)}`, cliTarget);
  };

  const handleRawSubmit = (e) => {
    e.preventDefault();
    const cmd = rawInput.trim();
    if (!cmd) return;
    sendCliCommand(cmd, cliTarget);
    setCmdHistory((prev) => [cmd, ...prev].slice(0, 30));
    setHistCursor(-1);
    setRawInput('');
  };

  const handleRawKeyDown = (e) => {
    if (e.key === 'ArrowUp' && cmdHistory.length > 0) {
      e.preventDefault();
      const next = Math.min(cmdHistory.length - 1, histCursor + 1);
      setHistCursor(next);
      setRawInput(cmdHistory[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histCursor <= 0) {
        setHistCursor(-1);
        setRawInput('');
      } else {
        const next = histCursor - 1;
        setHistCursor(next);
        setRawInput(cmdHistory[next]);
      }
    }
  };

  return (
    <div className="page-stack">
      {/* TOP TWO-COLUMN GRID: THRESHOLDS + QUICK CLI (LEFT) & LIVE CONSOLE (RIGHT) */}
      <section className="config-grid">
        <div className="left-config-stack">
          {/* Dynamic Rule Engine & S3 Thresholds */}
          <div className="panel surface">
            <div className="panel-header-row">
              <div>
                <h2>Динамічні пороги Rule Engine &amp; S3 Master</h2>
                <p className="panel-sub">
                  Застосовуються в стенді миттєво або записуються в NVS ESP32-S3 через <code>cfg &#123;...&#125;</code>.
                </p>
              </div>
              <span className="pill tabular">v{cfg?.configVersion ?? 1}</span>
            </div>

            <form className="config-form" onSubmit={handleApplyThresholds}>
              <div className="form-grid">
                <label className="field">
                  <span>Темп. Увага (°C)</span>
                  <input
                    type="number"
                    step="0.5"
                    className="input tabular"
                    value={formState.tempWarnC}
                    onChange={(e) => handleField('tempWarnC', Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Темп. Критично (°C)</span>
                  <input
                    type="number"
                    step="0.5"
                    className="input tabular"
                    value={formState.tempCritC}
                    onChange={(e) => handleField('tempCritC', Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>ΔT осі Увага (°C)</span>
                  <input
                    type="number"
                    step="0.5"
                    className="input tabular"
                    value={formState.axleTempDeltaWarnC}
                    onChange={(e) => handleField('axleTempDeltaWarnC', Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>ΔT осі Критично (°C)</span>
                  <input
                    type="number"
                    step="0.5"
                    className="input tabular"
                    value={formState.axleTempDeltaCritC}
                    onChange={(e) => handleField('axleTempDeltaCritC', Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Вібр. Увага (мм/с)</span>
                  <input
                    type="number"
                    step="0.1"
                    className="input tabular"
                    value={formState.vibWarnRmsMmS}
                    onChange={(e) => handleField('vibWarnRmsMmS', Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Вібр. Критично (мм/с)</span>
                  <input
                    type="number"
                    step="0.1"
                    className="input tabular"
                    value={formState.vibCritRmsMmS}
                    onChange={(e) => handleField('vibCritRmsMmS', Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>YELLOW гістерезис (с)</span>
                  <input
                    type="number"
                    step="1"
                    className="input tabular"
                    value={formState.yellowConfirmSec}
                    onChange={(e) => handleField('yellowConfirmSec', Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>RED гістерезис (с)</span>
                  <input
                    type="number"
                    step="1"
                    className="input tabular"
                    value={formState.redConfirmSec}
                    onChange={(e) => handleField('redConfirmSec', Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Конденсат RH (%)</span>
                  <input
                    type="number"
                    step="1"
                    className="input tabular"
                    value={formState.humidityWarnPct}
                    onChange={(e) => handleField('humidityWarnPct', Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Vref min (мВ)</span>
                  <input
                    type="number"
                    step="10"
                    className="input tabular"
                    value={formState.vrefMinMv}
                    onChange={(e) => handleField('vrefMinMv', Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Vref max (мВ)</span>
                  <input
                    type="number"
                    step="10"
                    className="input tabular"
                    value={formState.vrefMaxMv}
                    onChange={(e) => handleField('vrefMaxMv', Number(e.target.value))}
                  />
                </label>
                <label className="field field-checkbox">
                  <input
                    type="checkbox"
                    checked={formState.shadowModeEnabled}
                    onChange={(e) => handleField('shadowModeEnabled', e.target.checked)}
                  />
                  <span>Shadow Mode (тихий лог без LED)</span>
                </label>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary">
                  Застосувати в стенді
                </button>
                <button type="button" className="btn btn-secondary" onClick={handlePushToS3}>
                  Записати в S3 по USB / Wi-Fi
                </button>
              </div>
            </form>
          </div>

          {/* Quick Board CLI Buttons */}
          <div className="panel surface">
            <div className="panel-header-row">
              <div>
                <h2>Швидкі CLI-команди ESP32</h2>
                <p className="panel-sub">Працюють напряму з активними Web Serial портами та чергою Wi-Fi.</p>
              </div>
              <select
                className="select select-sm cli-target-select"
                aria-label="Цільовий порт CLI"
                value={cliTarget}
                onChange={(e) => setCliTarget(e.target.value)}
              >
                <option value="all">Усі USB + Wi-Fi</option>
                <option value="1">Тільки USB 1</option>
                <option value="2">Тільки USB 2</option>
              </select>
            </div>

            <div className="cli-section">
              <span className="cli-group-label">Призначити слот осі вузлу C3 (зберігається в NVS)</span>
              <div className="cli-btn-row">
                {[
                  ['slot 1', 'slot 1 (T1)'],
                  ['slot 2', 'slot 2 (T2)'],
                  ['slot 3', 'slot 3 (P1)'],
                  ['slot 4', 'slot 4 (P2)'],
                  ['slot 5', 'slot 5 (P3)'],
                ].map(([cmd, label]) => (
                  <button
                    key={cmd}
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => sendCliCommand(cmd, cliTarget)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="cli-section">
              <span className="cli-group-label">S3 Master сервіс, BLE та потік</span>
              <div className="cli-btn-row">
                {[
                  ['ble on', 'BLE 15 хв ON'],
                  ['ble off', 'BLE OFF'],
                  ['json', 'JSON потік'],
                  ['status', 'Статус'],
                  ['sim', 'Тест-імпульс'],
                  ['reset', 'Скинути тривогу'],
                ].map(([cmd, label]) => (
                  <button
                    key={cmd}
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => sendCliCommand(cmd, cliTarget)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="cli-section">
              <span className="cli-group-label">Прив&apos;язка ID тягача та причепа (Drop &amp; Hook)</span>
              <div className="id-writers-grid">
                <div className="inline-form">
                  <input
                    type="text"
                    className="input mono"
                    value={tractorIdInput}
                    onChange={(e) => setTractorIdInput(e.target.value)}
                    aria-label="ID тягача"
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => tractorIdInput.trim() && sendCliCommand(`tractor ${tractorIdInput.trim()}`, cliTarget)}
                  >
                    Tractor
                  </button>
                </div>
                <div className="inline-form">
                  <input
                    type="text"
                    className="input mono"
                    value={trailerIdInput}
                    onChange={(e) => setTrailerIdInput(e.target.value)}
                    aria-label="ID причепа"
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => trailerIdInput.trim() && sendCliCommand(`trailer ${trailerIdInput.trim()}`, cliTarget)}
                  >
                    Trailer
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Full-Height Live Serial & Event Console */}
        <div className="panel surface console-panel">
          <div className="panel-header-row">
            <div>
              <h2>Жива консоль Serial / Wi-Fi &amp; CLI</h2>
              <p className="panel-sub">Підтримує історію команд клавішами ↑ / ↓.</p>
            </div>
            <span className="pill tabular">{mergedLogs.length} записів</span>
          </div>

          <div className="seg-control" role="group" aria-label="Фільтр логів консолі">
            {LOG_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                className="seg-btn"
                aria-pressed={logFilter === tag}
                onClick={() => setLogFilter(tag)}
              >
                {tag === 'ALL' ? 'Усі' : tag}
              </button>
            ))}
          </div>

          <div className="console-box console-tall" ref={consoleRef} aria-live="polite">
            {mergedLogs.length === 0 ? (
              <div className="console-empty">Очікування подій або команд CLI...</div>
            ) : (
              mergedLogs.map((m, idx) => (
                <div key={`${m.ts}-${idx}`} className="console-line">
                  <span className="console-ts tabular">{fmtUtcTime(m.ts)}</span>
                  <span className="console-tag">[{m.tag}]</span>
                  <span className="console-text">{m.text}</span>
                </div>
              ))
            )}
          </div>

          <form className="inline-form console-form" onSubmit={handleRawSubmit}>
            <input
              type="text"
              className="input mono"
              placeholder="Введіть команду ESP (status, slot 1, ble on, cfg {...})..."
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              onKeyDown={handleRawKeyDown}
              aria-label="Сира команда для ESP32"
            />
            <button type="submit" className="btn btn-sm btn-primary">
              Надіслати
            </button>
          </form>
        </div>
      </section>

      {/* BOTTOM FULL-WIDTH ADAPTIVE PINOUT PER MODULE */}
      <section className="panel surface" aria-label="Адаптивна розпіновка модулів">
        <div className="panel-header-row">
          <div>
            <h2>Адаптивна розпіновка під обрані датчики ({profile.label})</h2>
            <p className="panel-sub">
              Автоматично синхронізується з обраними типами датчиків для T1-L, T1-R та S3 Master.
            </p>
          </div>
          <div className="burst-toolbar">
            <span className="pill">
              L: {getVibShort(ms.frontLeft.vib)} + {getTempShort(ms.frontLeft.temp)}
            </span>
            <span className="pill">
              R: {getVibShort(ms.frontRight.vib)} + {getTempShort(ms.frontRight.temp)}
            </span>
            <span className="pill">
              S3: {getS3ModeShort(ms.s3Master.mode)}
            </span>
          </div>
        </div>

        <div className="pinout-grid">
          <div className="pinout-block" data-tone="cyan">
            <h3>T1-L · Ліве переднє колесо (ESP32-C3)</h3>
            <table className="pin-table">
              <thead>
                <tr><th>Сигнал</th><th>GPIO</th><th>Примітка</th></tr>
              </thead>
              <tbody>
                {buildWheelPinRows('T1-L', ms.frontLeft).map(([sig, gpio, note]) => (
                  <tr key={sig}>
                    <td>{sig}</td>
                    <td className="mono">{gpio}</td>
                    <td>{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pinout-block" data-tone="rose">
            <h3>T1-R · Праве переднє колесо (ESP32-C3)</h3>
            <table className="pin-table">
              <thead>
                <tr><th>Сигнал</th><th>GPIO</th><th>Примітка</th></tr>
              </thead>
              <tbody>
                {buildWheelPinRows('T1-R', ms.frontRight).map(([sig, gpio, note]) => (
                  <tr key={sig}>
                    <td>{sig}</td>
                    <td className="mono">{gpio}</td>
                    <td>{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pinout-block" data-tone="indigo">
            <h3>ESP32-S3 Master · Головний модуль ({getS3LinkShort(ms.s3Master.link)})</h3>
            <table className="pin-table">
              <thead>
                <tr><th>Модуль / Сигнал</th><th>GPIO</th><th>Примітка</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Прийом телеметрії</td>
                  <td className="mono">{ms.s3Master.link === 'can_500k' ? 'GPIO4 / GPIO5' : 'USB-C / Wi-Fi'}</td>
                  <td>{getS3LinkShort(ms.s3Master.link)}</td>
                </tr>
                <tr>
                  <td>Mini-LED + Зумер</td>
                  <td className="mono">GPIO6, 7, 14, 15</td>
                  <td>G / Y / R + код колеса (без OLED)</td>
                </tr>
                <tr>
                  <td>LTE SIM7600</td>
                  <td className="mono">GPIO17 / GPIO18</td>
                  <td>{ms.s3Master.mode === 's3_usb_bench' ? 'Вимкнено (режим стенду)' : 'UART TX/RX · HTTPS ANOMALY_BURST'}</td>
                </tr>
                <tr>
                  <td>Кнопка BLE 15 хв</td>
                  <td className="mono">GPIO0</td>
                  <td>{ms.s3Master.mode === 's3_ble_bridge' ? 'Активний Service Mode + ESP-NOW' : 'Service Mode лише для СТО'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {profile.hasBridge && (
            <div className="pinout-block" data-tone="violet">
              <h3>ESP32-C3 Trailer Bridge (Причеп P1–P3)</h3>
              <table className="pin-table">
                <thead>
                  <tr><th>Сигнал</th><th>GPIO</th><th>Примітка</th></tr>
                </thead>
                <tbody>
                  <tr><td>CAN SN65HVD230</td><td className="mono">GPIO21 / GPIO20</td><td>Збір осей P1, P2, P3 (500 kbps)</td></tr>
                  <tr><td>ESP-NOW LR 2.4 ГГц</td><td className="mono">Зовнішня антена</td><td>1 Мбіт/с + AES-128 до S3 Master</td></tr>
                  <tr><td>Кнопка Pairing</td><td className="mono">GPIO9</td><td>Прив&apos;язка причепа Drop &amp; Hook</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
