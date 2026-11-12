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
        // Використовуємо локальні дані, якщо сервер недоступний
      }
    }
    loadAbout();
  }, []);

  const steps = aboutData?.howItWorks || [
    {
      step: '01',
      title: '4 датчики на кожному колесі',
      text: 'На кожне з чотирьох коліс встановлюється комбінований датчик вібрації та температури. Живлення подається від автомобільного акумулятора при повороті ключа у положення ACC.'
    },
    {
      step: '02',
      title: 'Безперервне зчитування та вибірка',
      text: 'Система синхронно опитує всі 4 точки під час руху та формує вибірку показників вібрації й нагріву в реальному часі.'
    },
    {
      step: '03',
      title: 'Порівняння коліс та фільтрація поганої дороги',
      text: 'Якщо автомобіль їде по розбитій дорозі, підвищена вібрація фіксується на всіх чотирьох колесах — система розпізнає це як дорожнє покриття і не видає хибної тривоги.'
    },
    {
      step: '04',
      title: 'Машинне навчання (ML) та сигнал на ТО',
      text: 'Модель машинного навчання відрізняє разовий удар від ями від систематичної аномальної вібрації та перегріву на одному конкретному колесі, завчасно попереджаючи водія про потребу звернутися на ТО.'
    }
  ];

  return (
    <div>
      <section className="section-box">
        <span className="hero-badge">About Us / Про команду</span>
        <h1 className="page-title">Команда TechBit — Курсовий проект</h1>
        <p className="page-subtitle" style={{ marginBottom: '12px' }}>
          Ми — команда <strong>TechBit</strong>, яка розробляє інженерне рішення для ранньої
          діагностики гальмівних колодок і ходової частини автомобілів та вантажних фур.
        </p>
        <p style={{ color: '#52606d', marginBottom: '12px' }}>
          Під час тривалих рейсів водієві фури чи легкового авто важко вчасно помітити початок
          підклинювання гальмівного супорта, нерівномірний знос колодок або руйнування підшипника
          ступиці. Наша система складається з чотирьох датчиків вібрації та температури (по одному
          на кожне колесо), які безперервно зчитують показники під час руху.
        </p>
      </section>

      <section className="section-box">
        <h2 className="page-title">Технічні особливості нашого рішення</h2>
        <div className="grid-2" style={{ marginTop: '14px' }}>
          <div className="info-card">
            <h3>Синхронна вибірка з 4 коліс</h3>
            <ul className="about-list">
              <li>Постійне опитування чотирьох точок коліс у реальному часі.</li>
              <li>
                Якщо на одному колесі фіксується аномальна вібрація разом із підвищеною
                температурою — система сигналізує, що потрібно звернутися на ТО.
              </li>
              <li>
                Якщо ми їдемо по поганій дорозі і великі вібрації присутні на всіх колесах одночасно
                — система відсікає це і не вважає поломкою.
              </li>
            </ul>
          </div>

          <div className="info-card">
            <h3>Живлення ACC та машинне навчання</h3>
            <ul className="about-list">
              <li>
                Датчики та контролер живляться від акумулятора автомобіля лише тоді, коли ключ
                повернуто у статус <strong>ACC</strong> (не розряджають АКБ на стоянці).
              </li>
              <li>
                Завдяки алгоритмам машинного навчання (ML) система відрізняє короткочасний удар від
                наїзду в яму від характерної частоти вібрації несправної колодки чи ходової.
              </li>
              <li>
                Доступні конфігурації як на 2 датчики (одна вісь), так і повні комплекти на всі 4
                датчики.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Етапи роботи алгоритму</h2>
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
        <h2 className="page-title">Наші контакти та соцмережі</h2>
        <p className="page-subtitle">
          Слідкуйте за розвитком проекту TechBit або зв’яжіться з нашою командою:
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <a
            href="https://instagram.com"
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
          >
            Instagram TechBit
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
        </div>
      </section>
    </div>
  );
}

export default AboutPage;
