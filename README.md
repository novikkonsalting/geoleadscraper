# GeoLeadScraper — Yandex Maps AUTO + BATCH (v1.4.2)

Сбор справочника организаций ЮЗАО Москвы по схеме **COLLECT RAW → LOCAL FILTER → FINAL**.

Google Maps и 2GIS части проекта не затрагиваются: они целиком находятся в
`vendor/mapscan-content.iife.js` и собираются в артефакт без изменений.

## Структура

| Путь | Что это |
|---|---|
| `src/yandex-module.js` | Единственный редактируемый исходник: AUTO, BATCH, RAW export/import, локальный GEO-фильтр, UI. |
| `vendor/mapscan-content.iife.js` | Upstream-бандл content script (Google Maps, 2GIS, Yandex extractor `window.__glsYandexFetch`). Не редактируется. |
| `extension/` | Распакованное расширение для Chrome (`Загрузить распакованное расширение`). |
| `dist/` | Упакованный ZIP расширения. |
| `tools/build.mjs` | `vendor + src → extension/content/index.iife.js`, опционально ZIP. |
| `tools/smoke-test.mjs` | Тесты парсинга CSV, dedupe, нормализации координат и офлайн-классификации районов. |
| `tools/geo-check.mjs` | Контроль качества границ: regression probes, 16 контрольных точек, перекрытия, площади. |
| `tools/analyze-raw.mjs` | Аудит RAW/FINAL CSV + прогон локального фильтра без Chrome. |

## Сборка и проверка

```bash
node tools/build.mjs --zip     # собрать extension/ и dist/*.zip
node tools/smoke-test.mjs      # обязательный прогон перед коммитом
node tools/geo-check.mjs       # качество встроенных границ
node tools/analyze-raw.mjs geoleadscraper-yandex_maps-RAW_ALL-*.csv
```

`tools/build.mjs` — единственный способ получить `extension/content/index.iife.js`.
Правки прямо в `extension/` будут затёрты следующей сборкой.

## Порядок работы в Chrome

1. Открыть Яндекс Карты, загрузить `uzao_yandex_optimized_132.csv` кнопкой
   **ЗАГРУЗИТЬ CSV СО СПИСКОМ ЗАПРОСОВ**.
2. **START RAW BATCH** — сбор идёт без гео- и категорийной фильтрации.
3. **EXPORT RAW** сразу после завершения. Файл называется `RAW_ALL`, если сбор
   прошёл полностью, и `RAW_PARTIAL`, если хотя бы один запрос завершился
   подозрительно рано.
4. **FILTER RAW → FINAL**, затем **EXPORT FINAL**.

RAW можно вернуть в расширение кнопкой **IMPORT RAW CSV** и перефильтровать
сколько угодно раз — повторный сбор Яндекса не нужен.

## Границы районов

Геофильтр работает только офлайн. Подробности и известные ограничения
встроенного набора границ — в [`docs/GEO_BOUNDARIES.md`](docs/GEO_BOUNDARIES.md).

## Ограничения по назначению

Расширение не обходит CAPTCHA и access check. Если Яндекс требует действия
пользователя, сбор встаёт в статус `USER ACTION REQUIRED` и ждёт человека.
