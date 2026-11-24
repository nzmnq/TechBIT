import React, { useEffect, useState } from 'react';
import { LOCALES, formatUtcToLocal } from '../i18n';

const RESOLUTIONS = [
  'BEARING_FAULT',
  'BRAKE_STUCK',
  'TIRE_ISSUE',
  'SENSOR_FAULT',
  'FALSE_POSITIVE'
];

function AdminPage({ locale = 'uk' }) {
  const t = LOCALES[locale] || LOCALES.uk;
  const [activeTab, setActiveTab] = useState('fleet');
  const [fleet, setFleet] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [lastTelegram, setLastTelegram] = useState(null);
  const [actionMsg, setActionMsg] = useState('');
  const [configDraft, setConfigDraft] = useState(null);

  async function loadAll() {
    try {
      const [fleetRes, incRes] = await Promise.all([
        fetch('/api/fleet'),
        fetch(`/api/incidents?status=${statusFilter}`)
      ]);
      if (fleetRes.ok) {
        const flData = await fleetRes.json();
        setFleet(flData);
        if (flData.tractors && flData.tractors[0] && !configDraft) {
          setConfigDraft(flData.tractors[0].thresholds_config);
        }
      }
      if (incRes.ok) {
        const incData = await incRes.json();
        setIncidents(incData.items || []);
      }
    } catch (err) {
      // ignore if offline
    }
  }

  useEffect(() => {
    loadAll();
  }, [statusFilter]);

  async function simulateIngestBurst(severityMode) {
    setActionMsg('');
    const eventId = `evt-${Math.random().toString(16).slice(2, 10)}`;
    const payload = {
      protocol_version: 1,
      device_id: 'S3_A1B2C3',
      timestamp_utc: new Date().toISOString(),
      tractor_id: 'TR_001',
      trailer_id: 'TL_042',
      packet_type: 'ANOMALY_BURST',
      event_id: eventId,
      severity: severityMode,
      trigger_node_id: 'C3_998877',
      trigger_reason: severityMode === 'RED' ? 'TEMP_CRITICAL_BRAKE' : 'TEMP_DELTA_HIGH',
      summary: [
        {
          node_id: 'C3_998877',
          temp_c: severityMode === 'RED' ? 104.2 : 81.5,
          vib_rms: severityMode === 'RED' ? 6.8 : 4.3,
          vib_peak: 15.2,
          flags: 1
        },
        {
          node_id: 'C3_998878',
          temp_c: 34.1,
          vib_rms: 1.05,
          vib_peak: 3.1,
          flags: 0
        }
      ],
      burst_samples_base64: 'VGVjaEJpdF9CbGFja0JveF9SYXdCdXJzdF9WMQ=='
    };

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        setLastTelegram(data.notification);
        setActionMsg(
          `Пакет ${severityMode} прийнято в POST /api/ingest! Створено інцидент ${data.ticket.ticket_id} та дамп чорної скриньки.`
        );
        await loadAll();
      }
    } catch (err) {
      setActionMsg('Помилка з’єднання з сервером ingest.');
    }
  }

  async function resolveIncident(ticketId, resolutionCode) {
    setActionMsg('');
    try {
      const res = await fetch(`/api/incidents/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'CLOSED',
          resolution_code: resolutionCode,
          mechanic_comment: `Закрито механіком у 2 кліки (${resolutionCode})`,
          resolved_by: 'mechanic_telegram_bot'
        })
      });
      if (res.ok) {
        setActionMsg(`Інцидент ${ticketId} розмічено як ${resolutionCode} для навчальної бази ML!`);
        await loadAll();
      }
    } catch (err) {
      setActionMsg('Не вдалося оновити інцидент.');
    }
  }

  async function saveRemoteConfig(e) {
    e.preventDefault();
    if (!configDraft) return;
    setActionMsg('');
    try {
      const res = await fetch('/api/devices/S3_A1B2C3/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configDraft)
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg(data.message);
        await loadAll();
      }
    } catch (err) {
      setActionMsg('Не вдалося оновити конфігурацію.');
    }
  }

  return (
    <div>
      <div className="section-box" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          <div>
            <span className="hero-badge hero-badge-light">Software Spec 5.2 • Cloud Web Admin MVP</span>
            <h1 className="page-title" style={{ marginBottom: '4px' }}>
              Консоль моніторингу автопарку та Ground Truth ML
            </h1>
            <p className="page-subtitle" style={{ marginBottom: 0 }}>
              Роздільна модель <code>Tractor</code> / <code>Trailer</code> / <code>SensorNode</code>, прийом пачок з чорної скриньки <code>S3 → Cloud</code>, закриття тікетів механіком та віддалений конфіг.
            </p>
          </div>
          <a href="/api/dataset/export?format=csv" className="btn btn-secondary btn-sm">
            Експорт ML-датасету (CSV)
          </a>
        </div>
      </div>

      {actionMsg && (
        <div
          style={{
            backgroundColor: '#e6effa',
            border: '1px solid #1a56a0',
            color: '#13417a',
            padding: '10px 14px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontSize: '13.5px',
            fontWeight: 600
          }}
        >
          {actionMsg}
        </div>
      )}

      <div className="tabs-bar">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'fleet' ? 'active' : ''}`}
          onClick={() => setActiveTab('fleet')}
        >
          1. Зчіпки та вузли (Drop & Hook)
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'incidents' ? 'active' : ''}`}
          onClick={() => setActiveTab('incidents')}
        >
          2. Інциденти та Telegram-бот ({incidents.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
          onClick={() => setActiveTab('config')}
        >
          3. Конфігуратор порогів S3 та BLE
        </button>
      </div>

      {activeTab === 'fleet' && fleet && (
        <div>
          <div className="grid-2" style={{ marginBottom: '20px' }}>
            {fleet.tractors.map((tr) => {
              const attached = fleet.trailers.find((tl) => tl.id === tr.attached_trailer_id);
              return (
                <div key={tr.id} className="info-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span className="pill pill-green">ONLINE • LTE</span>
                    <span className="sku-tag">{tr.s3_device_id}</span>
                  </div>
                  <h3>Тягач: {tr.plate_number}</h3>
                  <p style={{ marginBottom: '8px' }}>
                    <strong>Причеплений причеп (ESP-NOW):</strong>{' '}
                    {attached ? `${attached.plate_number} (RSSI ${attached.esp_now_rssi} dBm)` : 'Без причепа'}
                  </p>
                  <div style={{ fontSize: '12.5px', color: '#526273' }}>
                    <div>Останній зв’язок (локальний час з UTC): {formatUtcToLocal(tr.last_seen_utc)}</div>
                    <div>
                      Firmware: <code>{tr.firmware_version}</code> • Config: <code>v{tr.config_version}</code> •{' '}
                      Shadow Mode: <strong>{tr.thresholds_config?.shadow_mode_enabled ? 'ON' : 'OFF'}</strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <section className="section-box">
            <h2 className="page-title">Телеметрія осьових вузлів C3 Node (Одиниці SI: °C, mm/s)</h2>
            <table className="logic-table">
              <thead>
                <tr>
                  <th>Node ID</th>
                  <th>Актив / Вісь</th>
                  <th>Ліве колесо (Temp / Vib)</th>
                  <th>Праве колесо (Temp / Vib)</th>
                  <th>ΔT осі</th>
                  <th>Час (Локальний / UTC)</th>
                </tr>
              </thead>
              <tbody>
                {fleet.sensor_nodes.map((node) => {
                  const delta = Math.abs(node.temp_l_c - node.temp_r_c).toFixed(1);
                  const hot = Number(delta) >= 15;
                  return (
                    <tr key={node.node_id}>
                      <td>
                        <code>{node.node_id}</code>
                      </td>
                      <td>
                        {node.asset_type === 'trailer' ? 'Причеп' : 'Тягач'} • Вісь {node.axle_num}
                      </td>
                      <td>
                        <strong>{node.code_l}</strong>: {node.temp_l_c} °C / {node.vib_rms_l} mm/s
                      </td>
                      <td>
                        <strong>{node.code_r}</strong>: {node.temp_r_c} °C / {node.vib_rms_r} mm/s
                      </td>
                      <td>
                        <span className={`pill ${hot ? 'pill-yellow' : 'pill-green'}`}>ΔT {delta}°C</span>
                      </td>
                      <td style={{ fontSize: '12px', color: '#526273' }}>
                        {formatUtcToLocal(node.updated_at_utc)}
                        <br />
                        <code>{node.updated_at_utc}</code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {activeTab === 'incidents' && (
        <div>
          <section className="section-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
              <div>
                <h2 className="page-title" style={{ marginBottom: '4px' }}>
                  Тест прийому пакета S3 → Cloud (`POST /api/ingest`)
                </h2>
                <p style={{ fontSize: '13.5px', color: '#526273', marginBottom: 0 }}>
                  Імітує відправку чорною скринькою <code>ANOMALY_BURST</code> по LTE та миттєве створення інциденту + алерта в Telegram.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-amber btn-sm" onClick={() => simulateIngestBurst('YELLOW')}>
                  + Симулювати YELLOW
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ backgroundColor: '#b91c1c' }}
                  onClick={() => simulateIngestBurst('RED')}
                >
                  + Симулювати RED
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => simulateIngestBurst('SHADOW')}
                >
                  + Симулювати SHADOW
                </button>
              </div>
            </div>

            {lastTelegram && (
              <div className="telegram-card">
                <strong>TelegramNotifier • Повідомлення механіку в групу автопарку:</strong>
                {lastTelegram.suppressedForDriver && (
                  <span className="pill pill-shadow" style={{ marginLeft: '8px' }}>
                    Водію в кабіні НЕ показано (Shadow Mode)
                  </span>
                )}
                <pre className="telegram-pre">{lastTelegram.text}</pre>
              </div>
            )}
          </section>

          <section className="section-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
              <h2 className="page-title" style={{ marginBottom: 0 }}>
                Журнал інцидентів та розмітка механіка (Ground Truth)
              </h2>
              <select
                className="filter-select"
                style={{ width: 'auto' }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">Усі статуси</option>
                <option value="OPEN">Відкриті (OPEN)</option>
                <option value="CLOSED">Закриті (CLOSED)</option>
              </select>
            </div>

            <table className="logic-table">
              <thead>
                <tr>
                  <th>Тікет / Час</th>
                  <th>Авто / Вузол</th>
                  <th>Рівень &amp; Метрики</th>
                  <th>Діагноз (Ground Truth) / Закрити в 2 кліки</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc) => {
                  const sev = inc.event?.severity || 'YELLOW';
                  const pillCls =
                    sev === 'RED' ? 'pill-red' : sev === 'SHADOW' ? 'pill-shadow' : 'pill-yellow';
                  return (
                    <tr key={inc.ticket_id}>
                      <td>
                        <strong>{inc.ticket_id}</strong>
                        <div style={{ fontSize: '12px', color: '#526273' }}>
                          {formatUtcToLocal(inc.event?.created_at_utc)}
                        </div>
                        <span className={`pill ${inc.status === 'OPEN' ? 'pill-yellow' : 'pill-green'}`}>
                          {inc.status}
                        </span>
                      </td>
                      <td>
                        <div>
                          <strong>{inc.tractor_plate}</strong> + {inc.trailer_plate}
                        </div>
                        <div style={{ fontSize: '12.5px', color: '#526273' }}>{inc.wheel_label}</div>
                      </td>
                      <td>
                        <span className={`pill ${pillCls}`}>{sev}</span>
                        <div style={{ fontSize: '12.5px', marginTop: '4px' }}>
                          {inc.event?.temp_c}°C (ΔT +{inc.event?.peer_temp_delta_c}°C) • RMS {inc.event?.vib_rms} mm/s
                        </div>
                      </td>
                      <td>
                        {inc.status === 'CLOSED' ? (
                          <div>
                            <span className="pill pill-gray">
                              {t.resolutions[inc.resolution_code] || inc.resolution_code}
                            </span>
                            {inc.mechanic_comment && (
                              <div style={{ fontSize: '12px', color: '#526273', marginTop: '4px' }}>
                                {inc.mechanic_comment}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {RESOLUTIONS.map((code) => (
                              <button
                                key={code}
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => resolveIncident(inc.ticket_id, code)}
                              >
                                {t.resolutions[code] || code}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {activeTab === 'config' && configDraft && (
        <div className="grid-2">
          <section className="section-box">
            <h2 className="page-title">Віддалений JSON-конфіг порогів для S3_A1B2C3</h2>
            <p className="page-subtitle">
              Пороги не зашиті намертво в код — при зміні тут бекенд пушить новий JSON по LTE (OTA Config).
            </p>
            <form onSubmit={saveRemoteConfig}>
              <div className="grid-2" style={{ gap: '10px' }}>
                <div className="form-field">
                  <label>Жовтий поріг температури (°C)</label>
                  <input
                    type="number"
                    className="filter-input"
                    value={configDraft.temp_warn_c}
                    onChange={(e) => setConfigDraft({ ...configDraft, temp_warn_c: Number(e.target.value) })}
                  />
                </div>
                <div className="form-field">
                  <label>Червоний поріг температури (°C)</label>
                  <input
                    type="number"
                    className="filter-input"
                    value={configDraft.temp_crit_c}
                    onChange={(e) => setConfigDraft({ ...configDraft, temp_crit_c: Number(e.target.value) })}
                  />
                </div>
                <div className="form-field">
                  <label>Поріг ΔT між L/R осі (°C)</label>
                  <input
                    type="number"
                    className="filter-input"
                    value={configDraft.axle_temp_delta_warn_c}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, axle_temp_delta_warn_c: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="form-field">
                  <label>Гістерезис YELLOW (сек)</label>
                  <input
                    type="number"
                    className="filter-input"
                    value={configDraft.yellow_confirm_sec}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, yellow_confirm_sec: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="form-field" style={{ marginTop: '8px' }}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={Boolean(configDraft.shadow_mode_enabled)}
                    onChange={(e) =>
                      setConfigDraft({ ...configDraft, shadow_mode_enabled: e.target.checked })
                    }
                  />
                  <span>Увімкнути Shadow Mode (писати експериментальні аномалії в БД, не запалювати LED водію)</span>
                </label>
              </div>

              <button type="submit" className="btn btn-primary" style={{ marginTop: '10px' }}>
                Зберегти та відправити конфіг у S3
              </button>
            </form>
          </section>

          <section className="section-box">
            <h2 className="page-title">Сервісний режим інсталятора (Web Bluetooth API)</h2>
            <p className="page-subtitle">
              На СТО електрик натискає сервісну кнопку на корпусі <code>S3</code> — BLE вмикається на 15 хв для швидкої прив’язки MAC-адрес без пайки.
            </p>
            <div className="product-specs">
              <div>
                <strong>Виявлений вузол 1 (CAN Тягач):</strong> <code>C3_110011</code> → Призначено: <code>TRACTOR_A1 (T1-L/R)</code>
              </div>
              <div>
                <strong>Виявлений вузол 2 (CAN Тягач):</strong> <code>C3_110012</code> → Призначено: <code>TRACTOR_A2 (T2-L/R)</code>
              </div>
              <div>
                <strong>Виявлений місток (ESP-NOW -54 dBm):</strong> <code>BR_042 (TL_042)</code> → 3 осі причепа онлайн
              </div>
              <div>
                <strong>Тест індикатора кабіни:</strong> Кнопка <code>[TEST YELLOW/RED P2-L]</code> активна в режимі сервісу
              </div>
            </div>
            <p style={{ fontSize: '12.5px', color: '#526273', marginTop: '10px' }}>
              Примітка: У рейсі BLE повністю вимкнений на рівні прошивки <code>S3</code>, щоб радіоканал 2.4 ГГц працював стабільно з <code>ESP-NOW</code>, а водій не мав доступу до сервісу.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

export default AdminPage;
