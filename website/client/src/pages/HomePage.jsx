import React, { useState } from 'react';

function HomePage({ onNavigate, onSelectCategory }) {
  // Інтерактивний калькулятор вартості заліза + SaaS для автопарку
  const [tractorsQty, setTractorsQty] = useState(2);
  const [trailersQty, setTrailersQty] = useState(2);
  const [includeStoInstall, setIncludeStoInstall] = useState(true);
  const [pilotProgram, setPilotProgram] = useState(false);

  // Форма заявки
  const [consultName, setConsultName] = useState('');
  const [consultPhone, setConsultPhone] = useState('');
  const [consultVehicle, setConsultVehicle] = useState('');
  const [consultStatus, setConsultStatus] = useState('');
  const [consultError, setConsultError] = useState('');
  const [sending, setSending] = useState(false);

  // Розрахунок за PO-моделлю (Стандарт vs Design Partners)
  const coupledSets = Math.min(tractorsQty, trailersQty);
  const extraTractors = Math.max(0, tractorsQty - coupledSets);
  const extraTrailers = Math.max(0, trailersQty - coupledSets);

  const tractorUnitUsd = pilotProgram ? 210 : 320;
  const trailerUnitUsd = pilotProgram ? 240 : 360;
  const stoPerUnitUsd = 95;

  const hardwareUsd =
    tractorsQty * tractorUnitUsd +
    trailersQty * trailerUnitUsd +
    (includeStoInstall ? Math.max(tractorsQty, trailersQty) * stoPerUnitUsd : 0);
  const hardwareUah = hardwareUsd * 42;

  const standardMonthlyUah = coupledSets * 700 + extraTractors * 450 + extraTrailers * 250;
  const monthlySaaSUah = pilotProgram ? 0 : standardMonthlyUah;
  const totalWheels = tractorsQty * 4 + trailersQty * 6;
  const euEquivalentUsd = coupledSets * 1850 + extraTractors * 950 + extraTrailers * 1050;
  const savingsUsd = Math.max(0, euEquivalentUsd - hardwareUsd);

  function goToCatalogCategory(categoryId) {
    onSelectCategory(categoryId);
    onNavigate('catalog');
  }

  async function handleConsultSubmit(e) {
    e.preventDefault();
    setConsultStatus('');
    setConsultError('');
    setSending(true);

    try {
      const res = await fetch('/api/consultations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: consultName,
          phone: consultPhone,
          fleetCount: tractorsQty + trailersQty,
          programType: pilotProgram ? 'design-partner' : 'standard-b2b',
          vehicleInfo:
            consultVehicle ||
            `${tractorsQty} тягач(і) + ${trailersQty} причеп(и), план: ${
              pilotProgram ? 'Design Partner' : 'Стандарт'
            }`
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setConsultError(data.error || 'Помилка відправки заявки.');
      } else {
        setConsultStatus(data.message);
        setConsultName('');
        setConsultPhone('');
        setConsultVehicle('');
      }
    } catch (err) {
      setConsultError('Не вдалося відправити заявку. Переконайтеся, що Node.js API запущено.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      {/* B2B Hero Banner */}
      <section className="hero-banner">
        <span className="hero-badge">B2B IoT + SaaS • Україна та закладка на ЄС</span>
        <h1>
          Захищаємо фури та причепи від руйнування ступиць, заклинювання гальм і пожежі коліс у рейсі
        </h1>
        <p>
          <strong>TechBIT</strong> замінює «досвідчене вухо» водія та дає власнику автопарку
          об’єктивний контроль усіх <strong>10 коліс зчіпки</strong>: уніфіковані осьові вузли{' '}
          <code>ESP32-C3</code> по CAN, бездротовий місток <code>ESP-NOW</code> з причепа, чорна
          скринька <code>S3 + LTE</code> у кабіні та миттєві алерти механіку в Telegram.
        </p>
        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => goToCatalogCategory('kit-coupling')}
          >
            Обрати комплектацію й ціну
          </button>
          <button
            type="button"
            className="btn btn-amber"
            onClick={() => onNavigate('admin')}
          >
            Відкрити Web-адмінку моніторингу (Демо)
          </button>
          <button
            type="button"
            className="btn btn-ghost-dark"
            onClick={() => onNavigate('about')}
          >
            Архітектура системи
          </button>
        </div>

        <div className="hero-metrics">
          <div className="hero-metric-item">
            <strong>$600–750</strong>
            <span>Повна зчіпка 10 коліс (ціна 1 шини фури)</span>
          </div>
          <div className="hero-metric-item">
            <strong>2–3x дешевше</strong>
            <span>За європейські системи (€1 200–2 500)</span>
          </div>
          <div className="hero-metric-item">
            <strong>600–800 грн/міс</strong>
            <span>Cloud SaaS + IoT SIM + Telegram-бот</span>
          </div>
          <div className="hero-metric-item">
            <strong>0 грн / 6 міс.</strong>
            <span>Підписка для Design Partners (за SLA)</span>
          </div>
        </div>
      </section>

      {/* 3 рівні доступу (без канібалізації підписки) */}
      <section className="section-box">
        <h2 className="page-title">Модель «Залізо vs Підписка»: 3 чіткі рівні доступу</h2>
        <p className="page-subtitle">
          Водій не має Bluetooth-додатку і не може «вимкнути» чи проігнорувати проблему — вся аналітика
          та історія ремонтів контролюється власником і механіком у хмарній підписці.
        </p>

        <div className="grid-3">
          <div className="info-card">
            <div className="info-card-step">Рівень 1 • Водій у кабіні (Без підписки)</div>
            <h3>Міні LED-індикатор колеса</h3>
            <p style={{ marginBottom: '12px' }}>
              Показує жовтий або червоний сигнал, опціональний зумер і точний код колеса (наприклад,{' '}
              <strong>P2-L</strong> — причеп, вісь 2, ліве). Ніякого OLED, який вигорає на сонці, та
              ніякого BLE-доступу для водія.
            </p>
            <div className="led-cluster">
              <span className="led-dot yellow" />
              <span>ALERT: P2-L</span>
              <span style={{ color: '#94a3b8' }}>| +44°C</span>
            </div>
          </div>

          <div className="info-card">
            <div className="info-card-step">Рівень 2 • Інсталятор / СТО (Сервісний BLE)</div>
            <h3>Кнопковий Web Bluetooth режим</h3>
            <p>
              Вмикається сервісною кнопкою на корпусі <code>S3</code> лише на 15 хвилин (у рейсі
              вимкнений!). Дозволяє механіку без ноутбука прив’язати вузли <code>C3</code> до позицій
              коліс, перевірити CAN / ESP-NOW / LTE та роз’єми Deutsch DT.
            </p>
          </div>

          <div className="info-card">
            <div className="info-card-step">Рівень 3 • Власник / Диспетчер (Cloud SaaS)</div>
            <h3>Telegram-алерти + Історія + ML</h3>
            <p>
              Аномалія миттєво відкриває <strong>інцидент</strong> і прилітає механіку в Telegram із
              кнопкою закриття в 2 кліки. Ви бачите ранні тренди, «чорну скриньку» за останні 3–5 хв і
              повний контроль над активом без людського фактора водія.
            </p>
          </div>
        </div>
      </section>

      {/* Інтерактивний калькулятор економіки та вартості */}
      <section className="section-box">
        <h2 className="page-title">Калькулятор комплектації та економіки автопарку</h2>
        <p className="page-subtitle">
          Розрахуйте інвестицію в обладнання (Тягач 4 кол. + Причеп 6 кол.), щомісячну SaaS-підписку
          та економію відносно європейських аналогів.
        </p>

        <div className="calc-layout">
          <div className="info-card">
            <div className="form-field">
              <label htmlFor="calc-tractors">
                Тягачі (2 осі / 4 колеса — по 2 вузли C3 + блок S3 Master):{' '}
                <strong>{tractorsQty} шт.</strong>
              </label>
              <input
                id="calc-tractors"
                type="range"
                min="0"
                max="30"
                value={tractorsQty}
                onChange={(e) => setTractorsQty(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div className="form-field">
              <label htmlFor="calc-trailers">
                Напівпричепи (3 осі / 6 коліс — по 3 вузли C3 + місток ESP-NOW):{' '}
                <strong>{trailersQty} шт.</strong>
              </label>
              <input
                id="calc-trailers"
                type="range"
                min="0"
                max="30"
                value={trailersQty}
                onChange={(e) => setTrailersQty(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={includeStoInstall}
                  onChange={(e) => setIncludeStoInstall(e.target.checked)}
                />
                <span>Включити монтаж на СТО (4–5 год, герметичні джгути Deutsch, $95/одиницю)</span>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={pilotProgram}
                  onChange={(e) => setPilotProgram(e.target.checked)}
                />
                <span>
                  <strong>Умови Design Partners</strong> (залізо за собівартістю + підписка 0 грн на 6
                  міс. за SLA 48 год)
                </span>
              </label>
            </div>
          </div>

          <div className="calc-summary-box">
            <div className="calc-row">
              <span>Коліс під безперервним контролем:</span>
              <strong>{totalWheels} коліс</strong>
            </div>
            <div className="calc-row">
              <span>Орієнтовна вартість заліза {includeStoInstall ? '+ монтаж' : ''}:</span>
              <span className="calc-total">
                {hardwareUah.toLocaleString('uk-UA')} грн (${hardwareUsd})
              </span>
            </div>
            <div className="calc-row">
              <span>Щомісячна підписка SaaS (SIM + Telegram + Хмара):</span>
              <strong style={{ color: pilotProgram ? '#1b7a48' : '#1a56a0' }}>
                {pilotProgram ? '0 грн/міс (6 міс. пілоту)' : `${monthlySaaSUah} грн/міс`}
              </strong>
            </div>
            <div className="calc-row">
              <span>Економія проти аналогів ЄС (WABCO / Continental):</span>
              <strong style={{ color: '#1b7a48' }}>~${savingsUsd.toLocaleString('uk-UA')}</strong>
            </div>
            <div style={{ marginTop: '14px', fontSize: '12.5px', color: '#526273' }}>
              Попередження всього 1 заклинювання супорта чи руйнування ступиці на трасі окупає систему на
              цілий автопоїзд.
            </div>
          </div>
        </div>
      </section>

      {/* Логіка індикації S3 */}
      <section className="section-box">
        <h2 className="page-title">Багаторівнева логіка реакції в кабіні та хмарі (MVP)</h2>
        <p className="page-subtitle">
          Жовтий і червоний пороги та тривалість фільтрації налаштовуються віддалено з хмари (JSON-конфіг) без перепрошивки.
        </p>

        <table className="logic-table">
          <thead>
            <tr>
              <th>Рівень</th>
              <th>Умова спрацювання</th>
              <th>Що бачить водій у кабіні</th>
              <th>Дія хмари та чорної скриньки S3</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className="pill pill-green">GREEN</span>
              </td>
              <td>Вібрація та температура осей у нормі; симетричні коливання на бруківці відсіяно</td>
              <td>Зелений індикатор норми</td>
              <td>Агрегований heartbeat раз на 1–5 хв (економія SIM-трафіку)</td>
            </tr>
            <tr>
              <td>
                <span className="pill pill-shadow">SHADOW</span>
              </td>
              <td>Тестовий/чутливий алгоритм зловив раннє відхилення</td>
              <td><strong>Нічого (водій не турбується)</strong></td>
              <td>S3 скидає пачку за 3–5 хв у Object Storage для навчання ML без хибних тривог</td>
            </tr>
            <tr>
              <td>
                <span className="pill pill-yellow">YELLOW</span>
              </td>
              <td>Стійка ΔT &gt; 15–20°C між L/R однієї осі або ріст вібрації &gt; 60 сек</td>
              <td>Жовтий LED + код колеса (напр. <code>P2-L</code>)</td>
              <td>Миттєвий тікет і Telegram-алерт механіку + вивантаження дампу <code>ANOMALY_BURST</code></td>
            </tr>
            <tr>
              <td>
                <span className="pill pill-red">RED</span>
              </td>
              <td>Критичний перегрів ступиці/гальм або екстремальна вібрація</td>
              <td>Червоний LED + код колеса + звуковий зумер</td>
              <td>Пріоритетний аварійний алерт власнику/диспетчеру: негайна зупинка до займання</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Заявка на пілот */}
      <section className="section-box">
        <h2 className="page-title">Замовити розрахунок або вступити у програму Design Partners</h2>
        <p className="page-subtitle">
          Шукаємо 3–5 автопарків України (20–50 фур) для пілотного впровадження на умовах заліза за собівартістю та 6 міс. безкоштовної підписки.
        </p>

        {consultStatus && (
          <div
            style={{
              backgroundColor: '#e6f4ea',
              border: '1px solid #1b7a48',
              color: '#1b7a48',
              padding: '10px 14px',
              borderRadius: '6px',
              marginBottom: '14px',
              fontSize: '14px'
            }}
          >
            {consultStatus}
          </div>
        )}

        {consultError && (
          <div
            style={{
              backgroundColor: '#fee2e2',
              border: '1px solid #b91c1c',
              color: '#b91c1c',
              padding: '10px 14px',
              borderRadius: '6px',
              marginBottom: '14px',
              fontSize: '14px'
            }}
          >
            {consultError}
          </div>
        )}

        <form className="consult-grid" onSubmit={handleConsultSubmit}>
          <div>
            <label htmlFor="consult-name" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
              Компанія / Контакт *
            </label>
            <input
              id="consult-name"
              type="text"
              className="filter-input"
              placeholder="Напр.: Іван, Агро-Транс"
              value={consultName}
              onChange={(e) => setConsultName(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="consult-phone" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
              Телефон *
            </label>
            <input
              id="consult-phone"
              type="tel"
              className="filter-input"
              placeholder="+380..."
              value={consultPhone}
              onChange={(e) => setConsultPhone(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="consult-vehicle" style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>
              Склад парку / причепи
            </label>
            <input
              id="consult-vehicle"
              type="text"
              className="filter-input"
              placeholder="Напр.: 8 тягачів DAF + зерновози"
              value={consultVehicle}
              onChange={(e) => setConsultVehicle(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={sending}>
            {sending ? 'Відправка...' : 'Залишити заявку'}
          </button>
        </form>
      </section>
    </div>
  );
}

export default HomePage;
