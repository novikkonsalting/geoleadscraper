# v1.10.2 — расширение называется своим именем

В списке расширений Chrome программа отображалась как **mapscan** — имя
upstream-проекта, на бандле которого собран Yandex-контур. Название и описание
берутся не из манифеста напрямую, а из `_locales`, и там оставалось старое
значение.

Теперь:

* имя — **GeoLeadScraper**;
* описание — «Сбор справочника организаций из Яндекс Карт, Google Карт и 2ГИС:
  сначала полный RAW-реестр, затем локальная фильтрация по району и категории»;
* добавлена русская локаль `_locales/ru`, поэтому в русском Chrome описание
  показывается по-русски;
* заголовки страниц popup и настроек — `GeoLeadScraper` вместо `popup` и
  `Dashboard`.

**Собранные данные не теряются.** Идентификатор расширения задан полем `key` в
манифесте и от имени не зависит, а IndexedDB привязана к идентификатору. После
обновления RAW остаётся на месте.

## Проверка

`node tools/extension-check.mjs` загружает собранное расширение в настоящий
Chromium и спрашивает у браузера то, что видит пользователь:

```
   browser reports: "GeoLeadScraper" 1.10.2 (egdgjicbgiamheekmimkgmeligcipkco)
ok   the name shown in chrome://extensions is the project name
ok   the description is filled in, not the upstream placeholder
ok   the id is pinned by the manifest key, so a rename cannot orphan stored data
ok   the record helpers and the store are present in the worker
ok   IndexedDB works in the real service worker
```

Заодно это проверяет, что расширение вообще стартует и что хранилище отвечает —
раньше такой проверки не было ни одной.
