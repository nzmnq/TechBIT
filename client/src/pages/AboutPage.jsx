import React, { useEffect, useState } from 'react';

function AboutPage({ onNavigate }) {
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
        // Fallback дані
      }
    }
    loadAbout();
  }, []);

  const teamMembers = aboutData?.teamMembers || [
    {
      name: 'Назарій Доскочинський',
      role: 'Керівник напряму електроніки та виробництва',
      email: 'nazar.doskochynskyi@gmail.com',
      responsibility:
        'Відповідає за надійність електронних вузлів, захист обладнання від перепадів напруги та контроль якості кожної партії перед відправкою клієнтам.'
    },
    {
      name: 'Тарас Недовіз',
      role: 'Розробник програмного забезпечення та алгоритмів',
      email: 'nedovizt26@gmail.com',
      responsibility:
        'Розробив алгоритми аналізу вібрації та машинного навчання, які безпомилково відрізняють нерівності дороги від реального дефекту колодки чи підшипника.'
    },
    {
      name: 'Матвій Івков',
      role: 'Інженер з монтажу, механіки та випробувань',
      email: 'matviyivk3@gmail.com',
      responsibility:
        'Відповідає за герметичні корпуси IP67, універсальні кріплення під різні типи осей і консультації СТО та водіїв щодо встановлення.'
    }
  ];

  return (
    <div>
      <section className="section-box">
        <span className="hero-badge">Про компанію TechBIT</span>
        <h1 className="page-title">
          Український виробник систем ранньої діагностики гальм та ходової частини авто
        </h1>
        <p className="page-subtitle" style={{ marginBottom: '12px' }}>
          Ми допомагаємо приватним водіям, логістичним компаніям та СТО вчасно виявляти знос
          підшипників маточини й підклинювання гальмівних колодок до того, як це призведе до поломки
          посеред дороги.
        </p>
        <p style={{ color: '#52606d' }}>
          Наше обладнання розроблялося на основі реальних проблем водіїв фур, комерційних бусів та
          майстрів автосервісів: коли на важкому авто не відчутно пригальмовування одного колеса або
          складно локалізувати гул підшипника на повнопривідній машині.
        </p>
      </section>

      <section className="section-box">
        <h2 className="page-title">Реальні задачі, які вирішує TechBIT</h2>
        <div className="grid-3" style={{ marginTop: '14px' }}>
          <div className="info-card">
            <h3>Контроль фур у далеких рейсах</h3>
            <p>
              На навантаженій фурі водій у кабіні часто не відчуває, що на одному з коліс почали
              підклинювати колодки. TechBIT фіксує проблему на самому початку — до перегріву диска,
              закипання рідини та ризику загоряння.
            </p>
          </div>

          <div className="info-card">
            <h3>Причепи, лафети та буси</h3>
            <p>
              На комерційних лафетах і мікроавтобусах малі колеса несуть високе навантаження.
              Датчики на осі вчасно сигналізують про втому підшипника або нерівномірну роботу гальм.
            </p>
          </div>

          <div className="info-card">
            <h3>Швидка діагностика на СТО (4WD/AWD)</h3>
            <p>
              На повнопривідних авто важко вручну розкрутити колесо на підйомнику, щоб почути гул
              підшипника. Система TechBIT точно вказує на проблемний вузол під час короткого
              тестового заїзду.
            </p>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Надійність, сервіс та гарантії</h2>
        <div className="grid-2" style={{ marginTop: '14px' }}>
          <div className="info-card">
            <h3>Створено для реальних українських доріг</h3>
            <ul className="about-list">
              <li>
                <strong>Захист IP67:</strong> Датчики не бояться води, снігу, глибоких калюж, пилу
                та дорожніх реагентів.
              </li>
              <li>
                <strong>Стійкість до ударів:</strong> Система витримує різкі перевантаження при
                попаданні в яму та миттєво повертається до штатної роботи.
              </li>
              <li>
                <strong>Розумна фільтрація:</strong> Погана дорога або бруківка не сприймаються як
                поломка, оскільки порівнюються всі колеса.
              </li>
            </ul>
          </div>

          <div className="info-card">
            <h3>Умови для клієнтів та партнерів</h3>
            <ul className="about-list">
              <li>
                <strong>Гарантія 12 місяців:</strong> Повна гарантійна підтримка на всі комплекти та
                окремі датчики.
              </li>
              <li>
                <strong>Готовність до розширення:</strong> Почавши з комплекту на 2 датчики (1 вісь),
                ви завжди можете докупити ще 2 датчики до повної системи.
              </li>
              <li>
                <strong>Підтримка підключення:</strong> Консультуємо щодо монтажу та підключення
                живлення до лінії ACC як для 12V, так і для 24V мережі.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Команда TechBIT</h2>
        <p className="page-subtitle">
          Фахівці, які відповідають за розробку, якість обладнання та підтримку клієнтів:
        </p>
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
        <h2 className="page-title">Зв’язатися з нами</h2>
        <p className="page-subtitle">
          Потрібна консультація щодо сумісності або оптового замовлення для автопарку? Напишіть нам
          або перейдіть до каталогу:
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onNavigate && onNavigate('catalog')}
          >
            Перейти в каталог
          </button>
          <a
            href="https://instagram.com"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
          >
            Instagram
          </a>
          <a
            href="https://t.me"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
          >
            Telegram
          </a>
          <a href="mailto:nedovizt26@gmail.com" className="btn btn-secondary">
            Email: nedovizt26@gmail.com
          </a>
        </div>
      </section>
    </div>
  );
}

export default AboutPage;
