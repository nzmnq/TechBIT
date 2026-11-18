# TechBIT Firmware (PlatformIO — ESP32-C3 SuperMini)

Прошивка автономної системи моніторингу вібрації підшипників маточини, температури/вологості (`GY-SHT40`) та підклинювання гальмівних колодок для **PlatformIO (VS Code)** на базі **ESP32-C3 SuperMini**.

---

## Архітектура системи

```text
[П'єзодатчик + MCP6002 (K=3, Vref=1.65В, BAT54S)] ──► GPIO2 (ADC1_CH2 @ 20 kSPS DMA)
[Датчик GY-SHT40 (J3, I2C 0x44, T°C + %RH)]       ──► GPIO8 (SDA) / GPIO9 (SCL)
        │
        ▼
[ESP32-C3 SuperMini x4] ──(512-pt Hann FFT + RMS + Crest + Kurtosis + T/RH)──┐
        │                                                                     │
        ├─► USB-C Serial (115200) / Wi-Fi HTTP ──► [Test Web Workbench :5050] │
        │                                                                     │
        └── SN65HVD230 (CAN Bus @ 500 kbps, GPIO21/20, ID: 0x100..0x113) ─────┼──► [ESP32-C3 Central Hub]
                                                                                     ├─ Cross-Wheel Fusion
                                                                                     ├─ TinyML MLP (10->16->12->4)
                                                                                     ├─ 3s Anti-Pothole Hysteresis
                                                                                     └─ NVS Calibration + LED/Buzzer
```

---

## Схема підключення (Pinout — ESP32-C3 SuperMini)

Налаштування пінів зібрані в [include/board_pins.h](include/board_pins.h).

### Колісний вузол (`ESP32-C3 SuperMini`)
| Функція | Пін ESP32-C3 | Примітка |
|---|---|---|
| Вихід аналогового каскаду MCP6002 (`R5/C4`) | `GPIO2` (`ADC1_CH2`) | Аналоговий вхід вібрації, у спокої `~1.65 В` |
| I2C SDA → `GY-SHT40` (`J3`, адреса `0x44`) | `GPIO8` | **Увага:** спільний із синім LED плати, тому LED вимкнено при `ENABLE_SHT40=1` |
| I2C SCL → `GY-SHT40` (`J3`, адреса `0x44`) | `GPIO9` | Шина I2C `100 кГц` |
| CAN TX → `SN65HVD230 D` | `GPIO21` | Вбудований TWAI (500 kbps) |
| CAN RX ← `SN65HVD230 R` | `GPIO20` | Вбудований TWAI (500 kbps) |
| Опційний термодатчик NTC (legacy) | `GPIO4` (`ADC1_CH4`) | Тільки якщо `-D ENABLE_NTC_TEMP=1` |

### Центральний блок (`ESP32-C3 SuperMini`)
| Функція | Пін ESP32-C3 | Примітка |
|---|---|---|
| CAN TX → `SN65HVD230 D` | `GPIO21` | Вбудований TWAI (500 kbps) |
| CAN RX ← `SN65HVD230 R` | `GPIO20` | Вбудований TWAI (500 kbps) |
| Зумер / реле тривоги ТО | `GPIO4` | Переривчастий сигнал при підтвердженій поломці |
| Червоний LED (Зверніться на ТО) | `GPIO5` | Постійне світіння при `ALERT_SERVICE_TO` |
| Зелений LED (Система в нормі) | `GPIO6` | Активний при нормальній роботі |
| Кнопка автокалібрування (`BOOT`) | `GPIO9` | Утримати `>= 1.5 с` на рівному асфальті |

---

## Веб-телеметрія (`WebTelemetryBridge.h`)

Колісні вузли та центральний хаб вміють передавати повну телеметрію (включно з `Vref`, `GY-SHT40` і 32-точковим спектром FFT `0..8000 Гц`) у тестовий інтерфейс `../test-web-interface/`:
- **USB-C Web Serial (за замовчуванням для `wheel_*`):** плата одразу видає JSON-рядки на `115200 baud` (`-D ARDUINO_USB_MODE=1 -D ARDUINO_USB_CDC_ON_BOOT=1`).
- **Wi-Fi Push + Вбудований HTTP:** налаштовується у `platformio.ini` або без перепрошивки через Serial-команду:
  ```text
  wifi MySSID MyPassword http://192.168.1.100:5050/api/telemetry
  ```
- **Зміна ID колеса без перепрошивки:** команда `wheel 0..3` (`FL=0, FR=1, RL=2, RR=3`, зберігається в NVS).

---

## Як відкрити та прошити у VS Code (PlatformIO)

1. Перемкніться на гілку **`esp-code`** і відкрийте папку **`TechBIT`** у VS Code (`platformio.ini` розташований безпосередньо в корені цієї гілки).
2. PlatformIO автоматично розпізнає конфігурацію `platformio.ini` з такими середовищами:
   - `wheel_fl` — переднє ліве колесо (`ID = 0`, ESP32-C3)
   - `wheel_fr` — переднє праве колесо (`ID = 1`, ESP32-C3)
   - `wheel_rl` — заднє ліве колесо (`ID = 2`, ESP32-C3)
   - `wheel_rr` — заднє праве колесо (`ID = 3`, ESP32-C3)
   - `central_hub_c3` — головний блок аналітики (`ESP32-C3 SuperMini`)
   - `native_test` — автотести алгоритмів FFT, CAN та ML на ПК
3. Оберіть потрібне середовище в нижній панелі PlatformIO (`env:central_hub_c3`, `env:wheel_fl` тощо) та натисніть **Build** або **Upload**.

---

## Інтеграція в головну гілку `main` (фінал проєкту)

Гілка `esp-code` навмисно ізольована від файлів вебсайту, щоб зручно працювати з PlatformIO. Щоб додати протестовану прошивку в `main/firmware/` без перезапису сайту:

```bash
git checkout main
git subtree add --prefix=firmware origin esp-code --squash
```

---

## Команди Serial Monitor (`ESP32-C3`, 115200 baud)

У терміналі `ESP32-C3` можна вводити команди:
- `cal` — запустити 5-секундне автокалібрування базового шуму на рівній дорозі (результат зберігається в енергонезалежну пам'ять NVS Flash);
- `reset` — скинути зафіксовані тривоги та лічильники ям;
- `mute` — приглушити / увімкнути зумер під час активної тривоги ТО;
- `human` — зручний текстовий моніторинг у реальному часі;
- `csv` — вивід 10 ML-ознак у CSV для запису реальних заїздів і перенавчання моделі;
- `json` — структурований JSON-потік для веб-інтерфейсу (увімкнено за замовчуванням для `wheel_*`);
- `wheel <0..3>` — змінити кут колеса (`FL/FR/RL/RR`) в NVS без перепрошивки (для `wheel_*`);
- `wifi <ssid> <pass> <url>` / `wifi_ap` / `wifi_off` — налаштування Wi-Fi телеметрії;
- `status` — показати поточні базові рівні, `Vref`, `GY-SHT40` та статистику CAN-шини.

---

## Перенавчання ML-моделі на реальних даних (`ml_trainer/`)

Записавши реальний CSV-лог із команди `csv` на вашому авто, ви можете перенавчити нейромережу та оновити ваги `lib/TechBitML/ml_model_weights.h`:

```bash
python ml_trainer/train_classifier.py --csv your_road_log.csv
```
