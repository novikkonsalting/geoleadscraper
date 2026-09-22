# CLAUDE.md — geoleadscraper

Рабочие правила для агента в этом репозитории. Читается перед любой задачей.

## Что это

Расширение Chrome (Manifest V3) для сбора справочника организаций ЮЗАО Москвы
с Яндекс Карт по схеме **COLLECT RAW → LOCAL FILTER → FINAL**. Два режима:
AUTO (один запрос) и BATCH (очередь запросов). Фильтр по районам работает
офлайн, на встроенных границах — сеть для него не нужна.

Google Maps и 2GIS живут целиком в `vendor/` и в этом проекте не трогаются.

## Стек

- Node **>=18**, ESM (`"type": "module"`), без сборщика и без фреймворка
- Chrome Extension Manifest V3: content script, service worker, page hook
- IndexedDB — датасет расширения; `chrome.storage.local` — только управляющее состояние
- `fake-indexeddb` + `playwright` — только devDependencies, в расширение не попадают

## Команды

```bash
npm install                       # перед первым прогоном

node tools/build.mjs --zip        # собрать extension/ и ZIP
node tools/smoke-test.mjs         # обязательный прогон перед коммитом
node tools/geo-check.mjs          # качество встроенных границ
node tools/browser-check.mjs      # перехватчик ответов в реальном Chromium
node tools/extension-check.mjs    # расширение целиком в реальном Chromium
node tools/analyze-raw.mjs FILE.csv   # аудит выгрузки без Chrome
node tools/bench-store.mjs 4000   # цена записи датасета
```

`smoke-test.mjs` и `geo-check.mjs` браузера не требуют и должны проходить всегда.
`browser-check` / `extension-check` требуют Chromium.

## Сборка — главное правило

`extension/content/index.iife.js`, `extension/service-worker.js` и
`extension/page-hook.js` — **генерируемые артефакты**. Они лежат в git, но
руками не редактируются: `tools/build.mjs` склеивает их из `vendor/ + src/`
и затрёт любую ручную правку.

Правки идут только в `src/`, потом `node tools/build.mjs`. Собранные файлы
коммитятся вместе с исходником — расширение грузится в Chrome распакованным
прямо из `extension/`, поэтому артефакт в репозитории обязан соответствовать `src/`.

Порядок частей в бандле значим: `shared-record.js` идёт первым в обоих бандлах,
потому что и content-модуль, и store worker читают `globalThis.GLSRecord`
на верхнем уровне.

## Структура

| Путь | Что это |
|---|---|
| `src/yandex-module.js` | Content script: AUTO, BATCH, RAW export/import, GEO-фильтр, UI |
| `src/store-worker.js` | Датасет на IndexedDB, живёт в service worker |
| `src/shared-record.js` | Ключевание, слияние, дедуп — **единственное** определение «одна организация» |
| `src/shared-entities.js` | Разбор организаций из JSON, который Карты загрузили себе |
| `src/page-hook.js` | Читает ответы выдачи в контексте страницы. Запросов не делает |
| `vendor/*` | Upstream-бандлы. **Не редактируются** |
| `extension/` | Распакованное расширение, частично генерируется |
| `data/uzao_districts.geojson` | Границы 12 районов ЮЗАО, OpenStreetMap (ODbL) |
| `tools/harness.mjs` | Загружает расширение в Node с реальным IndexedDB и настоящим `sendMessage` |

## Инварианты — нарушать нельзя

- **Page hook только читает.** Он перехватывает ответы, которые Карты загрузили
  для себя, и не инициирует собственных запросов. Превращать его в источник
  трафика нельзя — это меняет природу инструмента.
- **CAPTCHA не обходится.** При требовании действия пользователя сбор встаёт в
  `USER ACTION REQUIRED` и ждёт человека.
- **Дедуп только по стабильному ключу.** `place_id`, при его отсутствии —
  `phone+address`. Нечёткое сопоставление по названию не вводить.
- **Пустое поле — это пробел, а не версия.** Слияние не должно затирать
  заполненное значение пустым: тонкая карточка из списка не отменяет полную.
- **Слияние сохраняет все source records** и первую версию названия.
- **Зависший сбор не выдаётся за завершённый.** Watchdog закрывает цикл, но
  помечает запрос предупреждением; сбор с нулём организаций — это `ERROR`,
  а не `COMPLETED`.
- **RAW сохраняется до фильтрации.** Локальный фильтр — отдельный шаг, он не
  должен уничтожать исходную выгрузку.

## Версии

Версия живёт в четырёх местах и уже разъезжалась: `extension/manifest.json`
(авторитетный — его читает Chrome), `package.json`, `package-lock.json`,
заголовок `README.md`. Согласованность проверяется секцией
`release consistency` в `smoke-test.mjs`.

При подъёме версии обновить все четыре и добавить `CHANGELOG_V<версия>.md` —
в этом проекте на каждый релиз заводится отдельный файл, старые не переписываются.

## Чего не делать

- Не редактировать `extension/content/index.iife.js`, `extension/service-worker.js`,
  `extension/page-hook.js` — только `src/` + пересборка.
- Не трогать `vendor/` — это upstream, части Google Maps и 2GIS.
- Не добавлять runtime-зависимости: расширение грузится как есть, без сборщика.
- Не коммитить `dist/*.csv` и `dist/geoleadscraper-project-*.zip` (в `.gitignore`) —
  это собранные бизнес-данные и снапшоты, а не файлы проекта.
- Не править `data/uzao_districts.geojson` руками: границы приходят из OSM,
  встроенная копия генерируется `tools/embed-boundaries.mjs`, качество
  проверяется `tools/geo-check.mjs`.

## Тесты

`tools/smoke-test.mjs` — 142 проверки, имя каждой сформулировано как поведение
(«merging keeps both source records»), а не как имя функции. Новые проверки
писать в том же стиле и класть в тематическую секцию (`section('...')`).

При исправлении бага сначала добавить проверку, воспроизводящую поломку. Разметка
и формат ответов Яндекса меняются молча — тест единственный способ заметить регресс.

`tools/harness.mjs` даёт настоящий путь `sendMessage` и реальный IndexedDB, так
что хранилище тестируется не заглушкой. Пользуйтесь им, а не моками.
