import React from 'react';

function HomePage({ onNavigate, onSelectCategory }) {
  function goToCatalogCategory(categoryId) {
    onSelectCategory(categoryId);
    onNavigate('catalog');
  }

  return (
    <div>
      <section className="hero-banner">
        <span className="hero-badge">Курсовий проект команди TechBit</span>
        <h1>
          Система раннього виявлення несправностей гальмівних колодок та ходової на основі 4 датчиків вібрації й температури
        </h1>
        <p>
          Рішення для вантажних фур та автомобілів: безперервне зчитування чотирьох точок коліс із
          вибіркою в реальному часі. Система працює від акумулятора при повороті ключа в положення{' '}
          <strong>ACC</strong> і за допомогою машинного навчання відрізняє погану дорогу чи ями від
          реальної поломки на конкретному колесі.
        </p>
        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => goToCatalogCategory('all')}
          >
            Перейти до каталогу товарів
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onNavigate('about')}
          >
            Детальніше про команду TechBit
          </button>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Як працює система TechBit</h2>
        <p className="page-subtitle">
          Основна задача — вчасно попередити водія про необхідність ТО без хибних спрацювань на нерівній дорозі.
        </p>

        <div className="grid-4">
          <div className="info-card">
            <div className="info-card-step">КРОК 01</div>
            <h3>Живлення від ACC</h3>
            <p>
              Датчики та блок обробки отримують живлення від бортового акумулятора автоматично, коли
              ключ запалювання повертається у статус ACC.
            </p>
          </div>

          <div className="info-card">
            <div className="info-card-step">КРОК 02</div>
            <h3>Вибірка з 4 коліс</h3>
            <p>
              Безперервне синхронне зчитування рівня вібрації та температури з чотирьох точок коліс
              під час руху фури чи легкового авто.
            </p>
          </div>

          <div className="info-card">
            <div className="info-card-step">КРОК 03</div>
            <h3>Фільтрація дороги</h3>
            <p>
              Якщо авто їде по поганій дорозі і сильні вібрації фіксуються на всіх 4 колесах
              одночасно, система не рахує це як аномалію.
            </p>
          </div>

          <div className="info-card">
            <div className="info-card-step">КРОК 04</div>
            <h3>ML-аналіз та сигнал ТО</h3>
            <p>
              Машинне навчання відрізняє наїзд на яму від постійної аномальної вібрації та нагріву
              одного колеса і сповіщає про потребу ТО.
            </p>
          </div>
        </div>
      </section>

      <section className="section-box">
        <h2 className="page-title">Логіка прийняття рішень системою</h2>
        <p className="page-subtitle">
          Порівняльна таблиця станів 4 датчиків під час руху транспортного засобу:
        </p>

        <table className="logic-table">
          <thead>
            <tr>
              <th>Ситуація на дорозі</th>
              <th>Показники вібрації (4 колеса)</th>
              <th>Температура вузла</th>
              <th>Висновок системи (ML)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Рівна траса, справне авто</td>
              <td>Низька на всіх 4 колесах</td>
              <td>В межах робочої норми</td>
              <td>
                <span className="badge-normal">Норма — штатний режим</span>
              </td>
            </tr>
            <tr>
              <td>Погана дорога / бруківка / гравій</td>
              <td>Висока одночасно на всіх 4 колесах</td>
              <td>Рівномірна на всіх колесах</td>
              <td>
                <span className="badge-normal">Погане покриття — не є поломкою</span>
              </td>
            </tr>
            <tr>
              <td>Разовий наїзд на яму</td>
              <td>Короткий імпульс удару</td>
              <td>Без аномального росту</td>
              <td>
                <span className="badge-normal">Розпізнано яму (ML) — без тривоги ТО</span>
              </td>
            </tr>
            <tr>
              <td>Знос колодок / клин супорта / дефект ходової</td>
              <td>Постійна аномальна вібрація на 1 колесі</td>
              <td>Підвищена температура на цьому ж колесі</td>
              <td>
                <span className="badge-alert">УВАГА: Зверніться на ТО!</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="section-box">
        <h2 className="page-title">Категорії обладнання в каталозі</h2>
        <p className="page-subtitle">
          Оберіть потрібну конфігурацію датчиків для вашого транспортного засобу:
        </p>

        <div className="grid-2">
          <div className="info-card">
            <h3>Комплекти на всі датчики одразу (4 колеса)</h3>
            <p style={{ marginBottom: '12px' }}>
              Повний набір із 4 датчиків вібрації й температури та центрального ML-блоку для
              максимальної точності порівняння всіх коліс фури чи легкового авто.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => goToCatalogCategory('kit-4')}
            >
              Переглянути комплекти на 4 датчики
            </button>
          </div>

          <div className="info-card">
            <h3>Комплекти на 2 датчики (на одну вісь)</h3>
            <p style={{ marginBottom: '12px' }}>
              Рішення для контролю передньої або задньої осі. Дозволяє порівнювати ліве та праве
              колесо між собою і фіксувати перегрів колодок або вібрацію ступиці.
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => goToCatalogCategory('kit-2')}
            >
              Переглянути комплекти на 2 датчики
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default HomePage;
