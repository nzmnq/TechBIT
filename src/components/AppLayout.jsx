import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  SEVERITY_LABELS,
  SOURCE_LABELS,
  fmtUtcTime,
  useWorkbench,
} from '../context/WorkbenchContext';
import {
  ActivityIcon,
  BoxIcon,
  IconSwap,
  RotateCcwIcon,
  TerminalIcon,
  TrashIcon,
  VolumeOffIcon,
  VolumeOnIcon,
  WheelLogoIcon,
} from './Icons';

export default function AppLayout() {
  const { state, sseConnected, postCommand, clearCharts } = useWorkbench();

  const ind = state?.indicator || {
    driverSeverity: 'STANDBY',
    wheelCode: '—',
    buzzerOn: false,
    shadowCount: 0,
    roughRoadActive: false,
    potholeCount: 0,
    activeWheels: 0,
    expectedWheels: 2,
  };
  const s3 = state?.s3Master || {
    online: false,
    lteOnline: false,
    bleActive: false,
    blackBoxRecs: 0,
    buzzerMuted: false,
  };
  const source = state?.source || { mode: 'waiting', packetsPerSec: 0, packetCount: 0 };
  const openIncidents = (state?.incidents || []).filter((x) => x.status === 'OPEN').length;
  const profileLabel = state?.profile?.shortLabel || 'MVP 2 колеса + S3';

  const severityHint = (() => {
    if (ind.driverSeverity === 'RED') {
      return ind.buzzerOn
        ? `АКТИВНИЙ ЗУМЕР · Перевірте ${ind.wheelCode} негайно!`
        : `Критична тривога ${ind.wheelCode} (зумер приглушено)`;
    }
    if (ind.driverSeverity === 'YELLOW') {
      return `Стійка аномалія (> ${state?.config?.yellowConfirmSec ?? 60} с) на ${ind.wheelCode}.`;
    }
    if (ind.driverSeverity === 'GREEN') {
      return ind.roughRoadActive
        ? 'Бруківка розпізнана — вібраційні хибні тривоги подавлено.'
        : 'Усі активні датчики працюють стабільно.';
    }
    return 'Підключіть датчики по USB/Wi-Fi або запустіть симулятор.';
  })();

  const handleClear = () => {
    clearCharts();
    postCommand({ action: 'clear' });
  };

  return (
    <div className="app-shell">
      {/* TOPBAR WITH REACT ROUTER DOM NAVIGATION */}
      <header className="topbar surface enter-stage enter-1">
        <div className="brand">
          <div className="brand-mark">
            <WheelLogoIcon />
          </div>
          <div className="brand-copy">
            <div className="brand-title-row">
              <h1>
                TechBIT <span className="badge-v2">v2.2 LAB</span>
              </h1>
              <span className="coupling-tag">{profileLabel}</span>
            </div>
            <p className="brand-sub">Інженерний тест-стенд · React Router SPA</p>
          </div>
        </div>

        <nav className="nav-pills" aria-label="Сторінки стенду">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}
          >
            <ActivityIcon />
            <span>Датчики &amp; Графіки</span>
          </NavLink>

          <NavLink
            to="/blackbox"
            className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}
          >
            <BoxIcon />
            <span>Чорна скринька</span>
            {openIncidents > 0 && (
              <span className="nav-counter tabular">{openIncidents}</span>
            )}
          </NavLink>

          <NavLink
            to="/cli"
            className={({ isActive }) => `nav-pill${isActive ? ' active' : ''}`}
          >
            <TerminalIcon />
            <span>CLI &amp; Пороги</span>
          </NavLink>
        </nav>

        <div className="topbar-meta">
          <div className="source-pill" data-mode={sseConnected ? source.mode : 'waiting'} aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            <span>{sseConnected ? (SOURCE_LABELS[source.mode] || source.mode) : 'ПЕРЕПІДКЛЮЧЕННЯ'}</span>
          </div>
          <div className="meta-stat">
            <span className="meta-label">Потік</span>
            <span className="meta-value tabular">{source.packetsPerSec} pkt/s</span>
          </div>
          <div className="meta-stat">
            <span className="meta-label">Час UTC</span>
            <span className="meta-value tabular">{fmtUtcTime(state?.tsUtc)}</span>
          </div>
        </div>
      </header>

      {/* PERSISTENT S3 MASTER CABIN MINI-LED STATUS BAR */}
      <section className="cabin-bar surface enter-stage enter-2" aria-label="Індикатор кабіни S3 Master">
        <div className="cabin-led-unit" data-severity={ind.driverSeverity}>
          <div className="led-lamp" aria-hidden="true">
            <span className="led-core" />
          </div>
          <div className="led-copy">
            <span className="led-overline">S3 MASTER · MINI-LED КАБІНИ</span>
            <div className="led-status-row">
              <strong className="led-state-text">
                {SEVERITY_LABELS[ind.driverSeverity] || ind.driverSeverity}
              </strong>
              <span className="led-hint">{severityHint}</span>
            </div>
          </div>
          <div className="wheel-code-box" title="7-сегментний код колеса в кабіні">
            <span className="wheel-code-label">КОЛЕСО</span>
            <span className="wheel-code-value tabular">{ind.wheelCode || '—'}</span>
          </div>
        </div>

        <div className="cabin-telemetry-chips">
          <div className="cabin-chip">
            <span className="chip-label">Колеса</span>
            <strong className="chip-value tabular">
              {ind.activeWheels} / {ind.expectedWheels}
            </strong>
          </div>
          <div className="cabin-chip" data-highlight={ind.shadowCount > 0 ? 'shadow' : ''}>
            <span className="chip-label">Shadow</span>
            <strong className="chip-value tabular">{ind.shadowCount}</strong>
          </div>
          <div className="cabin-chip" data-highlight={ind.roughRoadActive ? 'rough' : ''}>
            <span className="chip-label">Дорога</span>
            <strong className="chip-value">{ind.roughRoadActive ? 'Бруківка' : 'Рівна'}</strong>
          </div>
          <div className="cabin-chip">
            <span className="chip-label">Ями</span>
            <strong className="chip-value tabular">{ind.potholeCount}</strong>
          </div>
          <div className="cabin-chip">
            <span className="chip-label">LTE / BLE</span>
            <strong className="chip-value">
              {s3.lteOnline ? 'LTE' : 'OFF'} / {s3.bleActive ? '15м' : 'OFF'}
            </strong>
          </div>
          <div className="cabin-chip">
            <span className="chip-label">Black Box</span>
            <strong className="chip-value tabular">{s3.blackBoxRecs} зап.</strong>
          </div>
        </div>

        <div className="cabin-actions">
          <button
            type="button"
            className="btn btn-secondary btn-icon-start"
            onClick={() => postCommand({ action: 'reset' })}
          >
            <RotateCcwIcon />
            <span>Скинути</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-icon-start"
            aria-pressed={s3.buzzerMuted}
            onClick={() => postCommand({ action: 'mute' })}
          >
            <IconSwap
              active={s3.buzzerMuted}
              inactiveIcon={<VolumeOnIcon />}
              activeIcon={<VolumeOffIcon />}
            />
            <span>{s3.buzzerMuted ? 'Без звуку' : 'Зумер'}</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-icon-start"
            onClick={handleClear}
          >
            <TrashIcon />
            <span>Очистити</span>
          </button>
        </div>
      </section>

      {/* ACTIVE ROUTE VIEW */}
      <main className="page-outlet">
        <Outlet />
      </main>
    </div>
  );
}
