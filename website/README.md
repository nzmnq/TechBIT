# TechBIT — B2B IoT + SaaS платформа та каталог (MVP)

Веб-додаток і хмарний бекенд **TechBIT** (Frontend: React + Vite + i18n `uk.json`/`en.json`, Backend: Node.js + Express) для B2B-продажів комплектів моніторингу фур/причепів та консолі інцидентів (Software Spec v2.0).

## Основний функціонал

- **Головна (`HomePage`)**: B2B цінність (запобігання поломкам ступиць, гальм і пожежам коліс), модель доступу (міні LED водію без BLE / сервісний BLE інсталятору / Cloud SaaS), інтерактивний **калькулятор вартості заліза, підписки SaaS та економії (Стандарт vs Design Partners)**, багаторівнева таблиця реакції (`GREEN`, `SHADOW`, `YELLOW`, `RED`).
- **Каталог (`CatalogPage`)**: готові комплекти (`TB-FULL-10`, `TB-TRACTOR-4`, `TB-TRAILER-6`, `TB-PARTNER-PILOT`) та змінні модулі (`C3 Node`, `C3 Trailer Bridge`, `S3 Master LTE`, монтаж `Deutsch DT`), ціни в грн і `$` + щомісячна SaaS-підписка, робочий кошик із вибором плану (`Стандарт B2B` / `Design Partner 0 грн за 6 міс.`).
- **Web-адмінка моніторингу (`AdminPage`)**:
  - Роздільна модель парку (`Tractor` / `Trailer` / `SensorNode`, Drop & Hook);
  - Конвертація часу з `UTC` у локальний час, одиниці СІ (`°C`, `mm/s`);
  - Симулятор `S3 -> Cloud ANOMALY_BURST` (`POST /api/ingest`) із прев’ю Telegram-алерта;
  - Закриття інцидентів механіком у 2 кліки (Ground Truth) та експорт ML-датасету (`CSV` / `JSON`);
  - Віддалений конфігуратор JSON-порогів для `ESP32-S3` (з перемикачем `Shadow Mode`).

## API Ендпоїнти (`server/index.js`)

- `GET /api/categories`, `GET /api/products`, `GET /api/about`
- `POST /api/orders`, `POST /api/consultations`
- `GET /api/fleet`, `POST /api/ingest`
- `GET /api/incidents`, `PATCH /api/incidents/:ticketId`
- `GET /api/dataset/export?format=csv`
- `PUT /api/devices/:deviceId/config`

## Локальний запуск

```bash
npm run install:all   # 1 раз (якщо ще не встановлено)
npm run build         # збірка клієнта в client/dist
npm run server        # Node.js API + роздача клієнта на http://localhost:5000
```

*(Попередня версія v1 збережена локально в гілці `legacy-v1-archive` → папка `legacy_v1_code/`.)*
