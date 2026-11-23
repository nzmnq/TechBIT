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
- `s3_master` (`ESP32-S3`): Мозок у кабіні (**без прямих аналогових датчиків!**), оцінка правил, чорна скринька, LTE + офлайн-черга LittleFS, UTC, OTA з rollback і кнопковий Web BLE для СТО на 15 хв.
- `native_test`: 7 нативних Unity-тестів для перевірки на ПК без підключених плат.

*(Попередня версія v1 збережена локально в гілці `legacy-v1-archive` → `legacy_v1_code/`.)*
