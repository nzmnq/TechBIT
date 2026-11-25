# TechBIT — B2B IoT-система діагностики коліс, гальм та підшипників (v2.0/v2.2)

Єдиний монорепозиторій проєкту **TechBIT** на гілці `main`: багаторольова прошивка **ESP32-C3 / ESP32-S3** (CAN + ESP-NOW + Rule Engine + Black Box + LTE + BLE), апаратна плата **KiCad 10**, інженерний **React SPA** діагностичний стенд та комерційна **B2B IoT + SaaS** веб-платформа.

---

## Структура монорепозиторію

| Модуль | Призначення | Документація |
|---|---|---|
| [`website/`](website/) | B2B IoT + SaaS платформа, калькулятор ROI автопарку, Drop & Hook моніторинг, `AdminPage`, i18n (`uk`/`en`), React + Express API | [website/README.md](website/README.md) |
| [`hardware/`](hardware/) | Принципові схеми та розводка плат у `KiCad 10` (`Wheel_Sensor_Amplifier` для коліс і `S3_Master_Hub` для кабіни), 3D-моделі (`.wrl`), рендери, PDF 1:1 для ЛУТ/УФ-маски та Python-генератори | [hardware/README.md](hardware/README.md) |
| [`firmware/`](firmware/) | Прошивка `PlatformIO` TechBIT v2.0 (`c3_node`, `c3_trailer_bridge` ESP-NOW, `s3_master` Black Box + LTE + BLE, нативні тести `native_test`) | [firmware/README.md](firmware/README.md) |
| [`workbench/`](workbench/) | Інженерний стенд TechBIT v2.2 (`React Router` + `Vite` SPA + `Node.js` + `Web Serial` / Wi-Fi POST + `SSE`, порт `5050`) | [workbench/README.md](workbench/README.md) |
| [`.plans/`](.plans/) | Архітектурна специфікація об'єднання гілок у монорепозиторій | [monorepo-unification-spec.md](.plans/monorepo-unification-spec.md) |

---

## Швидкий старт за модулями

Кожен модуль є самодостатнім і запускається зі своєї підпапки:

### 1. B2B Веб-платформа ([`website/`](website/))
```bash
cd website
npm run install:all   # одноразове встановлення залежностей server/ та client/
npm run build         # збірка клієнта у website/client/dist/
npm run server        # Node.js API + роздача клієнта на http://localhost:5000
npm run client        # React dev-сервер на http://localhost:5173
```

### 2. Прошивка v2.0 ([`firmware/`](firmware/))
Відкрийте папку `firmware/` у VS Code (PlatformIO) або використовуйте CLI `pio`:
```bash
cd firmware
pio run -e c3_node            # уніфікований осьовий вузол (ESP32-C3)
pio run -e c3_trailer_bridge  # бездротовий шлюз причепа CAN -> ESP-NOW (ESP32-C3)
pio run -e s3_master          # головний блок у кабіні (ESP32-S3)
pio test -e native_test       # нативні юніт-тести DSP, CAN v2, Rules та BlackBox
```

### 3. Діагностичний SPA-стенд ([`workbench/`](workbench/))
```bash
cd workbench
npm ci                # або npm install
npm run build         # збірка SPA у workbench/dist/
npm test              # юніт- та інтеграційні тести (test_truthfulness.js)
npm start             # запуск веб-стенду на http://localhost:5050 (Chrome/Edge для Web Serial)
```

### 4. Апаратна частина та PCB ([`hardware/`](hardware/))
- Відкрийте [`hardware/kicad/Wheel_Sensor_Amplifier.kicad_pro`](hardware/kicad/Wheel_Sensor_Amplifier.kicad_pro) у **KiCad 10** (3D-моделі підключаються через відносні шляхи `${KIPRJMOD}/../3dmodels/`).
- Готові PDF 1:1 для ЛУТ, УФ-маски та монтажу розміщено у [`hardware/print/`](hardware/print/).
