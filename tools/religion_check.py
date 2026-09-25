#!/usr/bin/env python3
"""Checks the religious sheet of the register against independent sources.

Yandex Maps is one source. This compares what it gave with three others and
writes a workbook a human goes through:

  * the Moscow diocese list of the South-West vicariate (uzvikariatstvo.ru);
  * OpenStreetMap places of worship inside the 12 district polygons;
  * the state register of legal entities (ЕГРЮЛ, main OKVED 94.91 in Moscow,
    from pb.nalog.ru), placed on the map by its legal address.

    python3 tools/religion_check.py --raw "RAW FINAL.csv" --reestr "ОБЩИЙ ОТЧЁТ.xlsx" \\
        --osm osm.json --osm-addr osm_addr.json --diocese diocese.json \\
        --egrul-list egrul_list.json --egrul-cards egrul_cards.json --out SVERKA.xlsx

Nothing here merges or drops a row of the register. A source row is shown as
"есть на Картах" when a card of ours stands next to it or carries its name, and
as "нет на Картах" otherwise - a hint to check, not a verdict. A legal address
is where the organisation is registered, which is often not where it prays.
"""
import argparse, collections, csv, io, json, math, re, sys

try:
    from openpyxl import Workbook, load_workbook
    from openpyxl.styles import Font, Alignment, PatternFill
    from openpyxl.utils import get_column_letter
except ImportError:
    sys.exit('нужен openpyxl:  pip install openpyxl')

csv.field_size_limit(10 ** 9)
DISTRICTS = ['Академический', 'Гагаринский', 'Зюзино', 'Коньково', 'Котловка', 'Ломоносовский', 'Обручевский',
             'Северное Бутово', 'Тёплый Стан', 'Черёмушки', 'Южное Бутово', 'Ясенево']
HEAD = Font(bold=True, color='FFFFFF')
FILL = PatternFill('solid', fgColor='2F4858')
NOTE = Font(italic=True, size=9, color='555555')
NEAR_METRES = 150


# --- geometry -----------------------------------------------------------------

def load_polygons(path):
    polys = []
    for f in json.load(open(path, encoding='utf-8'))['features']:
        g = f['geometry']
        polys.append((f['properties']['name'], g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]))
    return polys


