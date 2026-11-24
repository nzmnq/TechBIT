import React, { useMemo, useState } from 'react';
import {
  REASON_LABELS,
  RESOLUTION_OPTIONS,
  fmtNum,
  fmtUtcTime,
  useWorkbench,
} from '../context/WorkbenchContext';
import { CheckIcon, CopyIcon, DownloadIcon, IconSwap } from '../components/Icons';

function decodeBurstSamples(b64) {
  if (!b64) return [];
  try {
    const raw = atob(b64);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export default function BlackBoxPage() {
  const { state, postCommand } = useWorkbench();
  const [filter, setFilter] = useState('all'); // 'all' | 'open' | 'closed'
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [viewerMode, setViewerMode] = useState('json'); // 'json' | 'decoded'
  const [copiedJson, setCopiedJson] = useState(false);

  const incidents = state?.incidents || [];
  const bursts = state?.burstEvents || [];
  const s3 = state?.s3Master || { blackBoxRecs: 0, pendingQueue: 0 };

  const openCount = incidents.filter((i) => i.status === 'OPEN').length;
  const closedCount = incidents.filter((i) => i.status === 'CLOSED').length;
  const shadowCount = state?.indicator?.shadowCount ?? 0;

  const filteredIncidents = useMemo(() => {
    if (filter === 'open') return incidents.filter((i) => i.status === 'OPEN');
    if (filter === 'closed') return incidents.filter((i) => i.status === 'CLOSED');
    return incidents;
  }, [incidents, filter]);

  const safeIdx = Math.min(selectedIdx, Math.max(0, bursts.length - 1));
  const activeBurst = bursts[safeIdx] || null;
  const decodedSamples = useMemo(
    () => (activeBurst ? decodeBurstSamples(activeBurst.burst_samples_base64) : []),
    [activeBurst]
  );

  const handleCopyJson = async () => {
    if (!activeBurst) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(activeBurst, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1600);
    } catch (_) {}
  };

  return (
    <div className="page-stack">
      {/* KPI SUMMARY STRIP */}
      <section className="kpi-banner-grid" aria-label="Статистика Чорної скриньки">
        <div className="kpi-banner-card surface" data-tone="cyan">
          <span className="meta-label">Усього інцидентів</span>
          <strong className="kpi-big tabular">{incidents.length}</strong>
        </div>
        <div className="kpi-banner-card surface" data-tone="rose">
          <span className="meta-label">Відкриті тікети</span>
          <strong className="kpi-big tabular">{openCount}</strong>
        </div>
        <div className="kpi-banner-card surface" data-tone="emerald">
          <span className="meta-label">Закрито Ground Truth</span>
          <strong className="kpi-big tabular">{closedCount}</strong>
        </div>
        <div className="kpi-banner-card surface" data-tone="violet">
          <span className="meta-label">Shadow Mode записів</span>
          <strong className="kpi-big tabular">{shadowCount}</strong>
        </div>
        <div className="kpi-banner-card surface" data-tone="indigo">
          <span className="meta-label">Кільцевий буфер S3</span>
          <strong className="kpi-big tabular">{s3.blackBoxRecs} зап.</strong>
        </div>
      </section>

      {/* MAIN TWO-COLUMN BLACK BOX WORKSPACE */}
      <section className="blackbox-grid">
        {/* Left: Incidents & 2-Click Ground Truth */}
        <div className="panel surface">
          <div className="panel-header-row">
            <div>
              <h2>Інциденти &amp; Ground Truth (SLA 48 год)</h2>
              <p className="panel-sub">
                Кожна подія <code>YELLOW</code> / <code>RED</code> / <code>SHADOW</code> фіксується тут для
                майбутнього датасету ML.
              </p>
            </div>
            <div className="burst-toolbar">
              <div className="seg-control" role="group" aria-label="Фільтр інцидентів">
                <button
                  type="button"
                  className="seg-btn"
                  aria-pressed={filter === 'all'}
                  onClick={() => setFilter('all')}
                >
                  Усі ({incidents.length})
                </button>
                <button
                  type="button"
                  className="seg-btn"
                  aria-pressed={filter === 'open'}
                  onClick={() => setFilter('open')}
                >
                  Відкриті ({openCount})
                </button>
                <button
                  type="button"
                  className="seg-btn"
                  aria-pressed={filter === 'closed'}
                  onClick={() => setFilter('closed')}
                >
                  Закриті ({closedCount})
                </button>
              </div>

              <a
                className="btn btn-sm btn-primary btn-icon-start"
                href="/api/export.csv"
                download="techbit_v2_ground_truth.csv"
              >
                <DownloadIcon />
                <span>Експорт CSV</span>
              </a>
            </div>
          </div>

          <div className="incidents-scroll incidents-tall">
            {filteredIncidents.length === 0 ? (
              <div className="empty-state">
                <p>
                  Інцидентів у цьому фільтрі ще немає. Перейдіть на сторінку{' '}
                  <strong>«Датчики &amp; Графіки»</strong> і запустіть сценарій{' '}
                  <strong>«Перегрів гальма (RED)»</strong> або підключіть живий датчик.
                </p>
              </div>
            ) : (
              filteredIncidents.map((t) => {
                const isClosed = t.status === 'CLOSED';
                return (
                  <article key={t.ticket_id} className="incident-card">
                    <div className="incident-top">
                      <div className="incident-id-row">
                        <strong className="mono">{t.ticket_id}</strong>
                        <span className="pill" data-state={t.severity}>
                          {t.severity}
                        </span>
                        <span className="pill">{t.wheel_code}</span>
                        <span className="incident-meta">
                          {REASON_LABELS[t.reason] || t.reason}
                        </span>
                      </div>
                      <span className="incident-meta tabular">{fmtUtcTime(t.created_at_utc)} UTC</span>
                    </div>

                    <div className="incident-meta tabular">
                      {t.axle_label} · T = {fmtNum(t.temp_c, 1)} °C · ΔT = {fmtNum(t.temp_delta_c, 1)} °C ·
                      RMS = {fmtNum(t.vib_rms, 2)} мм/с
                    </div>

                    <div className="incident-actions">
                      {isClosed ? (
                        <span className="pill" data-state="online">
                          Закрито: {t.resolution_code || 'OK'}
                        </span>
                      ) : (
                        RESOLUTION_OPTIONS.map((opt) => (
                          <button
                            key={opt.code}
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() =>
                              postCommand({
                                action: 'resolve_ticket',
                                ticketId: t.ticket_id,
                                resolutionCode: opt.code,
                              })
                            }
                          >
                            {opt.label}
                          </button>
                        ))
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>

        {/* Right: ANOMALY_BURST JSON & Base64 Decoded Samples */}
        <div className="panel surface">
          <div className="panel-header-row">
            <div>
              <h2>Чорна скринька S3 · Пакет <code>ANOMALY_BURST</code></h2>
              <p className="panel-sub">
                Точний LTE-контракт v2.2 з профілем модулів та <code>burst_samples_base64</code>.
              </p>
            </div>
            <div className="burst-toolbar">
              <div className="seg-control" role="group" aria-label="Режим перегляду пакету">
                <button
                  type="button"
                  className="seg-btn"
                  aria-pressed={viewerMode === 'json'}
                  onClick={() => setViewerMode('json')}
                >
                  JSON
                </button>
                <button
                  type="button"
                  className="seg-btn"
                  aria-pressed={viewerMode === 'decoded'}
                  onClick={() => setViewerMode('decoded')}
                >
                  Base64 ({decodedSamples.length})
                </button>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-secondary btn-icon-start"
                disabled={!activeBurst}
                onClick={handleCopyJson}
              >
                <IconSwap
                  active={copiedJson}
                  inactiveIcon={<CopyIcon />}
                  activeIcon={<CheckIcon />}
                />
                <span>{copiedJson ? 'Скопійовано' : 'Копіювати'}</span>
              </button>
            </div>
          </div>

          <div className="burst-select-row">
            <select
              className="select"
              aria-label="Вибір пакету ANOMALY_BURST"
              value={String(safeIdx)}
              onChange={(e) => setSelectedIdx(Number(e.target.value) || 0)}
            >
              {bursts.length === 0 ? (
                <option value="0">Пакетів ANOMALY_BURST ще немає</option>
              ) : (
                bursts.map((b, idx) => (
                  <option key={b.event_id} value={String(idx)}>
                    #{idx + 1} · {b.severity} · {b.wheel_code} · {b.trigger_reason} ({fmtUtcTime(b.timestamp_utc)} UTC)
                  </option>
                ))
              )}
            </select>
          </div>

          {viewerMode === 'json' ? (
            <pre className="json-viewer json-tall">
              {activeBurst
                ? JSON.stringify(activeBurst, null, 2)
                : '// Очікування першого пакету ANOMALY_BURST від S3 Master або Rule Engine...'}
            </pre>
          ) : (
            <div className="decoded-scroll">
              {decodedSamples.length === 0 ? (
                <div className="empty-state">
                  <p>Немає декодованих відліків у поточному пакеті.</p>
                </div>
              ) : (
                <table className="pin-table">
                  <thead>
                    <tr>
                      <th>Час UTC</th>
                      <th>Вузол</th>
                      <th>T-L / T-R (°C)</th>
                      <th>RMS-L / RMS-R (мм/с)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decodedSamples.map((s, idx) => (
                      <tr key={`${s.tsUtc}-${idx}`}>
                        <td className="mono tabular">{fmtUtcTime(s.tsUtc)}</td>
                        <td className="mono">{s.nodeId}</td>
                        <td className="mono tabular">
                          {fmtNum(s.tL, 1)} / {fmtNum(s.tR, 1)}
                        </td>
                        <td className="mono tabular">
                          {fmtNum(s.vL, 2)} / {fmtNum(s.vR, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
