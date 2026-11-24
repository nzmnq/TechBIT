# TechBIT Monorepo Unification Specification (`main`)

## 1. Контекст і причина проблеми з Merge Request

До реорганізації в репозиторії `nzmnq/TechBIT` на GitHub існували окремі гілки, кожна з яких тримала окремий підпроєкт безпосередньо в корені репозиторію:

1. `origin/main` (`fc3d5dc`) — базова веб-версія, на якій PR #1 (`c233e70`) зі `scheme` видаляв файли сайту й був відкочений комітом `fc3d5dc`.
2. `origin/web-development` (`a99ff34`) — актуальний B2B IoT + SaaS вебсайт (`client/`, `server/`, `package.json`, `AdminPage.jsx`, `i18n/`, `fleet.json`).
3. `origin/scheme` (`c2025ef`) — апаратна плата KiCad 10 (`kicad/`, `3dmodels/`, `print/`, `renders/`, `scripts/`).
4. `origin/esp-code` (`971292e`) — прошивка TechBIT v2.0 MVP (`c3_node`, `c3_trailer_bridge`, `s3_master`, `TechBitRules`, `test_v2_mvp.cpp`), що мала окремий кореневий коміт `fe1ac0c` (`unrelated histories`).
5. `origin/test-web-interface` (`46e5829`) — діагностичний стенд TechBIT v2.2 (`React Router DOM` + `Vite` SPA, `v2_engine.js`, `server.js`, `test_truthfulness.js`), що походив від `esp-code` і видалив файли прошивки з кореня.

Через це прямі Merge/Pull Request у `main` перезаписували чи видаляли модулі інших гілок, конфліктували на `README.md` / `.gitignore` / `package.json` або блокувалися GitHub через непов'язані історії.

---

## 2. Цільова структура гілки `main`

Усі 4 актуальні гілки з `origin` об'єднано в рівноправні підпапки безпосередньо на `main` поверх `origin/main` (`fc3d5dc`):

```text
TechBIT/
├── .gitignore
├── LICENSE
├── README.md                              # Головний огляд v2.0/v2.2 монорепозиторію
├── .plans/
│   └── monorepo-unification-spec.md       # Ця специфікація
├── website/                               # origin/web-development (a99ff34) — B2B SaaS сайт + API
│   ├── client/
│   ├── server/
│   ├── package.json
│   └── README.md
├── hardware/                              # origin/scheme (c2025ef) — KiCad 10 PCB, 3D, друк, скрипти
│   ├── 3dmodels/
│   ├── kicad/
│   ├── print/
│   ├── renders/
│   ├── scripts/
│   └── README.md
├── firmware/                              # origin/esp-code (971292e) — PlatformIO v2.0 + тести
│   ├── include/
│   ├── lib/
│   ├── src/
│   ├── test/
│   ├── platformio.ini
│   └── README.md
└── workbench/                             # origin/test-web-interface (46e5829) — React SPA стенд v2.2
    ├── src/
    ├── index.html
    ├── package.json
    ├── package-lock.json
    ├── server.js
    ├── test_truthfulness.js
    ├── v2_engine.js
    ├── vite.config.js
    └── README.md
```

### Зафіксовані архітектурні рішення
- **Пряме оновлення `main` поверх `origin/main` (`fc3d5dc`):** без force-push, зі збереженням повної історії та авторів усіх гілок.
- **Без кореневого `package.json`:** `website/` та `workbench/` автономні й запускаються зі своїх директорій.
- **Збереження резервних гілок на `origin`:** `scheme`, `esp-code`, `test-web-interface`, `web-development`, а також архівні гілки (`legacy-v1-archive` тощо) залишаються недоторканими на `origin`; тимчасова гілка `refactor/monorepo-main` видаляється.
- **Очистка:** `.vscode/`, `.pio/`, `node_modules/`, `dist/` і `*.kicad_prl` винесено в кореневий `.gitignore`; `hardware/print/` та `hardware/renders/` збережено.

---

## 3. Команди запуску та тестування по модулях

- **Website (`website/`):**
  - `cd website && npm run install:all`
  - `cd website && npm run build`
  - `cd website && npm run server` (API + клієнт на `:5000`) / `npm run client` (Vite dev на `:5173`)
- **Workbench (`workbench/`):**
  - `cd workbench && npm ci && npm run build`
  - `cd workbench && npm test` (`node test_truthfulness.js`)
  - `cd workbench && npm start` (`node server.js` на `:5050`)
- **Firmware (`firmware/`):**
  - `cd firmware && pio run -e c3_node` / `c3_trailer_bridge` / `s3_master`
  - `cd firmware && pio test -e native_test`
- **Hardware (`hardware/`):**
  - `hardware/kicad/Wheel_Sensor_Amplifier.kicad_pro` у KiCad 10 (`${KIPRJMOD}/../3dmodels/`).

---

## 4. Критерії верифікації

1. **Git-цілісність:** `git status` чистий, `git branch -r --merged` містить `origin/web-development`, `origin/scheme`, `origin/esp-code`, `origin/test-web-interface`, а `git ls-files` не містить `.vscode` або `kicad_prl`.
2. **Workbench:** `npm ci && npm run build && npm test` у `workbench/` проходять без помилок.
3. **Website:** `node --check website/server/index.js` та `npm --prefix website/client ci && npm --prefix website/client run build` проходять без помилок.
4. **Firmware:** `pio test -e native_test` у `firmware/` проходить усі тести.
5. **Публікація:** `git push origin main` проходить без force-push, тимчасова гілка `refactor/monorepo-main` видаляється локально та з `origin`.
