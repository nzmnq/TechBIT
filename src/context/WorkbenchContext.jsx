import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export const WHEEL_CODES = [
  'T1-L', 'T1-R',
  'T2-L', 'T2-R',
  'P1-L', 'P1-R',
  'P2-L', 'P2-R',
  'P3-L', 'P3-R',
];

export const PROFILE_WHEEL_MAP = {
  mvp_front: ['T1-L', 'T1-R'],
  tractor_4: ['T1-L', 'T1-R', 'T2-L', 'T2-R'],
  full_10: WHEEL_CODES,
};

export const VIB_OPTIONS = [
  { value: 'piezo_mcp6002', label: "П'єзо MCP6002 + BAT54S", short: "П'єзо MCP6002" },
  { value: 'piezo_direct', label: "П'єзо прямий (ADC)", short: "П'єзо прямий" },
  { value: 'mems_imu', label: 'Акселерометр (MEMS/IMU)', short: 'MEMS / IMU' },
];

export const TEMP_OPTIONS = [
  { value: 'sht40', label: 'GY-SHT40 (I2C · RH%)', short: 'GY-SHT40' },
  { value: 'ntc', label: 'NTC 10k (ADC)', short: 'NTC 10k' },
  { value: 'dual', label: 'GY-SHT40 + NTC резерв', short: 'SHT40 + NTC' },
];

export const S3_MODE_OPTIONS = [
  { value: 's3_can_lte_led', label: 'CAN + LTE + Mini-LED', short: 'CAN + LTE + LED' },
  { value: 's3_usb_bench', label: 'USB / Wi-Fi Стенд', short: 'USB/Wi-Fi Стенд' },
  { value: 's3_ble_bridge', label: 'CAN + BLE 15м + Bridge', short: 'CAN + BLE + Bridge' },
];

export const S3_LINK_OPTIONS = [
  { value: 'can_500k', label: 'CAN 500 kbps (TJA/SN65)', short: 'CAN 500k' },
  { value: 'usb_direct', label: 'USB Serial (115200)', short: 'USB Direct' },
  { value: 'wifi_push', label: 'Wi-Fi HTTP Push JSON', short: 'Wi-Fi Push' },
];

export const REASON_LABELS = {
  NORMAL: 'Норма',
  TEMP_CRITICAL_BRAKE: 'Критичний перегрів гальма',
  TEMP_DELTA_HIGH: 'Перевищення ΔT на осі',
  ML_BEARING_IMPULSE: 'ML: Імпульси підшипника (Kurt+HF)',
  BASELINE_ZSCORE_DRIFT: 'Відхилення від норми авто (Z-score)',
  VIB_ANOMALY_LOCAL: 'Локальна вібрація вузла',
  COBBLESTONE_FILTERED: 'Фільтр бруківки',
  POTHOLE_GUARD: 'Фільтр удару в яму',
  SHADOW_EARLY_DRIFT: 'Shadow Mode (дрейф)',
};

export const SEVERITY_LABELS = {
  STANDBY: 'ОЧІКУВАННЯ',
  GREEN: 'НОРМА (GREEN)',
  YELLOW: 'УВАГА · ПЕРЕВІРИТИ',
  RED: 'СТОП · КРИТИЧНО',
  SHADOW: 'SHADOW',
  OFFLINE: 'OFFLINE',
};

export const SOURCE_LABELS = {
  waiting: 'ОЧІКУВАННЯ',
  serial: 'USB SERIAL',
  wifi: 'WI-FI PUSH',
  ip_poll: 'ESP IP POLL',
  simulator: 'СИМУЛЯТОР',
};

export const RESOLUTION_OPTIONS = [
  { code: 'BEARING_FAULT', label: 'Підшипник' },
  { code: 'BRAKE_STUCK', label: 'Гальмо' },
  { code: 'TIRE_ISSUE', label: 'Шина' },
  { code: 'SENSOR_FAULT', label: 'Датчик' },
  { code: 'FALSE_POSITIVE', label: 'Хибний' },
];

export function getVibShort(val) {
  return VIB_OPTIONS.find((x) => x.value === val)?.short || val;
}

export function getTempShort(val) {
  return TEMP_OPTIONS.find((x) => x.value === val)?.short || val;
}

export function getS3ModeShort(val) {
  return S3_MODE_OPTIONS.find((x) => x.value === val)?.short || val;
}

export function getS3LinkShort(val) {
  return S3_LINK_OPTIONS.find((x) => x.value === val)?.short || val;
}

export function fmtNum(val, digits = 1, fallback = '—') {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return fallback;
  return Number(val).toFixed(digits);
}

export function fmtUtcTime(iso) {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return d.toISOString().slice(11, 19);
}

const WorkbenchContext = createContext(null);

