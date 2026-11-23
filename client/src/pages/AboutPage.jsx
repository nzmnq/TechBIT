import React, { useEffect, useState } from 'react';

function AboutPage({ onNavigate }) {
  const [aboutData, setAboutData] = useState(null);

  useEffect(() => {
    async function loadAbout() {
      try {
        const res = await fetch('/api/about');
        if (res.ok) setAboutData(await res.json());
      } catch (err) {
        // Fallback below
      }
    }
    loadAbout();
  }, []);

  const teamMembers = aboutData?.teamMembers || [
    {
      name: 'Назарій Доскочинський',
      role: 'Hardware Architecture & 24V Electronics',
      email: 'nazar.doskochynskyi@gmail.com',
      responsibility:
        'Проєктування осьових вузлів C3 IP69K, захисту живлення Load Dump 40–60V, LTE/PSRAM контролера S3 та джгутів Deutsch DT / AMP Superseal.'
    },
    {
      name: 'Тарас Недовіз',
      role: 'Firmware DSP/ESP-NOW & Cloud Software',
      email: 'nedovizt26@gmail.com',
      responsibility:
        'Прошивка ESP32-C3 / S3, бездротовий місток причепа ESP-NOW LR AES-128, чорна скринька, хмарний Ingest API та пайплайн ML.'
    },
    {
      name: 'Матвій Івков',
      role: 'Mechanical Mounting, Field Testing & STO Rollout',
      email: 'matviyivk3@gmail.com',
      responsibility:
        'Кріплення на ступицях, термостійкі герметичні корпуси, випробування на пілотних автопарках і навчання партнерських СТО.'
    }
  ];

  return (
    <div>
      <section className="section-box">
        <span className="hero-badge hero-badge-light">Про платформу TechBIT</span>
        <h1 className="page-title">
          Запускаємось в Україні з архітектурною закладкою під ринок ЄС
        </h1>
        <p className="page-subtitle">
          В Україні через старіший автопарк та складні дороги підшипники й гальма ламаються в рази частіше — це дозволяє за 3–6 місяців зібрати унікальний датасет реальних поломок (Data Moat) для предиктивної ML-моделі.
        </p>

        <div className="grid-3">
          <div className="info-card">
            <h3>Цифрові осі без наводок</h3>
            <p>
              На передній осі також стоїть вузол <code>C3</code> (ніяких аналогових кабелів 2–3 м у кабіну!). Оцифровка відбувається біля ступиці, а у кабіну на <code>S3</code> йдуть захищені цифрові пакети по CAN.
            </p>
          </div>

          <div className="info-card">
            <h3>Чому ESP-NOW, а не перекидка чи LoRa</h3>
            <p>
              CAN через перекидку причепа рветься й ловить завади 24V, а LoRa 868 МГц має ліміт ефіру 1% у ЄС і не пропустить 50 КБ дампу чорної скриньки. <code>ESP-NOW LR AES-128</code> дає зв’язок за ~1 с без втручання в ABS.
            </p>
          </div>

          <div className="info-card">
            <h3>Закладка на ЄС з першого дня</h3>
            <p>
              Роздільна БД <code>Tractor / Trailer / Node</code> (Drop & Hook), LTE-модем із європейськими діапазонами B1/B3/B7/B8/B20, таймстемпи строго в <code>UTC</code>, одиниці СІ, i18n та готова шина для J1939 і Wialon/Webfleet.
            </p>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Етапи масштабування продукту</h2>
        <div className="grid-3" style={{ marginTop: '12px' }}>
          <div className="info-card">
            <div className="info-card-step">MVP Зараз (Україна)</div>
            <h3>Rule-based + Black Box</h3>
            <p>
              Жорсткі фізичні пороги (ΔT, вібрація) + міні LED-індикатор + Telegram-тікети для збору перших 50–100 підтверджених діагнозів.
            </p>
          </div>

          <div className="info-card">
            <div className="info-card-step">Фаза 1 (4–9 міс.)</div>
            <h3>ML RUL-прогноз та J1939</h3>
            <p>
              Попередження за 500–3 000 км до аварії, читання помилок бортового комп’ютера J1939 (Read-Only), вебхуки в Wialon і ROI-звіти для власника.
            </p>
          </div>

          <div className="info-card">
            <div className="info-card-step">Фаза 2 (ЄС / 9–18 міс.)</div>
            <h3>E-mark (UN ECE R10) & HaaS</h3>
            <p>
              Сертифікація для лізингових парків, автономний причеп (NB-IoT + АКБ), інтеграції Webfleet/Samsara та знижки на страхування КАСКО від пожеж.
            </p>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Команда TechBIT</h2>
        <div className="grid-3" style={{ marginTop: '12px' }}>
          {teamMembers.map((member) => (
            <div key={member.email} className="info-card">
              <div className="info-card-step">{member.role}</div>
              <h3>{member.name}</h3>
              <p style={{ marginBottom: '10px' }}>{member.responsibility}</p>
              <div style={{ fontSize: '12.5px', color: '#1a56a0', fontWeight: 600 }}>
                <a href={`mailto:${member.email}`}>{member.email}</a>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Готові обговорити пілот для автопарку?</h2>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '12px' }}>
          <button type="button" className="btn btn-primary" onClick={() => onNavigate('catalog')}>
            Перейти в каталог B2B
          </button>
          <button type="button" className="btn btn-amber" onClick={() => onNavigate('admin')}>
            Спробувати консоль моніторингу
          </button>
          <a href="https://t.me" target="_blank" rel="noreferrer" className="btn btn-secondary">
            Telegram
          </a>
          <a href="mailto:nedovizt26@gmail.com" className="btn btn-secondary">
            nedovizt26@gmail.com
          </a>
        </div>
      </section>
    </div>
  );
}

export default AboutPage;
