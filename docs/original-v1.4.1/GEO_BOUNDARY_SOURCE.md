# GeoLeadScraper v1.4.1 FINAL — LOCAL GEO

Runtime GEO filtering no longer downloads district boundaries from GitHub/Gist.
The 12 ЮЗАО district outlines used by RAW -> FINAL are bundled with the extension
in `apps/extension/pages/content/src/services/uzao-boundaries.local.ts`.

Coordinate system: EPSG:4326, positions are `[longitude, latitude]`.
The embedded outlines are simplified for point-in-polygon classification and are
not intended for cartographic/legal boundary display.

Regression probes:
- 55.6875, 37.5730 -> Академический
- 55.644762, 37.525993 -> NOT Академический
- 55.647731, 37.482145 -> NOT Академический

RAW-FIRST remains the source-of-truth architecture. Filtering can be rerun on an
imported RAW CSV without repeating Yandex collection.

Data lineage/attribution: simplified administrative outlines were prepared from
public Moscow district / OpenStreetMap-derived geometry. © OpenStreetMap contributors,
ODbL 1.0 where OSM-derived data applies.