def in_ring(x, y, ring):
    inside = False
    for i in range(len(ring)):
        x1, y1 = ring[i - 1][:2]
        x2, y2 = ring[i][:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def district_of(polys, lat, lon):
    for name, parts in polys:
        for p in parts:
            if in_ring(lon, lat, p[0]) and not any(in_ring(lon, lat, h) for h in p[1:]):
                return name
    return ''


def metres(lat_a, lon_a, lat_b, lon_b):
    return math.hypot((lat_a - lat_b) * 111320, (lon_a - lon_b) * 111320 * math.cos(math.radians(lat_a)))


# --- addresses ----------------------------------------------------------------

STREET_TYPES = {'улица', 'ул', 'проспект', 'пр-кт', 'просп', 'пр', 'переулок', 'пер', 'бульвар', 'б-р', 'бул',
                'шоссе', 'ш', 'проезд', 'пр-д', 'площадь', 'пл', 'набережная', 'наб', 'тупик', 'аллея', 'линия'}


def street_key(s):
    s = re.sub(r'[^а-я0-9\- ]', ' ', (s or '').lower().replace('ё', 'е'))
    return ' '.join(sorted(w for w in s.split() if w not in STREET_TYPES))


def house_key(h):
    h = (h or '').lower().replace('ё', 'е')
    h = re.sub(r'\bд(ом)?\.?\s*', '', h)
    h = re.sub(r'(корпус|корп\.?|к\.)\s*', 'к', h)
    h = re.sub(r'(строение|стр\.?|с\.)\s*', 'с', h)
    h = re.sub(r'(владение|вл\.?)\s*', '', h)
    return re.sub(r'[\s,]+', '', h)


def address_index(path):
    index = {}
    for e in json.load(open(path, encoding='utf-8'))['elements']:
        t = e['tags']
        lat, lon = e.get('lat') or e['center']['lat'], e.get('lon') or e['center']['lon']
        index[(street_key(t['addr:street']), house_key(t['addr:housenumber']))] = (lat, lon)
    by_street = collections.defaultdict(list)
    for (s, _), pt in index.items():
        by_street[s].append(pt)
    return index, by_street


def place_egrul(card, index, by_street):
    """(point or None, candidate points) for an ЕГРЮЛ address like
    '119571,МОСКВА ГОРОД,,,,ПРОСПЕКТ ВЕРНАДСКОГО,90,1,'."""
    parts = (card.get('Адрес') or '').split(',')
    if len(parts) < 8:
        return None, []
    street = street_key(parts[5])
    dom = house_key(re.sub(r'^Д\.?', '', parts[6].strip().upper()))
    korp = re.sub(r'^(К|КОРП)\.?', '', parts[7].strip().upper()).lower()
    stroenie = re.search(r'СТР\.?\s*([^,\s]+)', (card.get('АдресРФ') or '').upper())
    stroenie = stroenie.group(1).lower() if stroenie else ''
    for house in (dom + (f'к{korp}' if korp else '') + (f'с{stroenie}' if stroenie else ''),
                  dom + (f'к{korp}' if korp else ''), dom):
        if (street, house) in index:
            return index[(street, house)], []
    return None, by_street.get(street, [])


# --- names --------------------------------------------------------------------

NAME_STOP = set('храм церковь часовня в во при и на иконы божией матери святого святой святых святителя '
                'священномученика священномучениц великомученика великомученицы преподобного преподобной '
                'мученицы праведного праведных равноапостольной равноапостольных благоверного благоверных князя '
                'княгини князей господня пресвятой богородицы московского москвы москва г ул честь всея руси '
                'чудотворца архиепископа митрополита патриарха местная религиозная организация православный '
                'приход православная епархии русской церкви патриархат московский централизованная прихода храма '
                'храме подворье ставропигиального мужского женского монастыря христиан евангельских евангельской '
                'веры пятидесятников общины община миссия городе города объединение центр российское'.split())


def egrul_name(s):
    """ЕГРЮЛ writes names in capitals; give place words their capital back
    so 'В УЗКОМ' reads as a place like 'в Узком' does."""
    s = (s or '').lower()
    return re.sub(r'\s(в|во|на)\s+(?!(?:честь|земле|городе|г\.)\b)([а-яё])',
                  lambda m: f' {m.group(1)} {m.group(2).upper()}', s)


def name_key(s):
    s = re.sub(r'[^а-я0-9 ]', ' ', (s or '').lower().replace('ё', 'е'))
    return {w[:6] for w in s.split() if w not in NAME_STOP and len(w) > 2}


PLACE = re.compile(r'\s(?:в|во|на)\s+((?!Земле)[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)')


def place_word(s):
    """The 'в Узком' / 'на Каховке' part: two Kazan churches in different
    places are two churches, however alike the rest of the name."""
    m = PLACE.search(s or '')
    return m.group(1).split()[0].lower().replace('ё', 'е')[:5] if m else ''


def district_in_name(s):
    """'в Ясеневе' -> 'Ясенево', when the place word names one of the districts."""
    p = place_word(s)[:4]
    for d in DISTRICTS:
        if p and d.lower().replace('ё', 'е')[:4] == p:
            return d
    return ''


def card_score(name, card):
    """name_score, but a name that says 'в Ясеневе' does not match a card
    standing in Черёмушки."""
    d = district_in_name(name)
    if d and card.get('_d') and card['_d'] != d:
        return 0.0
    return name_score(name, card['title'])


def name_score(a, b):
    ka, kb = name_key(PLACE.sub(' ', a or '')), name_key(PLACE.sub(' ', b or ''))
    pa, pb = place_word(a), place_word(b)
    if pa and pb and pa != pb:
        return 0.0
    return len(ka & kb) / max(1, min(len(ka), len(kb)))


CONFESSIONS = [
    ('Ислам', ['мусульман', 'ислам', 'мечет', 'муфти']),
    ('Иудаизм', ['иуде', 'еврей', 'синагог', 'хабад', 'хаверим']),
    ('Буддизм', ['будд', 'дацан', 'ганден']),
    ('Католики', ['католи', 'костел']),
    ('Протестанты', ['евангел', 'баптист', 'пятидесят', 'адвентист', 'лютеран', 'протестант', 'христиан веры',
                     'пресвитериан', 'методист', 'полного евангелия', 'ковчег', 'новая жизнь', 'открытая дверь',
                     'источник жизни']),
    ('Старообрядцы', ['старообряд', 'древлеправослав']),
    ('Армянская церковь', ['армян']),
    ('Зороастризм', ['зороастр']),
]


def confession(text):
    t = (text or '').lower().replace('ё', 'е')
    for name, words in CONFESSIONS:
        if any(w in t for w in words):
            return name
    return 'Православие' if re.search(r'православ|храм|церк|часовн|приход|подворь|монастыр|епархи|крест|икона|причт|трапезн|воскресная школа', t) else 'Другое'


def object_type(title, rubrics):
    t, r = (title or '').lower(), (rubrics or '').lower()
    if 'памятный крест' in r:
        return 'Памятный крест'
    if re.search(r'лавка|трапезн', t) or r.startswith('религиозные товары'):
        return 'Лавка / трапезная'
    if re.search(r'воскресная школа|дом причта|крестильн|молитвенная комната', t) or r == 'воскресная школа':
        return 'Подразделение прихода'
    if 'часовн' in t or r.startswith('часовня'):
        return 'Часовня'
    return 'Храм / религиозная организация'


# --- sources ------------------------------------------------------------------

def read_register(reestr, raw):
    wb = load_workbook(reestr, read_only=True)
    rows = list(wb['Религия'].iter_rows(values_only=True))
    header = [str(h) for h in rows[0]]
    ids = {str(r[header.index('place_id')]) for r in rows[1:] if r[header.index('place_id')]}
    ours, raw_religious = [], []
    with io.open(raw, encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            try:
                r['_lat'], r['_lon'] = float(r['latitude']), float(r['longitude'])
            except (TypeError, ValueError):
                r['_lat'] = r['_lon'] = None
            if r['place_id'] in ids:
                ours.append(r)
            elif 'Религ' in (r.get('source_group') or ''):
                raw_religious.append(r)
    missing = ids - {r['place_id'] for r in ours}
    if missing:
        sys.exit(f'{len(missing)} place_id из листа «Религия» нет в RAW - файлы от разных выгрузок?')
    return ours, raw_religious


def nearest(ours, lat, lon):
    best = min(((metres(lat, lon, o['_lat'], o['_lon']), o) for o in ours if o['_lat'] is not None),
               key=lambda x: x[0], default=(float('inf'), None))
    return best


# --- workbook -----------------------------------------------------------------

def sheet(wb, title, header, rows, widths, note=None):
    ws = wb.create_sheet(title)
    ws.append(header)
    for r in rows:
        ws.append(r)
    for c in ws[1]:
        c.font, c.fill = HEAD, FILL
        c.alignment = Alignment(wrap_text=True, vertical='center')
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
        for row in ws.iter_rows(min_row=2, min_col=i, max_col=i):
            row[0].alignment = Alignment(wrap_text=True, vertical='top')
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f'A1:{get_column_letter(len(header))}{ws.max_row}'
    if note:
        ws.cell(ws.max_row + 2, 1, note).font = NOTE
    return ws


def main():
    p = argparse.ArgumentParser(description='Сверка религиозных учреждений реестра с независимыми источниками')
    p.add_argument('--raw', required=True, help='RAW CSV выгрузки (координаты)')
    p.add_argument('--reestr', required=True, help='общий отчёт xlsx с листом «Религия»')
    p.add_argument('--boundaries', default='data/uzao_districts.geojson')
    p.add_argument('--osm', help='Overpass JSON: места богослужения (out center tags)')
    p.add_argument('--osm-addr', help='Overpass JSON: дома с addr:street и addr:housenumber')
    p.add_argument('--diocese', help='JSON храмов викариатства: name, addr, phone, url, blag, pripis')
    p.add_argument('--egrul-list', help='JSON списка pb.nalog.ru (ОКВЭД 94.91, Москва)')
    p.add_argument('--egrul-cards', help='JSON карточек pb.nalog.ru по ИНН')
    p.add_argument('--date', default='', help='дата выгрузки источников для справки')
    p.add_argument('--out', default='SVERKA_religiya.xlsx')
    a = p.parse_args()

    polys = load_polygons(a.boundaries)
    ours, raw_religious = read_register(a.reestr, a.raw)
    for o in ours:
        o['_d'] = district_of(polys, o['_lat'], o['_lon']) if o['_lat'] is not None else ''
    index, by_street = address_index(a.osm_addr) if a.osm_addr else ({}, {})
    wb = Workbook()
    summary = wb.active
    summary.title = 'Итоги'
    lines = []

    # 1. the register itself, with the columns a human filters on
    phones = collections.defaultdict(list)
    for o in ours:
        if o['phone']:
            phones[o['phone']].append(o['title'])
    rows = []
    for o in sorted(ours, key=lambda o: (district_of(polys, o['_lat'], o['_lon']), o['title'])):
        same = [t for t in phones.get(o['phone'], []) if t != o['title']]
        rows.append([district_of(polys, o['_lat'], o['_lon']), o['title'], confession(o['title'] + ' ' + o['categories']),
                     object_type(o['title'], o['categories']), o['categories'], o['address'], o['phone'],
                     '; '.join(same), o['maps_url'], o['place_id']])
    sheet(wb, 'Реестр с пометками', ['Район', 'Название', 'Конфессия', 'Тип объекта', 'Рубрики', 'Адрес', 'Телефон',
                                     'Тот же телефон у', 'Карточка', 'place_id'],
          rows, [16, 44, 14, 22, 30, 34, 16, 34, 30, 14],
          '«Тот же телефон у» обычно означает один приход с приписными храмами. Строки не удалены: '
          'это подсказки для фильтра.')
    types = collections.Counter(r[3] for r in rows)
    confs = collections.Counter(r[2] for r in rows)
    lines.append(('Реестр (Яндекс Карты)', f'{len(rows)} строк; ' + ', '.join(f'{k.lower()} {v}' for k, v in types.most_common())))
    lines.append(('  по конфессиям', ', '.join(f'{k.lower()} {v}' for k, v in confs.most_common())))

    # 2. what the geo filter dropped, and why
    rows = []
    for r in raw_religious:
        d = district_of(polys, r['_lat'], r['_lon']) if r['_lat'] is not None else ''
        rows.append([r['title'], r['categories'], r['address'], r['source_district'],
                     'вне ЮЗАО по координатам' if not d else f'в районе {d}, но отсеяно по рубрике', r['maps_url']])
    sheet(wb, 'Отсеяно фильтром', ['Название', 'Рубрики', 'Адрес', 'Искали в районе', 'Почему не в реестре', 'Карточка'],
          rows, [44, 30, 40, 22, 30, 30])
    lines.append(('Отсеяно фильтром расширения', f'{len(rows)}; вне ЮЗАО по координатам: '
                  f'{sum(1 for r in rows if r[4].startswith("вне"))}'))

    # 3. diocese
    if a.diocese:
        rows = []
        for d in json.load(open(a.diocese, encoding='utf-8')):
            seen = set()
            for i, name in enumerate([d['name']] + d.get('pripis', [])):
                if name in seen or (i and name == d['name']):
                    continue
                seen.add(name)
                score, best = max(((card_score(name, o), o) for o in ours), key=lambda x: x[0])
                where = ''
                if i == 0 and d.get('addr') and index:
                    m = re.search(r'([А-Яа-яЁё\.\- ]+?(?:ул\.?|улица|просп\.?|проспект|пр-т\.?|бульвар|б-р|проезд|шоссе|наб\.?)'
                                  r'[А-Яа-яЁё\.\- ]*?),?\s*(?:д\.|дом|вл\.?)?\s*([0-9]+[А-Яа-я]?)', d['addr'])
                    if m and (street_key(m.group(1)), house_key(m.group(2))) in index:
                        pt = index[(street_key(m.group(1)), house_key(m.group(2)))]
                        where = district_of(polys, *pt) or 'вне ЮЗАО'
                        gap, o = nearest(ours, *pt)
                        if gap <= NEAR_METRES and score < 0.5:
                            score, best = 0.5, o
                status = 'есть на Картах' if score >= 0.6 else ('проверить' if score >= 0.4 else 'нет на Картах')
                rows.append([status, name, 'приписной' if i else 'храм', d.get('blag', ''), d.get('addr', '') if i == 0 else '',
                             where, d.get('phone', '') if i == 0 else '', best['title'] if status != 'нет на Картах' else '',
                             round(score, 2), d.get('url', '')])
        order = {'нет на Картах': 0, 'проверить': 1, 'есть на Картах': 2}
        rows.sort(key=lambda r: (order[r[0]], r[1]))
        sheet(wb, 'Епархия', ['Статус', 'Храм по списку викариатства', 'Вид', 'Благочиние', 'Адрес по сайту', 'Район по адресу',
                              'Телефон', 'Ближайшая похожая запись реестра', 'Сходство названий', 'Страница храма'],
              rows, [16, 50, 12, 20, 40, 16, 18, 40, 10, 30],
              'Статус выставлен по сходству названий и по расстоянию до нашей карточки. «Проверить» - сходство '
              'неполное; решает человек.')
        c = collections.Counter(r[0] for r in rows)
        lines.append(('Список викариатства', f'{len(rows)} храмов и приписных; ' + ', '.join(f'{k} {v}' for k, v in c.items())))

    # 4. OpenStreetMap
    if a.osm:
        rows = []
        for e in json.load(open(a.osm, encoding='utf-8'))['elements']:
            lat, lon = e.get('lat') or e['center']['lat'], e.get('lon') or e['center']['lon']
            d = district_of(polys, lat, lon)
            if not d:
                continue
            t = e.get('tags', {})
            gap, o = nearest(ours, lat, lon)
            rows.append(['есть на Картах' if gap <= NEAR_METRES else 'нет на Картах', d, t.get('name', '(без названия)'),
                         t.get('religion', ''), t.get('denomination', ''),
                         ' '.join(filter(None, [t.get('addr:street'), t.get('addr:housenumber')])),
                         o['title'] if o else '', round(gap), f"https://www.openstreetmap.org/{e['type']}/{e['id']}"])
        rows.sort(key=lambda r: (r[0] != 'нет на Картах', r[1]))
        sheet(wb, 'OpenStreetMap', ['Статус', 'Район', 'Название', 'Религия', 'Деноминация', 'Адрес', 'Ближайшая запись реестра',
                                    'До неё, м', 'Объект OSM'], rows, [16, 16, 44, 12, 16, 30, 40, 10, 34])
        c = collections.Counter(r[0] for r in rows)
        lines.append(('OpenStreetMap', f'{len(rows)} объектов в ЮЗАО; ' + ', '.join(f'{k} {v}' for k, v in c.items())))

    # 5. ЕГРЮЛ
    if a.egrul_list and a.egrul_cards:
        listed = {x['inn']: x for x in json.load(open(a.egrul_list, encoding='utf-8'))
                  if x.get('sulst_name_ex') == 'Действующая организация'}
        cards = json.load(open(a.egrul_cards, encoding='utf-8'))
        by_upper = {d.upper().replace('Ё', 'Е'): d for d in DISTRICTS}
        rows = []
        for inn, card in cards.items():
            rf = (card.get('АдресРФ') or '').upper().replace('Ё', 'Е')
            m = re.search(r'МУНИЦИПАЛЬНЫЙ ОКРУГ ([А-Я\- ]+?)(,|$)', rf)
            pt, candidates = place_egrul(card, index, by_street)
            if m:
                d = by_upper.get(m.group(1).strip(), '')
                how = 'муниципальный округ в адресе ЕГРЮЛ'
            elif not rf[:6].startswith(('117', '119')):
                continue
            elif pt:
                d, how = district_of(polys, *pt), 'адрес найден до дома'
            else:
                found = {district_of(polys, *c) for c in candidates}
                d = found.pop() if len(found) == 1 else ''
                how = 'только по улице и индексу - проверить'
            if not d:
                continue
            name = card.get('НаимЮЛПолн') or listed.get(inn, {}).get('namep', '')
            key = egrul_name(name)
            # A parish is often registered at another church's address, so a
            # card next door is a match only when the names agree too.
            conf = confession(name)
            same = [x for x in ours if confession(x['title'] + ' ' + x['categories']) == conf]
            score, o = max(((card_score(key, x), x) for x in same), key=lambda x: x[0], default=(0, None))
            match = o['title'] if score >= 0.6 else ''
            if not match and pt:
                gap, near = nearest(ours, *pt)
                if gap <= NEAR_METRES and near in same and card_score(key, near) >= 0.4:
                    match = near['title']
            rows.append(['есть на Картах' if match else 'нет на Картах', d, conf, name, card.get('АдресРФ'),
                         how, match, inn, card.get('ОГРН'), listed.get(inn, {}).get('dtogrn', '')])
        rows.sort(key=lambda r: (r[0] != 'нет на Картах', r[2], r[1]))
        sheet(wb, 'ЕГРЮЛ', ['Статус', 'Район', 'Конфессия', 'Организация', 'Юридический адрес', 'Как определён район',
                            'Похожая запись реестра', 'ИНН', 'ОГРН', 'Дата регистрации'],
              rows, [16, 16, 14, 60, 44, 26, 36, 13, 16, 12],
              'Юридический адрес - место регистрации, а не всегда место богослужения: многие приходы и '
              'общины зарегистрированы при другом храме, в офисе или в квартире.')
        c = collections.Counter(r[2] for r in rows)
        lines.append(('ЕГРЮЛ, ОКВЭД 94.91', f'карточек с адресом {len(cards)} из {len(listed)} действующих в Москве; '
                      f'в ЮЗАО {len(rows)}: ' + ', '.join(f'{k.lower()} {v}' for k, v in c.most_common())))
        c2 = collections.Counter(r[0] for r in rows)
        lines.append(('  из них', ', '.join(f'{k} {v}' for k, v in c2.items())))

    summary['A1'] = 'СВЕРКА РЕЛИГИОЗНЫХ УЧРЕЖДЕНИЙ ЮЗАО'
    summary['A1'].font = Font(bold=True, size=14)
    if a.date:
        summary['A2'] = f'Источники выгружены {a.date}.'
        summary['A2'].font = NOTE
    summary.append([])
    for k, v in lines:
        summary.append([k, v])
        summary.cell(summary.max_row, 2).alignment = Alignment(wrap_text=True, vertical='top')
    summary.column_dimensions['A'].width = 32
    summary.column_dimensions['B'].width = 100
    wb.save(a.out)
    for k, v in lines:
        print(f'{k}: {v}')


if __name__ == '__main__':
    main()
