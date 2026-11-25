import React, { useState } from 'react';
import { fmtNum, fmtUtcTime, useWorkbench } from '../context/WorkbenchContext';
import {
  DownloadIcon,
  FlagIcon,
  IconSwap,
  PlayIcon,
  RotateCcwIcon,
  StopIcon,
} from '../components/Icons';

const SPEEDS = [0, 40, 60, 80];

export default function DatasetPage() {
  const { state, postCommand, updateConfig } = useWorkbench();

  const cfg = state?.config || { vehicleClass: 'crossover', baselineMinSamples: 25 };
  const ds = state?.dataset || {
    active: false,
    sessionId: null,
    elapsedSec: 0,
    sampleCount: 0,
    speedKmh: 60,
    potholeMarks: 0,
    sessions: [],
  };

  const frontAxle = state?.axles?.[0];
  const left = frontAxle?.left;
  const right = frontAxle?.right;

  const [passport, setPassport] = useState({
    vehicle_class: 'crossover',
    vehicle_model: 'Hyundai Santa Fe',
    wheel_diameter_inch: 18,
    condition: 'BEFORE_REPAIR',
    fault_label: 'HEALTHY_BASELINE',
    fault_wheel: 'AXLE1_RIGHT',
    paired_session_id: '',
    sampling_rate_hz: 9000,
    sensor_model: 'Piezo_MCP6002_BAT54S_GY-SHT40',
    mount_type: 'knuckle_bracket',
    ambient_temp_c: 10,
    road_notes: 'Асфальт 40/60/80 км/год + тестові ями',
    mechanic_notes: '',
  });

  const handleField = (key, val) => {
    setPassport((prev) => ({ ...prev, [key]: val }));
  };

  const startRecording = async () => {
    await fetch('/api/dataset/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...passport,
        vehicle_class: cfg.vehicleClass || passport.vehicle_class,
        speed_kmh: ds.speedKmh,
      }),
    });
  };

  const stopRecording = async () => {
    await fetch('/api/dataset/stop', { method: 'POST' });
  };

  const setSpeed = async (speedKmh) => {
    await fetch('/api/dataset/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speedKmh }),
    });
  };

  const markEvent = async (eventTag) => {
    await fetch('/api/dataset/mark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventTag }),
    });
  };

  const renderBaselineBox = (label, side, tone) => {
    const b = side?.baseline || { samples: 0, meanRms: 0, stdRms: 0, lastZScore: 0, ready: false };
    const pct = Math.min(100, Math.round((b.samples / Math.max(1, cfg.baselineMinSamples || 25)) * 100));
    return (
      <div className="baseline-card" data-tone={tone}>
        <div className="baseline-card-head">
          <div className="module-picker-head">
            <span className="module-tag" data-tone={tone}>{side?.code || label}</span>
            <strong>{label}</strong>
          </div>
          <span className="pill" data-state={b.ready ? 'online' : 'offline'}>
            {b.ready ? 'НОРМУ ВИВЧЕНО' : `НАВЧАННЯ ${pct}%`}
          </span>
        </div>

        <div className="baseline-bar-track" aria-hidden="true">
          <div className="baseline-bar-fill" data-tone={tone} style={{ width: `${pct}%` }} />
        </div>

        <div className="baseline-stats-grid">
          <div>
            <span className="meta-label">Норма RMS</span>
            <strong className="mono tabular">
              {b.samples > 0 ? `${fmtNum(b.meanRms, 2)} ± ${fmtNum(b.stdRms, 2)}` : '—'}
            </strong>
          </div>
          <div>
            <span className="meta-label">Z-score</span>
            <strong className="mono tabular">
              {b.ready ? `${fmtNum(b.lastZScore, 2)} σ` : 'Очікування'}
            </strong>
          </div>
          <div>
            <span className="meta-label">Kurtosis</span>
            <strong className="mono tabular">{side?.online ? fmtNum(side.kurtosis, 2) : '—'}</strong>
          </div>
          <div>
            <span className="meta-label">ВЧ-енергія</span>
            <strong className="mono tabular">
              {side?.online ? `${Math.round((side.hfEnergy || 0) * 100)}%` : '—'}
            </strong>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="page-stack">
      {/* AUTO-BASELINE & DOMAIN-INVARIANT MONITOR */}
      <section className="panel surface" aria-label="Auto-Baseline самонавчання нормі авто">
        <div className="panel-header-row">
          <div>
            <h2>Auto-Baseline (Самонавчання нормі авто · Domain-Invariant ML)</h2>
            <p className="panel-sub">
              Плата сама запам&apos;ятовує тишу <strong>Hyundai Santa Fe</strong> або шум <strong>фури 40 т</strong> і
              шукає відхилення за <code>Z-score</code>, <code>Kurtosis</code>, <code>HF Energy</code> та парою{' '}
              <code>L/R</code>.
            </p>
          </div>
          <div className="profile-switcher-row">
            <div className="seg-control" role="group" aria-label="Клас авто">
              <button
                type="button"
                className="seg-btn"
                aria-pressed={(cfg.vehicleClass || 'crossover') === 'crossover'}
                onClick={() => updateConfig({ vehicleClass: 'crossover' })}
              >
                Hyundai Santa Fe (Кросовер)
              </button>
              <button
                type="button"
                className="seg-btn"
                aria-pressed={cfg.vehicleClass === 'truck'}
                onClick={() => updateConfig({ vehicleClass: 'truck' })}
              >
                Фура 40 т
              </button>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-secondary btn-icon-start"
              onClick={() => postCommand({ action: 'relearn' })}
            >
              <RotateCcwIcon />
              <span>Перевчити норму</span>
            </button>
          </div>
        </div>

        <div className="baseline-pair-grid">
          {renderBaselineBox('Ліве переднє колесо', left, 'cyan')}
          {renderBaselineBox('Праве переднє колесо', right, 'rose')}
        </div>
      </section>

      {/* RECORDER WORKSPACE: PASSPORT + LIVE MARKERS (LEFT) & SESSIONS LIST (RIGHT) */}
      <section className="blackbox-grid">
        {/* Left: Session Passport & Drive Recorder */}
        <div className="panel surface">
          <div className="panel-header-row">
            <div>
              <h2>Рекордер датасету СТО &amp; Santa Fe (ДО / ПІСЛЯ ремонту)</h2>
              <p className="panel-sub">
                Пише всі domain-invariant фічі на кожному кроці разом із JSON-паспортом поїздки.
              </p>
            </div>
            <span className="pill tabular" data-state={ds.active ? 'RED' : 'offline'}>
              {ds.active ? `REC · ${ds.sampleCount} ряд. · ${ds.elapsedSec} с` : 'ГОТОВИЙ ДО ЗАПИСУ'}
            </span>
          </div>

          {/* Live Drive Controls (Speed 0/40/60/80 + Pothole Mark + Rec Toggle) */}
          <div className="rec-live-bar">
            <div className="rec-speed-group">
              <span className="meta-label">Швидкість (км/год)</span>
              <div className="seg-control" role="group" aria-label="Поточна швидкість авто">
                {SPEEDS.map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    className="seg-btn tabular"
                    aria-pressed={ds.speedKmh === spd}
                    onClick={() => setSpeed(spd)}
                  >
                    {spd === 0 ? 'Стоп' : `${spd}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="rec-action-group">
              <button
                type="button"
                className="btn btn-secondary btn-icon-start"
                disabled={!ds.active}
                onClick={() => markEvent('POTHOLE')}
              >
                <FlagIcon />
                <span>Яма! ({ds.potholeMarks})</span>
              </button>

              <button
                type="button"
                className="btn btn-accent btn-icon-start"
                aria-pressed={ds.active}
                onClick={ds.active ? stopRecording : startRecording}
              >
                <IconSwap
                  active={ds.active}
                  inactiveIcon={<PlayIcon />}
                  activeIcon={<StopIcon />}
                />
                <span>{ds.active ? 'Стоп і зберегти' : 'Старт запису'}</span>
              </button>
            </div>
          </div>

          {/* Session JSON Passport Form */}
          <div className="form-grid">
            <label className="field">
              <span>Модель авто</span>
              <input
                type="text"
                className="input"
                value={passport.vehicle_model}
                onChange={(e) => handleField('vehicle_model', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Діаметр диска (")</span>
              <input
                type="number"
                className="input tabular"
                value={passport.wheel_diameter_inch}
                onChange={(e) => handleField('wheel_diameter_inch', Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Етап (ДО / ПІСЛЯ)</span>
              <select
                className="select"
                value={passport.condition}
                onChange={(e) => handleField('condition', e.target.value)}
              >
                <option value="BEFORE_REPAIR">BEFORE_REPAIR (До ремонту / тест)</option>
                <option value="AFTER_REPAIR">AFTER_REPAIR (Після ремонту / норма)</option>
              </select>
            </label>
            <label className="field">
              <span>Діагноз (fault_label)</span>
              <select
                className="select"
                value={passport.fault_label}
                onChange={(e) => handleField('fault_label', e.target.value)}
              >
                <option value="HEALTHY_BASELINE">HEALTHY_BASELINE (Здорове авто)</option>
                <option value="BEARING_WEAR_EARLY">BEARING_WEAR_EARLY (Ранній знос підшипника)</option>
                <option value="BEARING_WEAR_SEVERE">BEARING_WEAR_SEVERE (Сильний гул підшипника)</option>
                <option value="BRAKE_CALIPER_STUCK">BRAKE_CALIPER_STUCK (Підклинює супорт)</option>
                <option value="TIRE_UNBALANCE">TIRE_UNBALANCE (Биття диска / шини)</option>
              </select>
            </label>
            <label className="field">
              <span>Проблемне колесо</span>
              <select
                className="select"
                value={passport.fault_wheel}
                onChange={(e) => handleField('fault_wheel', e.target.value)}
              >
                <option value="NONE">Немає (обидва здорові)</option>
                <option value="AXLE1_LEFT">T1-L · Ліве переднє</option>
                <option value="AXLE1_RIGHT">T1-R · Праве переднє</option>
              </select>
            </label>
            <label className="field">
              <span>Парна сесія ID</span>
              <input
                type="text"
                className="input mono"
                placeholder="STO_2026_11_25_001"
                value={passport.paired_session_id}
                onChange={(e) => handleField('paired_session_id', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Темп. повітря (°C)</span>
              <input
                type="number"
                className="input tabular"
                value={passport.ambient_temp_c}
                onChange={(e) => handleField('ambient_temp_c', Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Нотатки дороги</span>
              <input
                type="text"
                className="input"
                value={passport.road_notes}
                onChange={(e) => handleField('road_notes', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Нотатки механіка</span>
              <input
                type="text"
                className="input"
                placeholder="Напр. люфт правого підшипника, заміна FAG"
                value={passport.mechanic_notes}
                onChange={(e) => handleField('mechanic_notes', e.target.value)}
              />
            </label>
          </div>
        </div>

        {/* Right: Saved Dataset Sessions + Python ML Hint */}
        <div className="panel surface">
          <div className="panel-header-row">
            <div>
              <h2>Збережені сесії датасету ({ds.sessions.length})</h2>
              <p className="panel-sub">
                Файли автоматично зберігаються у папку <code>datasets/</code> у форматах <code>.json</code> та{' '}
                <code>.csv</code>.
              </p>
            </div>
          </div>

          <div className="ml-cmd-callout">
            <span className="meta-label">Навчання ML та перевірка ROC-AUC (Python 3 без pip install)</span>
            <code className="mono">python ml_pipeline/train_evaluate.py datasets/</code>
          </div>

          <div className="incidents-scroll incidents-tall">
            {ds.sessions.length === 0 ? (
              <div className="empty-state">
                <p>
                  Сесій ще не записано. Увімкніть плату або симулятор, оберіть{' '}
                  <strong>BEFORE_REPAIR / AFTER_REPAIR</strong> і натисніть <strong>«Старт запису»</strong>.
                </p>
              </div>
            ) : (
              ds.sessions.map((s) => (
                <article key={s.session_id} className="incident-card">
                  <div className="incident-top">
                    <div className="incident-id-row">
                      <strong className="mono">{s.session_id}</strong>
                      <span
                        className="pill"
                        data-state={s.condition === 'BEFORE_REPAIR' ? 'YELLOW' : 'online'}
                      >
                        {s.condition}
                      </span>
                      <span className="pill">{s.fault_label}</span>
                    </div>
                    <span className="incident-meta tabular">{fmtUtcTime(s.started_at_utc)} UTC</span>
                  </div>
                  <div className="incident-meta tabular">
                    {s.vehicle_model} ({s.vehicle_class}) · {s.sample_count} відліків · ям: {s.pothole_marks}
                  </div>
                  <div className="incident-actions">
                    <a
                      className="btn btn-sm btn-primary btn-icon-start"
                      href={`/api/dataset/export/${encodeURIComponent(s.session_id)}?format=csv`}
                      download={`${s.session_id}.csv`}
                    >
                      <DownloadIcon />
                      <span>CSV (ML)</span>
                    </a>
                    <a
                      className="btn btn-sm btn-secondary btn-icon-start"
                      href={`/api/dataset/export/${encodeURIComponent(s.session_id)}?format=json`}
                      download={`${s.session_id}.json`}
                    >
                      <DownloadIcon />
                      <span>JSON Паспорт</span>
                    </a>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
