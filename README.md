# TechBIT v2.0 — Стенд діагностики датчиків та зчіпки (10 коліс)

Локальний веб-стенд без зовнішніх залежностей (чистий Node.js + SSE + Web Serial API + Canvas) для живого тестування плат **TechBIT v2**:
- **5× уніфікованих вузлів осі `ESP32-C3`** (`T1`, `T2` на тягачі + `P1`, `P2`, `P3` на причепі = **10 коліс**, кожен вузол читає 2× п'єзоканали через MCP6002 + BAT54S та `GY-SHT40` I2C);
- **`ESP32-C3 Trailer Bridge`** (бездротовий місток причепа **ESP-NOW LR 1 Мбіт/с + AES-128**);
- **`ESP32-S3 Master`** (кабінний Mini-LED індикатор `GREEN / YELLOW / RED` + код колеса `P2-L` + зумер, Shadow Mode, Чорна скринька `ANOMALY_BURST`, BLE Service Mode 15 хв, LTE).

## Швидкий старт

```bash
npm start
# Відкрити у Chrome / Edge: http://localhost:5050
```

Перевірка юніт- та інтеграційних тестів (правдивість `OFFLINE`, паритет із C++ `RuleEngine`, HTTP API та CSV):

```bash
npm test
```

## Можливості стенду

1. **Два паралельні USB-C порти (`Web Serial API`, 115200 baud)** — підключайте одночасно дві плати (наприклад, два вузли `C3` або `C3 Node` + `S3 Master`) з можливістю примусово прив'язати порт до слоту осі (`T1..P3`).
2. **Wi-Fi HTTP Push (`POST /api/telemetry`) та IP Polling** — приймає JSON-пакети `techbit_c3_node`, `techbit_trailer_bridge`, `techbit_s3_master`, а також зворотно сумісні v1 пакети `techbit_node`. Живий пакет автоматично вимикає симулятор.
3. **Симулятор зчіпки v2 (8 сценаріїв)** — рівна траса, 10 км бруківки, удар у яму (`BAT54S clip`), заклинювання гальма `P2-L` (`ΔT → YELLOW → RED`), знос підшипника `T2-R`, `Shadow Mode` (`P1-L`), обрив `ESP-NOW` містка, збій `MCP6002 Vref` / `I2C SHT40` / конденсат `>85% RH`.
4. **Осцилограф RMS & 32-смуговий спектр Фур'є (`0–4480 Гц`)** — порівняння обраного колеса з протилежним колесом тієї самої осі.
5. **Чорна скринька `ANOMALY_BURST` & Ground Truth CSV** — живий JSON-пакет із `burst_samples_base64`, 2-клікове закриття тікетів механіком та експорт у `.csv`.
6. **Налаштування порогів S3 та CLI** — миттєве оновлення порогів у стенді та відправка `cfg {...}`, `slot 1..5`, `ble on/off`, `tractor`, `trailer` напряму в підключені по USB/Wi-Fi плати.

## Розпіновка плат (синхронізовано з гілкою `esp-code` та KiCad PCB)

| Плата | Сигнал | GPIO | Примітка |
| --- | --- | --- | --- |
| **C3 Axle Node** | П'єзо Ліве (L) / Праве (R) | `GPIO2` / `GPIO3` | `ADC1_CH2/CH3`, MCP6002 `Vref ≈ 1.65 В`, `BAT54S`, DMA 9 кГц (`unit=0`) |
| **C3 Axle Node** | I2C `GY-SHT40` | `GPIO8` / `GPIO9` | SDA/SCL, авто-пошук `0x44`/`0x45` (синій LED на GPIO8 вимкнено при `ENABLE_SHT40=1`) |
| **C3 Axle Node** | NTC резерв (L / R) | `GPIO0` / `GPIO4` | Активно, коли `ENABLE_SHT40=0` |
| **C3 Axle Node** | CAN `SN65HVD230` | `GPIO21` / `GPIO20` | TX/RX, 500 kbps |
| **C3 Bridge** | CAN + Pairing + ESP-NOW | `GPIO21/20`, `GPIO9` | Зовнішня 2.4 ГГц антена, ESP-NOW LR + AES-128 |
| **S3 Master** | CAN / LTE / LED+Buzzer / BLE | `4/5`, `17/18`, `6/7/14/15`, `0` | Без OLED, BLE лише на 15 хв для СТО |
