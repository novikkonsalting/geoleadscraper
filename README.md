# GeoLeadScraper — Yandex Maps AUTO + BATCH (v1.5.0)

Сбор справочника организаций ЮЗАО Москвы по схеме **COLLECT RAW → LOCAL FILTER → FINAL**.

Google Maps и 2GIS части проекта не затрагиваются: они целиком находятся в
`vendor/mapscan-content.iife.js` и собираются в артефакт без изменений.

## Структура

| Путь | Что это |
|---|---|
| `src/yandex-module.js` | Content script: AUTO, BATCH, RAW export/import, локальный GEO-фильтр, UI. |
| `src/store-worker.js` | Хранилище датасета на IndexedDB, живёт в service worker расширения. |
| `src/shared-record.js` | Ключевание, слияние и дедуп организаций. Собирается в оба бандла — единственное определение того, что считается одной организацией. |
| `vendor/mapscan-content.iife.js` | Upstream-бандл content script (Google Maps, 2GIS, Yandex extractor `window.__glsYandexFetch`). Не редактируется. |
| `vendor/mapscan-service-worker.js` | Upstream service worker. Не редактируется. |
| `extension/` | Распакованное расширение для Chrome (`Загрузить распакованное расширение`). |
| `dist/` | Упакованный ZIP расширения. |
| `tools/build.mjs` | `vendor + src → extension/content/index.iife.js`, опционально ZIP. |
| `tools/harness.mjs` | Загружает расширение в Node с реальным IndexedDB и настоящим путём `sendMessage`. |
| `tools/smoke-test.mjs` | Тесты хранилища, дедупа, CSV, координат, гео и миграции с v1.4.x. |
| `tools/bench-store.mjs` | Замер старого (`chrome.storage`) и нового (IndexedDB) пути записи. |
| `tools/geo-check.mjs` | Контроль качества границ: regression probes, 16 контрольных точек, перекрытия, площади. |
| `tools/analyze-raw.mjs` | Аудит RAW/FINAL CSV + прогон локального фильтра без Chrome. |

## Сборка и проверка

```bash
node tools/build.mjs --zip     # собрать extension/ и ZIP расширения
node tools/build.mjs --project-zip  # ZIP всего проекта (в git не хранится)
node tools/smoke-test.mjs      # обязательный прогон перед коммитом
node tools/geo-check.mjs       # качество встроенных границ
node tools/analyze-raw.mjs geoleadscraper-yandex_maps-RAW_ALL-*.csv
node tools/bench-store.mjs 4000   # во что обходится запись датасета
```

Перед первым прогоном тестов: `npm install` (единственная зависимость —
`fake-indexeddb`, только для тестов; в расширение ничего не попадает).

`tools/build.mjs` — единственный способ получить `extension/content/index.iife.js`
и `extension/service-worker.js`. Правки прямо в `extension/` будут затёрты
следующей сборкой.

## Где лежат данные

Собранный реестр хранится в IndexedDB базы `geoleadscraper`, принадлежащей
**расширению**, а не сайту. Очистка данных yandex.ru его не трогает. В
`chrome.storage.local` остаётся только управляющее состояние: статус, очередь
запросов и счётчики.

Единственное действие, которое удаляет собранные данные, — кнопка
`RESET BATCH — УДАЛИТЬ RAW (N)`. `IMPORT RAW CSV` заменяет реестр импортируемым
файлом. Данные из версий 1.4.x переносятся в IndexedDB автоматически при первом
запуске.

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
