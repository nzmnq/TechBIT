import React, { useEffect, useState } from 'react';

function AboutPage() {
  const [aboutData, setAboutData] = useState(null);

  useEffect(() => {
    async function loadAbout() {
      try {
        const res = await fetch('/api/about');
        if (res.ok) {
          const data = await res.json();
          setAboutData(data);
        }
      } catch (err) {
        // Використовуємо локальні дані за замовчуванням
      }
    }
    loadAbout();
  }, []);

  const teamMembers = aboutData?.teamMembers || [
    {
      name: 'Назарій Доскочинський',
      role: 'Hardware Engineer / Lead',
      email: 'nazar.doskochynskyi@gmail.com',
      responsibility:
        'Схемотехніка, аналоговий каскад (MCP6002-I/P, Vref=1.65В, K=3), розводка плати в KiCad, пайка та тестування захисту від перенапруг.'
    },
    {
      name: 'Тарас Недовіз',
      role: 'Firmware Engineer',
      email: 'nedovizt26@gmail.com',
      responsibility:
        'Прошивка периферійних ESP32-C3 SuperMini та центральної ESP32-S3: АЦП 20 kSPS через DMA, алгоритм RMS, передача пакетів по CAN-шині (500 kbps).'
    },
    {
      name: 'Матвій Івков',
      role: 'Mechanical Engineer',
      email: 'matviyivk3@gmail.com',
      responsibility:
        'Розробка кріплення датчиків детонації до ходової частини, проєктування герметичного корпусу IP67, калібрування та польові тести.'
    }
  ];

  const steps = aboutData?.howItWorks || [
    {
      step: '01',
      title: '4 датчики та аналоговий каскад',
      text: 'На кожне колесо встановлюється п’єзоелектричний датчик вібрації з каскадним підсилювачем на MCP6002-I/P (K=3, Vref=1.65В) і двоступеневим захистом BAT54 від ударів у ямах. Живлення подається від акумулятора у статусі ключа ACC через перетворювачі MP1584EN та Mini360.'
    },
    {
      step: '02',
      title: 'Оцифровка 20 kSPS та шина CAN',
      text: 'Колісні мікроконтролери ESP32-C3 SuperMini безперервно зчитують сигнал на частоті 20 kSPS через DMA, обчислюють середньоквадратичну амплітуду (RMS) і передають пакети по CAN-шині (SN65HVD230, 500 kbps) на центральний модуль ESP32-S3.'
    },
    {
      step: '03',
      title: 'Порівняння коліс та фільтрація поганої дороги',
      text: 'Система порівнює показники всіх коліс між собою. Одночасні сильні вібрації на всіх колесах під час руху по бруківці чи ямах розпізнаються як дорожнє покриття і не викликають хибної тривоги.'
    },
    {
      step: '04',
      title: 'ML-класифікація та сигнал на ТО',
      text: 'Машинне навчання та RMS-алгоритм відрізняють разовий удар від ями від тривалої аномалії (>3 секунд) та перегріву на одному колесі, вчасно попереджаючи водія про необхідність звернутися на ТО.'
    }
  ];

  return (
    <div>
      <section className="section-box">
        <span className="hero-badge">About Us / Паспорт проєкту</span>
        <h1 className="page-title">
          Команда TechBIT — Автономна система вібраційного моніторингу підшипників маточини та підклинювання гальм
        </h1>
        <p className="page-subtitle" style={{ marginBottom: '12px' }}>
          Напрям розробки: <strong>Автомобільна телеметрія та IoT (Embedded Automotive IoT)</strong>
        </p>
        <p style={{ color: '#52606d', marginBottom: '12px' }}>
          Ми — інженерна команда <strong>TechBIT</strong>. Наш курсовий проект вирішує проблему
          раптових поломок гальмівних колодок (підклинювання супорта, перекіс колодки, розжарення
          диска) та руйнування ступичних підшипників на вантажних фурах, комерційних бусах, лафетах
          і легкових авто.
        </p>
        <p style={{ color: '#52606d' }}>
          Система безперервно зчитує чотири точки коліс, живиться від бортового акумулятора при
          повороті ключа у статус <strong>ACC</strong> та завдяки порівняльному алгоритму й
          машинному навчанню чітко відрізняє їзду по поганій дорозі чи ямах від реальної несправності
          на одному з коліс.
        </p>
      </section>

      <section className="section-box">
        <h2 className="page-title">Склад команди TechBIT та зони відповідальності</h2>
        <p className="page-subtitle">Розподіл інженерних ролей у розробці MVP:</p>
        <div className="grid-3">
          {teamMembers.map((member) => (
            <div key={member.email} className="info-card">
              <div className="info-card-step">{member.role}</div>
              <h3>{member.name}</h3>
              <p style={{ marginBottom: '10px' }}>{member.responsibility}</p>
              <div style={{ fontSize: '12.5px', color: '#1f5fa8', fontWeight: 600 }}>
                <a href={`mailto:${member.email}`}>{member.email}</a>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Технічна архітектура системи</h2>
        <div className="grid-2" style={{ marginTop: '14px' }}>
          <div className="info-card">
            <h3>Апаратна частина (Hardware & Analog Front-End)</h3>
            <ul className="about-list">
              <li>
                <strong>Датчики на 4 колесах:</strong> П’єзоелектричні датчики вібрації з контролем
                температурного режиму вузла.
              </li>
              <li>
                <strong>Каскадний підсилювач:</strong> Побудований на Rail-to-Rail операційному
                підсилювачі <code>MCP6002-I/P</code> (3.3 В) зі штучною середньою точкою{' '}
                <code>Vref = 1.65 В</code>, коефіцієнтом підсилення <code>K = 3</code> та вихідним ФНЧ.
              </li>
              <li>
                <strong>Захист від ударів у ямах:</strong> Двоступеневий бар’єр на резисторі 10 кОм і
                діодах <code>BAT54S / 1N4148</code> витримує сплески до 20–30 В та відновлює режим за 0.3 мс.
              </li>
              <li>
                <strong>Живлення ACC та CAN-мережа:</strong> Вузли живляться від бортової лінії ACC
                через перетворювачі <code>Mini360</code> (12В-5В) та <code>MP1584EN</code> (3А), а
                дані передаються через трансивери <code>SN65HVD230</code> по витій парі.
              </li>
            </ul>
          </div>

          <div className="info-card">
            <h3>Програмна частина, вибірка та ML-логіка</h3>
            <ul className="about-list">
              <li>
                <strong>Високошвидкісна вибірка:</strong> Периферійні мікроконтролери{' '}
                <code>ESP32-C3 SuperMini</code> біля кожного колеса оцифровують сигнал на частоті{' '}
                <code>20 kSPS</code> через DMA та обчислюють RMS.
              </li>
              <li>
                <strong>Центральна агрегація:</strong> Головний контролер <code>ESP32-S3</code> приймає
                пакети від усіх 4 коліс по шині CAN на швидкості <code>500 kbps</code>.
              </li>
              <li>
                <strong>Відсікання поганої дороги:</strong> Одночасний ріст вібрації на всіх колесах
                розпізнається як рух по гравію чи бруківці і не вважається поломкою.
              </li>
              <li>
                <strong>Сигнал про необхідність ТО:</strong> Якщо аномальна вібрація та нагрів
                тривають на одному колесі понад 3 секунди (і ML-модель виключає разову яму), водій
                отримує попередження про заїзд на ТО.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Етапи роботи системи в реальному часі</h2>
        <div className="grid-4" style={{ marginTop: '14px' }}>
          {steps.map((item) => (
            <div key={item.step} className="info-card">
              <div className="info-card-step">ЕТАП {item.step}</div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Практичні кейси застосування</h2>
        <div className="grid-3" style={{ marginTop: '14px' }}>
          <div className="info-card">
            <h3>Вантажні фури та тягачі</h3>
            <p>
              На важкій навантаженій фурі водій у кабіні не відчуває, що одне колесо напівпричепа
              почало пригальмовувати. TechBIT попереджає про підклинювання колодок до того, як диск
              розжариться і виникне ризик загоряння.
            </p>
          </div>
          <div className="info-card">
            <h3>Комерційні буси та лафети</h3>
            <p>
              Запобігає перегріву гальмівної рідини та зриву фрикційних накладок колодок під час
              тривалих міжміських рейсів на мікроавтобусах і дво- чи тривісних лафетах.
            </p>
          </div>
          <div className="info-card">
            <h3>Діагностика на СТО (4WD / AWD)</h3>
            <p>
              На повнопривідних авто важко вручну розкрутити колесо на підйомнику через напіввісі.
              Комплект TechBIT дозволяє точно локалізувати гул ступичного підшипника під час
              тестового виїзду.
            </p>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Наші контакти та соцмережі</h2>
        <p className="page-subtitle">
          Зв’яжіться з командою TechBIT або перейдіть на наші сторінки:
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <a
            href="https://instagram.com"
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
          >
            Instagram TechBIT
          </a>
          <a
            href="https://t.me"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
          >
            Telegram канал
          </a>
          <a
            href="https://github.com/nzmnq/TechBIT"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
          >
            GitHub репозиторій
          </a>
          <a
            href="mailto:nedovizt26@gmail.com"
            className="btn btn-secondary"
          >
            Написати команді (Email)
          </a>
        </div>
      </section>
    </div>
  );
}

export default AboutPage;
