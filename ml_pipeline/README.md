# TechBIT ML Pipeline (Hyundai Santa Fe + СТО → Фури 40 т)

Скрипт `train_evaluate.py` працює **на стандартному Python 3 без встановлення додаткових бібліотек** (`pip install` не потрібен).

## Як користуватися після заїздів на Hyundai Santa Fe або СТО

1. Відкрийте сторінку **`/dataset` (ML Датасет)** у веб-стенді `http://localhost:5050/dataset`.
2. Запишіть парні заїзди (`BEFORE_REPAIR` — на хворому вузлі, `AFTER_REPAIR` — після ремонту або на здоровому Hyundai Santa Fe), перемикаючи кнопки швидкості `40 / 60 / 80 км/год` і натискаючи **`Яма!`** на дорожніх ямах.
3. Усі файли автоматично зберігаються у папку `datasets/` (`.json` + `.csv`).
4. Запустіть оцінку та навчання:

```bash
python ml_pipeline/train_evaluate.py datasets/
```

Скрипт:
- автоматично відкине позначені ями (`POTHOLE`) та зупинки (`speed_kmh = 0`);
- порахує **ROC-AUC** окремо для кожної безрозмірної фічі (`max_kurtosis`, `max_crest`, `max_hf_energy`, `ratio_vib`, `delta_temp`, `max_z_score`);
- навчить стандартизовану модель Logistic Regression і збереже готовий C++ файл `ml_pipeline/MlModelWeights.h` для вбудовування в `ESP32-S3`.

Швидка перевірка роботи скрипта на тестових даних:
```bash
python ml_pipeline/train_evaluate.py --demo
```
