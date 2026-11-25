# TechBIT Firmware v2.0 (PlatformIO — MVP Вантажівка + Причеп 10 коліс)

Прошивка розроблена під нову B2B IoT-архітектуру (**Software & Hardware Spec MVP**):

```text
[Причеп: Осі 1..3] ──► C3 Node x3 (L+R Вібрація + Температура)
                             │  CAN Bus (29-bit Node-ID @ 500 kbps)
                             ▼
                    [C3 Trailer Bridge] ──(ESP-NOW LR + AES-128)──┐
                                                                  ▼
[Тягач: Передня/Задня осі] ──► C3 Node x2 ──(CAN)──────► [ESP32-S3 Master]
                                                           ├─ Rule Engine (ΔT, Вибрація, >60s, Shadow Mode)
                                                           ├─ Black Box Ring Buffer (3-5 хв -> LTE ANOMALY_BURST)
                                                           ├─ Mini LED + Код колеса (P2-L, без BLE для водія)
                                                           └─ Сервісна кнопка -> Web BLE на 15 хв (інсталятор)
```

## Ролі PlatformIO (`platformio.ini`)
- `c3_node` (`ESP32-C3`): Уніфікований осьовий вузол (однаковий бінарник для передньої/задньої осі тягача й осей причепа; 4-канальний DMA ADC1, 256-pt Hann FFT, Extended CAN ID з MAC-адреси, `REQUEST_RAW_BURST`, Heartbeat).
- `c3_trailer_bridge` (`ESP32-C3`): Бездротовий шлюз причепа (CAN → ESP-NOW LR AES-128 із CRC16, авто-виявлення при підчепленні).
- `s3_master` (`ESP32-S3-DevKitC-1 N16R8`): Мозок у кабіні (**16 MB QIO Flash + 8 MB OPI PSRAM**, `qio_opi`, `default_16MB.csv`, **без прямих аналогових датчиків!**), оцінка правил, Black Box, круглий 1.28" 240×240 GC9A01 SPI TFT HUD (буфер кадру в PSRAM із fallback на 20-рядковий band-буфер), microSD-логер (HSPI), LTE + офлайн-черга LittleFS, UTC, OTA з rollback і кнопковий Web BLE для СТО на 15 хв.
- `native_test`: Нативні Unity-тести для перевірки на ПК без підключених плат.

## Апаратна розпіновка `s3_master` (`ESP32-S3-DevKitC-1 N16R8`)
Уникає пінів Octal Flash/PSRAM (`GPIO26..37`), USB (`GPIO19..20`), UART0 (`GPIO43..44`), RGB LED (`GPIO38/48`) та strapping (`GPIO3/45/46`).

| Підсистема | Сигнал | GPIO | Примітка |
|---|---|---|---|
| **CAN (TWAI 500 kbps)** | TX / RX | `GPIO4` / `GPIO5` | Шина тягача (передні/задні осі C3) |
| **LTE-модем (UART1)** | TX / RX / PWRKEY / RESET | `GPIO17` / `GPIO18` / `GPIO16` / `GPIO21` | SIMCom / Quectel + LittleFS черга |
| **Mini LED + Зумер** | GREEN / YELLOW / RED / BUZZER | `GPIO15` / `GPIO7` / `GPIO6` / `GPIO8` | Індикація стану в кабіні (зумер перенесено на GPIO8) |
| **Сервісна кнопка BLE** | BTN_SERVICE | `GPIO0` | Вмикає Web Bluetooth для СТО на 15 хв |
| **1.28" GC9A01 TFT (SPI2 / FSPI)** | CS / RES / DC(A0) / MOSI(SDA) / SCK / LED | `GPIO9` / `GPIO10` / `GPIO11` / `GPIO12` / `GPIO13` / `GPIO14` | 240×240 IPS @ 40 MHz, PWM-підсвітка (LEDC) |
| **microSD на дисплеї (SPI3 / HSPI)** | CS / MOSI / MISO / SCK | `GPIO42` / `GPIO41` / `GPIO40` / `GPIO39` | Окрема шина SPI3, гаряче монтування |

## Логування microSD та Serial CLI (`s3_master`, 115200 baud)
- **Шляхи на microSD:**
  - `/techbit/telemetry.csv` — щосекундні знімки активних вузлів (`utc_iso, uptime_ms, severity, wheel_code, node_id, slot, from_trailer, temp_l_c, temp_r_c, vib_l_mms, vib_r_mms, freq_l_hz, freq_r_hz, flags`).
  - `/techbit/events/evt_<seq>_<wheel>.json` — миттєве збереження `ANOMALY_BURST` JSON-пакетів при переході в `SHADOW` / `YELLOW` / `RED`.
- **Команди CLI:**
  - `status` / `dump` — загальний стан вузлів, LTE, BLE, TFT (PSRAM/Band) та SD-карти.
  - `sd` — показати статистику microSD або повторно змонтувати (`remount()`) карту.
  - `disp` — запустити 3-секундний RGB-тест дисплея та світлодіодів.
  - `ble on` / `ble off`, `cfg <json>`, `tractor <id>`, `trailer <id>`, `sim`, `json` / `human`.

*(Попередня версія v1 збережена локально в гілці `legacy-v1-archive` → `legacy_v1_code/`.)*