export function WorkbenchProvider({ children }) {
  const [state, setState] = useState(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [selectedWheel, setSelectedWheel] = useState('T1-L');
  const [chartsFrozen, setChartsFrozen] = useState(false);
  const [localLogs, setLocalLogs] = useState([]);
  const [simScenario, setSimScenario] = useState('smooth');
  const [serialSlots, setSerialSlots] = useState({ 1: 'T1-L', 2: 'T1-R' });
  const [serialMeta, setSerialMeta] = useState({
    1: { connected: false, rxCount: 0 },
    2: { connected: false, rxCount: 0 },
  });

  const historyRef = useRef(Object.fromEntries(WHEEL_CODES.map((c) => [c, []])));
  const [historyTick, setHistoryTick] = useState(0);
  const frozenRef = useRef(false);
  frozenRef.current = chartsFrozen;

  const serialSlotsRef = useRef(serialSlots);
  serialSlotsRef.current = serialSlots;

  const serialPortsRef = useRef({
    1: { port: null, reader: null, writer: null, reading: false },
    2: { port: null, reader: null, writer: null, reading: false },
  });

  const pushLocalLog = useCallback((tag, text) => {
    setLocalLogs((prev) => {
      const next = [...prev, { ts: new Date().toISOString(), tag, text: String(text).slice(0, 260) }];
      return next.slice(-40);
    });
  }, []);

  const postCommand = useCallback(async (payload) => {
    try {
      const resp = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      if (json?.state) setState(json.state);
      return json;
    } catch (err) {
      pushLocalLog('ERR', `Помилка команди: ${err.message}`);
      return null;
    }
  }, [pushLocalLog]);

  const updateConfig = useCallback((configPatch) => {
    return postCommand({ action: 'config', config: configPatch });
  }, [postCommand]);

  const updateModuleSensor = useCallback((moduleKey, field, value) => {
    return postCommand({
      action: 'config',
      config: {
        moduleSensors: {
          [moduleKey]: { [field]: value },
        },
      },
    });
  }, [postCommand]);

  const writeSerialLine = useCallback(async (portIdx, line) => {
    const slot = serialPortsRef.current[portIdx];
    if (!slot || !slot.writer) return false;
    try {
      await slot.writer.write(new TextEncoder().encode(`${String(line).trim()}\n`));
      return true;
    } catch (err) {
      pushLocalLog(`USB${portIdx}`, `Помилка запису: ${err.message}`);
      return false;
    }
  }, [pushLocalLog]);

  const sendCliCommand = useCallback(async (cmd, target = 'all') => {
    const clean = String(cmd || '').trim();
    if (!clean) return;
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
  }, [postCommand, pushLocalLog, writeSerialLine]);

  const disconnectSerialPort = useCallback(async (portIdx) => {
    const slot = serialPortsRef.current[portIdx];
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
    setSerialMeta((prev) => ({ ...prev, [portIdx]: { connected: false, rxCount: 0 } }));
    pushLocalLog(`USB${portIdx}`, 'Порт відключено.');
  }, [pushLocalLog]);

  const toggleSerialPort = useCallback(async (portIdx) => {
    if (typeof navigator === 'undefined' || !('serial' in navigator)) {
      pushLocalLog('USB', 'Web Serial працює у Chrome / Edge. Використовуйте Wi-Fi Push або IP Poll.');
      return;
    }
    const slot = serialPortsRef.current[portIdx];
    if (slot.port && slot.reading) {
      await disconnectSerialPort(portIdx);
      return;
    }

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      slot.port = port;
      slot.reading = true;
      if (port.writable) slot.writer = port.writable.getWriter();
      setSerialMeta((prev) => ({ ...prev, [portIdx]: { connected: true, rxCount: 0 } }));
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
          if (!line.startsWith('{') || !line.endsWith('}')) {
            pushLocalLog(`USB${portIdx}`, line);
            continue;
          }
          try {
            const json = JSON.parse(line);
            setSerialMeta((prev) => ({
              ...prev,
              [portIdx]: { connected: true, rxCount: prev[portIdx].rxCount + 1 },
            }));
            const slotOverride = serialSlotsRef.current[portIdx];
            json._source = 'serial';
            if (slotOverride && slotOverride !== 'auto') json._slotOverride = slotOverride;
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
            pushLocalLog(`USB${portIdx}`, line);
          }
        }
      }
    } catch (err) {
      if (err && err.name !== 'NotFoundError') {
        pushLocalLog(`USB${portIdx}`, `Помилка Serial: ${err.message}`);
      }
    } finally {
      if (slot.port) await disconnectSerialPort(portIdx);
    }
  }, [disconnectSerialPort, pushLocalLog, writeSerialLine]);

  const clearCharts = useCallback(() => {
    for (const code of WHEEL_CODES) historyRef.current[code] = [];
    setHistoryTick((t) => t + 1);
  }, []);

  // Single persistent SSE subscription across all React Router pages
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onopen = () => setSseConnected(true);
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        setSseConnected(true);
        setState(data);
        if (!frozenRef.current && Array.isArray(data.axles)) {
          for (const ax of data.axles) {
            for (const side of [ax.left, ax.right]) {
              const arr = historyRef.current[side.code];
              if (!arr) continue;
              arr.push(side.online ? Number(side.rmsMmS || 0) : null);
              if (arr.length > 90) arr.shift();
            }
          }
          setHistoryTick((t) => t + 1);
        }
      } catch (_) {}
    };
    es.onerror = () => setSseConnected(false);
    return () => es.close();
  }, []);

  // Keep selectedWheel inside active rig profile
  useEffect(() => {
    const profileId = state?.config?.rigProfile || 'mvp_front';
    const allowed = PROFILE_WHEEL_MAP[profileId] || WHEEL_CODES;
    if (!allowed.includes(selectedWheel)) {
      setSelectedWheel(allowed[0]);
    }
  }, [state?.config?.rigProfile, selectedWheel]);

  const serialSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

  const value = useMemo(() => ({
    state,
    sseConnected,
    selectedWheel,
    setSelectedWheel,
    chartsFrozen,
    setChartsFrozen,
    historyRef,
    historyTick,
    clearCharts,
    localLogs,
    pushLocalLog,
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
  }), [
    state,
    sseConnected,
    selectedWheel,
    chartsFrozen,
    historyTick,
    clearCharts,
    localLogs,
    pushLocalLog,
    simScenario,
    serialSupported,
    serialSlots,
    serialMeta,
    toggleSerialPort,
    postCommand,
    updateConfig,
    updateModuleSensor,
    sendCliCommand,
  ]);

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench() {
  const ctx = useContext(WorkbenchContext);
  if (!ctx) throw new Error('useWorkbench must be used inside WorkbenchProvider');
  return ctx;
}
