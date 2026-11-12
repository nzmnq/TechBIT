import React, { useState } from 'react';

function HomePage({ onNavigate, onSelectCategory }) {
  const [consultName, setConsultName] = useState('');
  const [consultPhone, setConsultPhone] = useState('');
  const [consultVehicle, setConsultVehicle] = useState('');
  const [consultStatus, setConsultStatus] = useState('');
  const [consultError, setConsultError] = useState('');
  const [sending, setSending] = useState(false);

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
          vehicleInfo: consultVehicle
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
      setConsultError('Не вдалося відправити заявку. Перевірте з’єднання з сервером.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <section className="hero-banner">
        <span className="hero-badge">Автомобільна безпека та контроль ходової</span>
        <h1>
          Завчасно попереджаємо про знос гальмівних колодок та підшипників маточини — ще до поломки на трасі
        </h1>
        <p>
          Система <strong>TechBIT</strong> безперервно відстежує вібрацію та температуру кожного
          колеса під час руху. Вмикається автоматично при повороті ключа в режим <strong>ACC</strong>,
          відрізняє погану дорогу й ями від реальної несправності та вчасно підказує водієві
          звернутися на ТО.
        </p>
        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => goToCatalogCategory('all')}
          >
            Обрати комплект у каталозі
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onNavigate('about')}
          >
            Про компанію TechBIT
          </button>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Що система TechBIT дає власнику авто та автопарку</h2>
        <p className="page-subtitle">
          Практична користь для щоденної експлуатації комерційного та приватного транспорту:
        </p>

        <div className="grid-4">
          <div className="info-card">
            <h3>Економія на ремонті</h3>
            <p>
              Дозволяє замінити колодку або підшипник вчасно, не доводячи вузол до заміни всієї
              маточини, гальмівного диска чи виклику евакуатора.
            </p>
          </div>

          <div className="info-card">
            <h3>Захист від перегріву гальм</h3>
            <p>
              На навантаженій фурі або бусі водій не відчуває підклинювання одного колеса. Система
              фіксує ріст температури й вібрації задовго до появи диму.
            </p>
          </div>

          <div className="info-card">
            <h3>Без хибних тривог на ямах</h3>
            <p>
              Порівнює колеса між собою та використовує машинне навчання: бруківка, гравій чи
              наїзд у яму не викликають зайвих попереджень.
            </p>
          </div>

          <div className="info-card">
            <h3>Нуль витрат АКБ на стоянці</h3>
            <p>
              Обладнання живиться лише тоді, коли ключ запалювання повернуто у положення ACC, і
              повністю знеструмлюється після зупинки.
            </p>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Для якого транспорту підходить</h2>
        <div className="grid-4" style={{ marginTop: '14px' }}>
          <div className="info-card">
            <h3>Фури та тягачі (24V)</h3>
            <p>
              Контроль коліс тягача та осей причепа в далеких рейсах. Запобігає простоям вантажу та
              аварійним зупинкам посеред траси.
            </p>
          </div>

          <div className="info-card">
            <h3>Мікроавтобуси та лафети</h3>
            <p>
              Рішення для комерційних перевезень і автовозів, де високе навантаження припадає на
              задню або причіпну вісь.
            </p>
          </div>

          <div className="info-card">
            <h3>Легкові авто та 4WD/AWD</h3>
            <p>
              Контроль стану колодок, супортів та маточин під час міжміських поїздок та активної
              експлуатації в місті.
            </p>
          </div>

          <div className="info-card">
            <h3>Автосервіси (СТО)</h3>
            <p>
              Швидка локалізація проблемного підшипника або стороннього стуку під навантаженням під
              час тестового виїзду з клієнтом.
            </p>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Як система відрізняє погану дорогу від реальної поломки</h2>
        <p className="page-subtitle">
          Логіка роботи порівняння 4 коліс у реальному часі:
        </p>

        <table className="logic-table">
          <thead>
            <tr>
              <th>Ситуація під час руху</th>
              <th>Що фіксують датчики на колесах</th>
              <th>Температура гальмівного вузла</th>
              <th>Реакція системи TechBIT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Звичайна дорога, авто справне</td>
              <td>Спокійна, рівна робота всіх коліс</td>
              <td>Нормальна робоча</td>
              <td>
                <span className="badge-normal">Норма — рух у штатному режимі</span>
              </td>
            </tr>
            <tr>
              <td>Погане покриття / бруківка / гравій</td>
              <td>Підвищена вібрація одночасно на всіх колесах</td>
              <td>Рівномірна без локального перегріву</td>
              <td>
                <span className="badge-normal">Дорожні умови — тривога не вмикається</span>
              </td>
            </tr>
            <tr>
              <td>Одиночний наїзд на яму або лежачий поліцейський</td>
              <td>Короткий імпульс удару</td>
              <td>Без змін</td>
              <td>
                <span className="badge-normal">Розпізнано удар (ML) — без сигналу ТО</span>
              </td>
            </tr>
            <tr>
              <td>Підклинювання колодки або знос підшипника</td>
              <td>Постійна аномальна вібрація на одному колесі</td>
              <td>Локальний ріст температури на цьому колесі</td>
              <td>
                <span className="badge-alert">УВАГА: Рекомендовано заїхати на ТО</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="section-box">
        <h2 className="page-title">Оберіть потрібний формат комплекту</h2>
        <p className="page-subtitle">
          У каталозі доступні як повні системи на всі колеса, так і рішення для однієї осі:
        </p>

        <div className="grid-3">
          <div className="info-card">
            <h3>Комплекти на 4 датчики</h3>
            <p style={{ marginBottom: '12px' }}>
              Повний контроль усіх 4 коліс із перехресним порівнянням між осями. Найкращий вибір
              для фур, легкових авто та СТО.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => goToCatalogCategory('kit-4')}
            >
              Дивитися комплекти 4x
            </button>
          </div>

          <div className="info-card">
            <h3>Комплекти на 2 датчики</h3>
            <p style={{ marginBottom: '12px' }}>
              Контроль однієї осі (передньої, задньої або осі причепа/лафета) з порівнянням лівого
              та правого колеса.
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => goToCatalogCategory('kit-2')}
            >
              Дивитися комплекти 2x
            </button>
          </div>

          <div className="info-card">
            <h3>Датчики та комплектуючі</h3>
            <p style={{ marginBottom: '12px' }}>
              Додаткові датчики для розширення системи з 2 до 4 коліс, кабельні траси та блоки
              управління.
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => goToCatalogCategory('accessories')}
            >
              Дивитися комплектуючі
            </button>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Часті запитання</h2>
        <div className="grid-2" style={{ marginTop: '14px' }}>
          <div className="faq-item">
            <h4>Чи буде система пищати, якщо я їду по ямах чи бруківці?</h4>
            <p>
              Ні. При їзді по нерівній дорозі трясе всі колеса одночасно — система автоматично
              відсіює такий фон, а одиночні удари від ям фільтрує алгоритм машинного навчання.
            </p>
          </div>

          <div className="faq-item">
            <h4>Чи розряджає система акумулятор на парковці?</h4>
            <p>
              Ні. Живлення підключається до лінії ACC, тому датчики працюють виключно при увімкненому
              запалюванні або запущеному двигуні.
            </p>
          </div>

          <div className="faq-item">
            <h4>Скільки датчиків краще обрати: 2 чи 4?</h4>
            <p>
              Для повного захисту краще брати комплект на 4 колеса. Якщо вам потрібно контролювати
              лише одну проблемну чи навантажену вісь (наприклад, лафет або причіп) — достатньо
              комплекту на 2 датчики, який згодом можна розширити до 4.
            </p>
          </div>

          <div className="faq-item">
            <h4>Чи бояться датчики води, мийки та зимових реагентів?</h4>
            <p>
              Корпуси датчиків та роз’єми мають клас захисту IP67 і розраховані на роботу під
              колесними арками за будь-якої погоди.
            </p>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Потрібна допомога з підбором під ваше авто?</h2>
        <p className="page-subtitle">
          Залиште контакт — ми підкажемо, який комплект найкраще підійде для вашої фури, буса чи легкового авто.
        </p>

        {consultStatus && (
          <div
            style={{
              backgroundColor: '#e6f4ea',
              border: '1px solid #1f7a4c',
              color: '#1f7a4c',
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
              backgroundColor: '#fce8e6',
              border: '1px solid #b43c2f',
              color: '#b43c2f',
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
              Ваше ім’я *
            </label>
            <input
              id="consult-name"
              type="text"
              className="filter-input"
              placeholder="Ім’я"
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
              Марка авто / кількість осей
            </label>
            <input
              id="consult-vehicle"
              type="text"
              className="filter-input"
              placeholder="Наприклад: MAN TGX або Renault Master"
              value={consultVehicle}
              onChange={(e) => setConsultVehicle(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={sending}>
            {sending ? 'Відправка...' : 'Замовити підбір'}
          </button>
        </form>
      </section>
    </div>
  );
}

export default HomePage;
