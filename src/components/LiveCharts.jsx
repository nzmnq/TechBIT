import React, { useEffect, useRef } from 'react';
import {
  PROFILE_WHEEL_MAP,
  WHEEL_CODES,
  fmtNum,
  getVibShort,
  useWorkbench,
} from '../context/WorkbenchContext';
import { PauseIcon } from './Icons';

function findWheel(state, code) {
  if (!state?.axles) return null;
  for (const ax of state.axles) {
    if (ax.left?.code === code) return { axle: ax, side: ax.left, opposite: ax.right };
    if (ax.right?.code === code) return { axle: ax, side: ax.right, opposite: ax.left };
  }
  return null;
}

function getWheelSensorCfg(config, code) {
  if (code === 'T1-L') return config?.moduleSensors?.frontLeft || { vib: 'piezo_mcp6002', temp: 'sht40' };
  if (code === 'T1-R') return config?.moduleSensors?.frontRight || { vib: 'piezo_mcp6002', temp: 'sht40' };
  return { vib: config?.vibSensorType || 'piezo_mcp6002', temp: config?.tempSensorType || 'sht40' };
}

function prepareCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(280, Math.round(rect.width || 600));
  const h = Math.max(185, Math.round(rect.height || 210));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export default function LiveCharts() {
  const {
    state,
    selectedWheel,
    setSelectedWheel,
    chartsFrozen,
    setChartsFrozen,
    historyRef,
    historyTick,
    clearCharts,
  } = useWorkbench();

  const rmsCanvasRef = useRef(null);
  const fftCanvasRef = useRef(null);

  const profileId = state?.config?.rigProfile || 'mvp_front';
  const visibleWheels = PROFILE_WHEEL_MAP[profileId] || WHEEL_CODES;
  const found = findWheel(state, selectedWheel);
  const axle = found?.axle;
  const side = found?.side;
  const opposite = found?.opposite;
  const online = Boolean(side?.online);
  const sideCfg = getWheelSensorCfg(state?.config, selectedWheel);
  const vibWarn = state?.config?.vibWarnRmsMmS ?? 3.5;
  const vibCrit = state?.config?.vibCritRmsMmS ?? 6.5;

  // Draw RMS & FFT Canvas charts cleanly on each update or resize
  useEffect(() => {
    const drawAll = () => {
      if (rmsCanvasRef.current && side && opposite) {
        const { ctx, w, h } = prepareCanvas(rmsCanvasRef.current);
        ctx.fillStyle = '#09071a';
        ctx.fillRect(0, 0, w, h);

        const padL = 42;
        const padR = 14;
        const padT = 14;
        const padB = 26;
        const plotW = w - padL - padR;
        const plotH = h - padT - padB;

        const mainHist = historyRef.current[side.code] || [];
        const oppHist = historyRef.current[opposite.code] || [];
        const maxData = Math.max(
          vibCrit + 1.5,
          ...mainHist.filter((v) => v !== null),
          ...oppHist.filter((v) => v !== null)
        );
        const yMax = Math.ceil(maxData);

        ctx.strokeStyle = 'rgba(167, 139, 250, 0.12)';
        ctx.lineWidth = 1;
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#9ca3c9';
        for (let i = 0; i <= 4; i++) {
          const val = (yMax * i) / 4;
          const y = padT + plotH - (val / yMax) * plotH;
          ctx.beginPath();
          ctx.moveTo(padL, y);
          ctx.lineTo(w - padR, y);
          ctx.stroke();
          ctx.fillText(val.toFixed(1), 6, y + 4);
        }

        const drawThresh = (val, color, label) => {
          const y = padT + plotH - (val / yMax) * plotH;
          if (y < padT || y > padT + plotH) return;
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(padL, y);
          ctx.lineTo(w - padR, y);
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.fillText(label, w - padR - 46, y - 5);
          ctx.restore();
        };
        drawThresh(vibWarn, 'rgba(255, 184, 0, 0.85)', 'WARN');
        drawThresh(vibCrit, 'rgba(255, 51, 102, 0.9)', 'CRIT');

        const plotSeries = (arr, color, dashed, fillRgba) => {
          if (arr.length < 2) return;
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = dashed ? 1.6 : 2.5;
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

          if (fillRgba && started) {
            ctx.lineTo(lastX, padT + plotH);
            ctx.lineTo(firstX, padT + plotH);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
            grad.addColorStop(0, fillRgba);
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = grad;
            ctx.fill();
          }
          ctx.restore();
        };

        const defaultAccent = side.side === 'R' ? '#ff4d94' : '#00e5ff';
        const defaultFill = side.side === 'R' ? 'rgba(255, 77, 148, 0.28)' : 'rgba(0, 229, 255, 0.28)';
        const mainColor =
          side.severity === 'RED'
            ? '#ff3366'
            : side.severity === 'YELLOW'
              ? '#ffb800'
              : side.severity === 'SHADOW'
                ? '#c084fc'
                : defaultAccent;
        const fillColor =
          side.severity === 'RED'
            ? 'rgba(255, 51, 102, 0.3)'
            : side.severity === 'YELLOW'
              ? 'rgba(255, 184, 0, 0.26)'
              : defaultFill;

        plotSeries(oppHist, 'rgba(196, 181, 253, 0.55)', true, null);
        plotSeries(mainHist, mainColor, false, fillColor);

        ctx.fillStyle = '#9ca3c9';
        ctx.fillText('Останні 90 відліків (мм/с)', padL, h - 7);
      }

      if (fftCanvasRef.current && side) {
        const { ctx, w, h } = prepareCanvas(fftCanvasRef.current);
        ctx.fillStyle = '#09071a';
        ctx.fillRect(0, 0, w, h);

        const padL = 38;
        const padR = 14;
        const padT = 14;
        const padB = 26;
        const plotW = w - padL - padR;
        const plotH = h - padT - padB;

        const bins = online && Array.isArray(side.spectrum) ? side.spectrum : new Array(32).fill(0);
        const maxVal = Math.max(40, ...bins);

        ctx.strokeStyle = 'rgba(167, 139, 250, 0.12)';
        ctx.lineWidth = 1;
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#9ca3c9';
        for (let i = 0; i <= 4; i++) {
          const y = padT + (plotH * i) / 4;
          ctx.beginPath();
          ctx.moveTo(padL, y);
          ctx.lineTo(w - padR, y);
          ctx.stroke();
          ctx.fillText(String(Math.round(maxVal * (1 - i / 4))), 6, y + 4);
        }

        const barStep = plotW / 32;
        const barW = Math.max(3, barStep - 3);
        for (let b = 0; b < 32; b++) {
          const mag = Number(bins[b] || 0);
          const bh = (mag / maxVal) * plotH;
          const x = padL + b * barStep + 1.5;
          const y = padT + plotH - bh;
          const fCenter = b * 140 + 70;
          ctx.fillStyle = fCenter < 600 ? '#00e5ff' : fCenter < 2400 ? '#ffb800' : '#ff3366';
          ctx.fillRect(x, y, barW, Math.max(1, bh));
        }

        ctx.fillStyle = '#9ca3c9';
        [0, 700, 1400, 2100, 2800, 3500, 4480].forEach((hz) => {
          const x = padL + (hz / 4480) * plotW;
          ctx.fillText(`${hz}`, Math.min(w - 34, Math.max(padL, x - 12)), h - 7);
        });
      }
    };

    drawAll();
    window.addEventListener('resize', drawAll);
    return () => window.removeEventListener('resize', drawAll);
  }, [historyTick, selectedWheel, side, opposite, online, vibWarn, vibCrit, historyRef]);

  const getWheelSeverity = (code) => {
    const f = findWheel(state, code);
    return f?.side?.online ? f.side.severity : 'OFFLINE';
  };

  return (
    <aside className="charts-column surface" aria-label="Живий осцилограф і спектр Фур'є">
      <div className="panel-header-row">
        <div>
          <h2>Осцилограф RMS &amp; 32-смуговий спектр FFT</h2>
          <p className="panel-sub">Живий аналіз обраного колеса у парі з протилежним колесом осі.</p>
        </div>
        <div className="chart-actions">
          <button
            type="button"
            className="btn btn-sm btn-secondary btn-icon-start"
            aria-pressed={chartsFrozen}
            onClick={() => setChartsFrozen((f) => !f)}
          >
            <PauseIcon />
            <span>{chartsFrozen ? 'Продовжити' : 'Пауза'}</span>
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={clearCharts}>
            Очистити
          </button>
        </div>
      </div>

      <div className="wheel-selector-bar" role="group" aria-label="Вибір колеса для графіків">
        {visibleWheels.map((code) => (
          <button
            key={code}
            type="button"
            className="wheel-pill"
            data-side={code.endsWith('-R') ? 'R' : 'L'}
            data-severity={getWheelSeverity(code)}
            aria-pressed={selectedWheel === code}
            onClick={() => setSelectedWheel(code)}
          >
            <span className="wheel-pill-dot" aria-hidden="true" />
            <span>{code}</span>
          </button>
        ))}
      </div>

      <div className="selected-metrics-strip">
        <div className="metric-box">
          <span className="meta-label">Колесо</span>
          <strong className="tabular">{selectedWheel}</strong>
        </div>
        <div className="metric-box">
          <span className="meta-label">Вібрація RMS</span>
          <strong className="tabular">{online ? `${fmtNum(side.rmsMmS, 2)} мм/с` : 'OFFLINE'}</strong>
        </div>
        <div className="metric-box">
          <span className="meta-label">mV / fDom</span>
          <strong className="tabular">
            {online ? `${fmtNum(side.rmsMv, 0)} мВ · ${Math.round(side.fDomHz || 0)} Гц` : '—'}
          </strong>
        </div>
        <div className="metric-box">
          <span className="meta-label">Peak / Crest</span>
          <strong className="tabular">
            {online ? `${fmtNum(side.peakMmS, 1)} / ${fmtNum(side.crest, 2)}` : '—'}
          </strong>
        </div>
        <div className="metric-box">
          <span className="meta-label">Temp / ΔT</span>
          <strong className="tabular">
            {online ? `${fmtNum(side.tempC, 1)}° · Δ${fmtNum(axle?.tempDeltaC, 1)}°` : '—'}
          </strong>
        </div>
        <div className="metric-box">
          <span className="meta-label">{sideCfg.temp === 'ntc' ? 'NTC 10k' : 'SHT40 RH'}</span>
          <strong className="tabular">
            {!online
              ? '—'
              : sideCfg.temp === 'ntc'
                ? 'ADC OK'
                : side.shtOk && side.rh !== null
                  ? `${fmtNum(side.rh, 1)}%`
                  : 'I2C ERR'}
          </strong>
        </div>
        <div className="metric-box">
          <span className="meta-label">{sideCfg.vib === 'piezo_mcp6002' ? 'MCP6002 Vref' : 'Вібро-тип'}</span>
          <strong className="tabular">
            {!online
              ? '—'
              : sideCfg.vib !== 'piezo_mcp6002'
                ? getVibShort(sideCfg.vib)
                : side.dcOffsetMv !== null
                  ? `${Math.round(side.dcOffsetMv)} мВ ${side.vrefStatus}`
                  : '—'}
          </strong>
        </div>
      </div>

      <div className="charts-stack">
        <div className="canvas-frame">
          <div className="canvas-head">
            <div>
              <h3>Динаміка вібрації RMS (мм/с)</h3>
              <span className="canvas-sub">
                Суцільна — {selectedWheel} · Пунктир — {opposite?.code || '—'}
              </span>
            </div>
            <span className="pill tabular">
              Поріг: {vibWarn} / {vibCrit}
            </span>
          </div>
          <canvas ref={rmsCanvasRef} width={640} height={210} aria-label="Графік RMS вібрації" />
        </div>

        <div className="canvas-frame">
          <div className="canvas-head">
            <div>
              <h3>Спектр Фур'є (32 біни · 0 – 4480 Гц)</h3>
              <span className="canvas-sub">
                0–600 Гц дорога · 600–2400 Гц підшипник · 2400–4480 Гц гальма
              </span>
            </div>
            <span className="pill tabular">
              fDom: {online ? `${Math.round(side.fDomHz || 0)} Гц` : '— Гц'}
            </span>
          </div>
          <canvas ref={fftCanvasRef} width={640} height={210} aria-label="Графік спектру FFT" />
        </div>
      </div>
    </aside>
  );
}
