#!/usr/bin/env python3
"""Builds the working report from a FINAL_FILTERED export.

The export is a data file: every field the filter computed, one row per
organisation. What people actually work with is narrower and sorted - which is
what this produces: a summary, one sheet per district, the religious
institutions kept apart from food, the chains counted, and the party branches
from a hand-kept file appended as their own sheet.

    pip install openpyxl
    python3 tools/report.py --final FINAL_FILTERED-*.csv --out REESTR.xlsx
    python3 tools/report.py --final … --er "ЕР.xlsx" --per-district out/po_rayonam/
    python3 tools/report.py --finalize --out REESTR.xlsx --per-district out/po_rayonam/

--finalize takes books that already exist (possibly edited by hand) and only
puts them in order: a Справка sheet first in every book, the party branches and
the religious sheet right after the summary, districts numbered 01-12 in the
same order as the per-district files. build() runs the same step at the end.

Rules that matter and must not drift:
  * an organisation is identified by place_id, never by name or distance;
  * its district is detected_district (from coordinates), not the query's;
  * a row whose groups include Религиозные учреждения goes to the religious
    sheet only - never into food, whatever else Yandex filed it under.
"""
import argparse, csv, datetime, glob, io, json, math, re, collections, os, sys

try:
    from openpyxl import Workbook, load_workbook
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter
except ImportError:
    sys.exit('нужен openpyxl:  pip install openpyxl')

csv.field_size_limit(10 ** 7)

RELIGION = 'Религиозные учреждения'
GROUP_ORDER = {'Общепит': 0, 'Продуктовая розница': 1, 'Пищевое производство': 2, RELIGION: 3}
HEAD = Font(bold=True, color='FFFFFF', size=11)
FILL = PatternFill('solid', fgColor='2F4858')
THIN = Border(bottom=Side(style='thin', color='DDDDDD'))
LINK = Font(color='1155CC', underline='single')
NOTE = Font(italic=True, size=9, color='555555')

COLS = [('№', 6), ('Название', 34), ('Группа', 24), ('Рубрики', 32), ('Адрес', 38), ('Телефон', 19),
        ('Доб.', 7), ('Сайт', 30), ('Часы работы', 26), ('Рейтинг', 8), ('Отзывов', 9), ('Сеть', 7),
        ('Точек в сети', 12), ('По адресу', 10), ('Карточка', 11), ('place_id', 14)]
WRAP = {'Рубрики', 'Адрес', 'Часы работы', 'Возможный дубль'}


def read_final(path):
    with io.open(path, encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit(f'{path}: пустой файл')
    missing = {'detected_district', 'detected_category_group', 'place_id'} - set(rows[0])
    if missing:
        sys.exit(f'{path}: это не FINAL_FILTERED — нет колонок {", ".join(sorted(missing))}')
    return rows


def groups_of(row):
    found = [g.strip() for g in (row.get('detected_category_group') or '').split('|') if g.strip()]
    found.sort(key=lambda g: GROUP_ORDER.get(g, 9))
    return found


def label(row):
    return ' / '.join(groups_of(row)) or '—'


def norm_addr(value):
    text = (value or '').lower().replace('ё', 'е')
    text = re.sub(r'\s*,\s*москва\s*$', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def metres(a, b):
    try:
        lat_a, lon_a = float(a['latitude']), float(a['longitude'])
        lat_b, lon_b = float(b['latitude']), float(b['longitude'])
    except (TypeError, ValueError):
        return float('inf')
    return math.hypot((lat_a - lat_b) * 111320, (lon_a - lon_b) * 111320 * math.cos(math.radians(lat_a)))


def first_rubric(row):
    return (row.get('categories') or '').split(',')[0].strip().lower().replace('ё', 'е')


def annotate(rows, near_metres=40):
    """Counts organisations per address, and names the ones standing on top of
    each other. Both are hints for a human: nothing is merged or dropped here,
    because two churches in one yard are two churches."""
    per_address = collections.Counter(norm_addr(r['address']) for r in rows if norm_addr(r['address']))
    near = collections.defaultdict(list)
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            if first_rubric(rows[i]) != first_rubric(rows[j]):
                continue
            gap = metres(rows[i], rows[j])
            if gap <= near_metres:
                near[i].append((round(gap), rows[j]['title']))
                near[j].append((round(gap), rows[i]['title']))
    for i, row in enumerate(rows):
        row['_per_addr'] = per_address.get(norm_addr(row['address']), 0)
        row['_dup'] = '; '.join(f'{t} ({d} м)' for d, t in sorted(near.get(i, []))[:3])
    return rows


def number(value, cast=float):
    try:
        return cast(value)
    except (TypeError, ValueError):
        return ''


def working_sheet(wb, name, rows, district_col=False, dup=False):
    sheet = wb.create_sheet(name[:31])
    cols = list(COLS)
    if district_col:
        cols = [cols[0], ('Район', 18)] + cols[1:]
    if dup:
        cols = cols + [('Возможный дубль', 46)]
    names = [c for c, _ in cols]
    sheet.append(names)
    for n, row in enumerate(rows, 1):
        line = [n]
        if district_col:
            line.append(row['detected_district'])
        line += [row['title'], label(row), row['categories'], row['address'], row['phone'],
                 row.get('phone_ext', ''), row['website'], row['opening_hours'],
                 number(row.get('rating')), number(row.get('review_count'), int),
                 'Да' if row.get('chain_flag') == 'CHAIN' else '', number(row.get('chain_size'), int),
                 row['_per_addr'] if row['_per_addr'] > 1 else '',
                 'открыть' if row['maps_url'] else '', row['place_id']]
        if dup:
            line.append(row['_dup'])
        sheet.append(line)
        i = sheet.max_row
        for column, url in (('Сайт', row['website']), ('Карточка', row['maps_url'])):
            if url:
                cell = sheet.cell(i, names.index(column) + 1)
                cell.hyperlink = url
                cell.font = LINK
        for c in range(1, len(cols) + 1):
            sheet.cell(i, c).border = THIN
    for cell in sheet[1]:
        cell.font, cell.fill = HEAD, FILL
        cell.alignment = Alignment(vertical='center', wrap_text=True)
    sheet.row_dimensions[1].height = 30
    for i, (_, width) in enumerate(cols, 1):
        sheet.column_dimensions[get_column_letter(i)].width = width
    for column in WRAP & set(names):
        letter = get_column_letter(names.index(column) + 1)
        for i in range(2, sheet.max_row + 1):
            sheet[f'{letter}{i}'].alignment = Alignment(wrap_text=True, vertical='top')
    sheet.freeze_panes = 'A2'
    sheet.auto_filter.ref = f'A1:{get_column_letter(len(cols))}{sheet.max_row}'
    return sheet


def er_sheets(path):
    """The party branches are kept by hand, not collected: taken as they are."""
    wb = load_workbook(path)
    header, rows = None, []
    for name in wb.sheetnames:
        for raw in wb[name].iter_rows(values_only=True):
            cells = ['' if x is None else str(x) for x in raw]
            if not any(cells):
                continue
            if cells[0].strip() == 'Район':
                header = header or cells
                continue
            if header and len(cells) >= 2:
                rows.append(cells)
    return header, rows


FOOD_GROUPS = ('Общепит', 'Продуктовая розница', 'Пищевое производство')
EXTRA_RELIGION = 'Религия — вне Карт'
FIXED_SHEETS = ('Справка', 'Сводка', 'Единая Россия', 'Религия', EXTRA_RELIGION)
EXTRA_WHAT = 'храмы и общины из списка епархии, OpenStreetMap и ЕГРЮЛ, которых нет на Яндекс Картах'
NUMBERED = re.compile(r'^\d\d ')


def plain(name):
    return NUMBERED.sub('', name)


def sheet_rows(sheet):
    """Header and non-empty data rows of a working sheet."""
    rows = [r for r in sheet.iter_rows(values_only=True) if any(v not in (None, '') for v in r)]
    return (list(rows[0]), rows[1:]) if rows else ([], [])


def group_counts(sheet):
    """Counted from the Группа column when the sheet has one; an organisation
    filed under two groups counts in both, so the groups don't add up."""
    header, rows = sheet_rows(sheet)
    counts = collections.Counter()
    if 'Группа' in header:
        k = header.index('Группа')
        for r in rows:
            for g in str(r[k] or '').split(' / '):
                counts[g.strip()] += 1
    return len(rows), counts


def column_name(wb, *names):
    """The first of names found in the book's headers: the generated sheets say
    Карточка, the raw ones keep the export's maps_url."""
    for sheet in wb:
        header, _ = sheet_rows(sheet)
        for name in names:
            if name in header:
                return f'«{name}»'
    return f'«{names[0]}»'


def help_sheet(wb, title, contents, date, district_file=False):
    if 'Справка' in wb.sheetnames:
        wb.remove(wb['Справка'])
    ws = wb.create_sheet('Справка', 0)
    ws['A1'] = title
    ws['A1'].font = Font(bold=True, size=15)
    ws['A2'] = f'Данные зафиксированы {date}. Источник организаций — Яндекс Карты, отделений партии — moscow.er.ru.'
    ws['A2'].font = NOTE
    ws.append([])
    ws.append(['КАКИЕ ОРГАНИЗАЦИИ В ФАЙЛЕ'])
    ws.cell(ws.max_row, 1).font = Font(bold=True, size=12)
    ws.append(['Лист', 'Организаций', 'Что там'])
    head = ws.max_row
    for row in contents:
        ws.append(row)
        ws.cell(ws.max_row, 3).alignment = Alignment(wrap_text=True, vertical='top')
        if row[0] == 'ВСЕГО':
            for cell in ws[ws.max_row]:
                cell.font = Font(bold=True)
    for cell in ws[head]:
        cell.font, cell.fill = HEAD, FILL
    ws.append([])
    ws.append(['ГРУППЫ'])
    ws.cell(ws.max_row, 1).font = Font(bold=True, size=12)
    for name, text in (
        ('Общепит', 'кофейни, кафе, быстрое питание, рестораны, пекарни, пиццерии, столовые, бары'),
        ('Продуктовая розница', 'супермаркеты, магазины продуктов, мяса, овощей и фруктов, рыбы, '
                                'орехов, кулинарии, пива, чая'),
        ('Пищевое производство', 'производства продуктов, пищевые ингредиенты и специи, оптовые поставщики'),
        ('Религиозные учреждения', 'православные храмы, часовни, религиозные объединения, мечети, синагога. '
                                   'В питание не входят, даже если Яндекс приписал им заодно кофейню'),
        ('Единая Россия', 'районные местные отделения и окружное отделение ЮЗАО; ведутся вручную, '
                          'Яндекс Картами не собирались'),
    ):
        ws.append([name, None, text])
        ws.cell(ws.max_row, 1).font = Font(bold=True)
        ws.cell(ws.max_row, 3).alignment = Alignment(wrap_text=True, vertical='top')
    ws.append([])
    ws.append(['КАК РАБОТАТЬ С ФАЙЛОМ'])
    ws.cell(ws.max_row, 1).font = Font(bold=True, size=12)
    steps = [
        'Одна строка — одна организация (одна точка на карте). Одинаковые названия по разным адресам — '
        'это разные точки, их не удаляют.',
        'В строке заголовков включены фильтры: по ним отбирают нужные рубрики, строки с телефоном или сайтом.',
        f'Ссылка в колонке {column_name(wb, "Карточка", "maps_url")} открывает карточку на Яндекс Картах — '
        'по ней проверяют, работает ли организация и верен ли телефон.',
        f'Колонка {column_name(wb, "Сеть", "chain_flag")} отмечает точки одной сети. '
        'Их удобнее обрабатывать вместе: у сети часто общий телефон.',
        'Район определён по координатам точки на карте, а не по тому, каким запросом она найдена.',
    ]
    if not district_file:
        steps.insert(0, 'Листы районов пронумерованы 01–12 — так же, как отдельные файлы по районам.')
    for k, text in enumerate(steps, 1):
        ws.append([f'{k}.', None, text])
        ws.cell(ws.max_row, 3).alignment = Alignment(wrap_text=True, vertical='top')
    for i, width in enumerate([34, 14, 90], 1):
        ws.column_dimensions[get_column_letter(i)].width = width
    return ws


def food_note(counts):
    parts = [f'{g.lower()} {counts[g]}' for g in FOOD_GROUPS if counts.get(g)]
    if counts.get('—'):
        parts.append(f'без рубрики {counts["—"]}')
    return ', '.join(parts)


def renumber_summary(ws, numbers):
    """Summary rows follow the district numbers instead of size."""
    found = [i for i in range(1, ws.max_row + 1) if plain(str(ws.cell(i, 1).value or '')) in numbers]
    if not found:
        return
    values = {plain(str(ws.cell(i, 1).value)): [c.value for c in ws[i]] for i in found}
    for i, name in zip(found, sorted(values, key=numbers.get)):
        for c, v in enumerate(values[name], 1):
            ws.cell(i, c).value = v
        ws.cell(i, 1).value = f'{numbers[name]:02d} {name}'


def extra_religion_sheet(wb, rows):
    """What other sources know and the map does not (tools/religion_check.py
    --dobor). These rows have no place_id, so they never join the Религия sheet:
    they sit next to it, each with the source it came from."""
    if EXTRA_RELIGION in wb.sheetnames:
        wb.remove(wb[EXTRA_RELIGION])
    if not rows:
        return
    at = wb.sheetnames.index('Религия') + 1 if 'Религия' in wb.sheetnames else len(wb.sheetnames)
    ws = wb.create_sheet(EXTRA_RELIGION, at)
    cols = [('№', 5), ('Район', 16), ('Название', 50), ('Конфессия', 14), ('Вид', 24), ('Адрес', 40), ('Телефон', 18),
            ('Источник', 26), ('Ссылка / номер', 34), ('Примечание', 34)]
    ws.append([c for c, _ in cols])
    for n, e in enumerate(rows, 1):
        ws.append([n, e['district'] or 'не указан', e['name'], e['confession'], e['kind'], e['address'], e['phone'],
                   e['source'], e['ref'], e['note']])
        ref = str(e['ref']).split(';')[0].strip()
        if ref.startswith('http'):
            ws.cell(ws.max_row, 9).hyperlink = ref
            ws.cell(ws.max_row, 9).font = LINK
    for cell in ws[1]:
        cell.font, cell.fill = HEAD, FILL
        cell.alignment = Alignment(wrap_text=True, vertical='center')
    for i, (_, w) in enumerate(cols, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
        for row in ws.iter_rows(min_row=2, min_col=i, max_col=i):
            row[0].alignment = Alignment(wrap_text=True, vertical='top')
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f'A1:{get_column_letter(len(cols))}{ws.max_row}'
    ws.cell(ws.max_row + 2, 1, 'Этих организаций нет на Яндекс Картах. У строк из ЕГРЮЛ адрес юридический: это место '
                               'регистрации, а не всегда место богослужения.').font = NOTE


# Rubric words that put a card into a food group, for cards fetched after the
# export (the extension decides this at filter time; these are its cues).
RUBRIC_GROUPS = [
    ('Общепит', ('ресторан', 'кафе', 'быстрое питание', 'пиццер', 'суши', 'кофейн', 'кофе с собой', 'бар',
                 'столов', 'доставка еды', 'чайхан', 'пекарн', 'кондитерск')),
    ('Продуктовая розница', ('супермаркет', 'гипермаркет', 'магазин продуктов', 'минимаркет', 'магазин мяса',
                             'мясная', 'магазин здорового питания', 'продукты питания')),
    ('Пищевое производство', ('производство продуктов', 'пищевое производство')),
]


def groups_for(rubrics):
    r = (rubrics or '').lower()
    return ' / '.join(g for g, words in RUBRIC_GROUPS if any(w in r for w in words)) or '—'


def patch_cards(out, per_district, cards):
    """Fills in rows the export left bare (detail_level LIST_ONLY: the card
    fetch failed, so what came through is whatever the search list carried)
    from cards read later. Only empty cells are filled - what the export has
    stays - and Группа only where it is '—', so a religious row never gains a
    food group. Rows are found by place_id and nothing else; a place_id not in
    the books is reported, never added."""
    fields = {'Рубрики': 'categories', 'Адрес': 'address', 'Телефон': 'phone', 'Сайт': 'website',
              'Часы работы': 'hours', 'Рейтинг': 'rating', 'Отзывов': 'reviews'}
    raw_cols = {'address': 'address', 'phone': 'phone', 'website': 'website', 'categories': 'categories',
                'opening_hours': 'hours', 'rating': 'rating', 'review_count': 'reviews'}
    found, district_counts = set(), {}

    def fill(sheet, colmap, group_col=None):
        header = [c.value for c in sheet[1]]
        if 'place_id' not in header:
            return
        k = header.index('place_id') + 1
        for row in range(2, sheet.max_row + 1):
            pid = str(sheet.cell(row, k).value or '')
            card = cards.get(pid)
            if not card:
                continue
            found.add(pid)
            for col, key in colmap.items():
                if col in header and card.get(key) not in (None, ''):
                    cell = sheet.cell(row, header.index(col) + 1)
                    if cell.value not in (None, ''):
                        continue
                    cell.value = card[key]
                    if key == 'website':
                        cell.hyperlink, cell.font = card[key], LINK
            if group_col and group_col in header:
                cell = sheet.cell(row, header.index(group_col) + 1)
                if cell.value in (None, '', '—'):
                    cell.value = groups_for(card.get('categories'))

    if per_district:
        for path in sorted(glob.glob(os.path.join(per_district, '[0-9][0-9]_*.xlsx'))):
            book = load_workbook(path)
            if 'Религия' in book.sheetnames:
                fill(book['Религия'], fields, 'Группа')
            if 'Организации' in book.sheetnames:
                fill(book['Организации'], fields, 'Группа')
                district_counts[os.path.basename(path)[3:-5].replace('_', ' ')] = group_counts(book['Организации'])[1]
            book.save(path)
    wb = load_workbook(out)
    for sheet in wb:
        if plain(sheet.title) not in ('Справка', 'Сводка', 'Единая Россия', EXTRA_RELIGION, 'Сети'):
            fill(sheet, raw_cols if 'title' in [c.value for c in sheet[1]] else fields, 'Группа')
    if 'Сводка' in wb.sheetnames and district_counts:
        ws = wb['Сводка']
        for i in range(1, ws.max_row + 1):
            header = [c.value for c in ws[i]]
            if header[:2] != ['Район', 'Организаций']:
                continue
            cols = {name: header.index(name) + 1 for name in FOOD_GROUPS + ('Без рубрик',) if name in header}
            totals = collections.Counter()
            j = i + 1
            while ws.cell(j, 1).value and ws.cell(j, 1).value != 'ВСЕГО':
                counts = district_counts.get(plain(str(ws.cell(j, 1).value)))
                if counts is not None:
                    for name, c in cols.items():
                        ws.cell(j, c).value = counts.get('—' if name == 'Без рубрик' else name, 0)
                for name, c in cols.items():
                    totals[name] += ws.cell(j, c).value or 0
                j += 1
            if ws.cell(j, 1).value == 'ВСЕГО':
                for name, c in cols.items():
                    ws.cell(j, c).value = totals[name]
            break
    wb.save(out)
    missing = set(cards) - found
    print(f'дополнено карточек: {len(found)} из {len(cards)}' + (f'; нет в книгах: {", ".join(sorted(missing))}' if missing else ''))


def remove_ids(out, per_district, ids):
    """Takes rows out by place_id - for organisations Yandex marks as closed
    for good - renumbers the district books and recounts the summary from what
    is left. Nothing else identifies a row."""
    ids = {str(i) for i in ids}
    removed = []

    def drop(sheet):
        header = [c.value for c in sheet[1]]
        if 'place_id' not in header:
            return
        k = header.index('place_id') + 1
        name = header.index('Название') + 1 if 'Название' in header else header.index('title') + 1
        for row in range(sheet.max_row, 1, -1):
            if str(sheet.cell(row, k).value or '') in ids:
                removed.append(f'{sheet.title}: {sheet.cell(row, name).value}')
                sheet.delete_rows(row)
        if '№' in header:
            n = 0
            for row in range(2, sheet.max_row + 1):
                if sheet.cell(row, 2).value not in (None, ''):
                    n += 1
                    sheet.cell(row, 1).value = n
        if sheet.auto_filter.ref:
            sheet.auto_filter.ref = f'A1:{get_column_letter(len(header))}{sheet.max_row}'

    counts = {}
    if per_district:
        for path in sorted(glob.glob(os.path.join(per_district, '[0-9][0-9]_*.xlsx'))):
            book = load_workbook(path)
            for name in ('Организации', 'Религия'):
                if name in book.sheetnames:
                    drop(book[name])
            if 'Организации' in book.sheetnames:
                counts[os.path.basename(path)[3:-5].replace('_', ' ')] = group_counts(book['Организации'])[1]
            book.save(path)
    wb = load_workbook(out)
    for sheet in wb:
        if plain(sheet.title) not in ('Справка', 'Сводка', 'Единая Россия', EXTRA_RELIGION, 'Сети'):
            drop(sheet)
    if 'Сводка' in wb.sheetnames:
        ws = wb['Сводка']
        for i in range(1, ws.max_row + 1):
            header = [c.value for c in ws[i]]
            if header[:2] != ['Район', 'Организаций']:
                continue
            col = {h: n + 1 for n, h in enumerate(header) if h}
            totals, j = collections.Counter(), i + 1
            while ws.cell(j, 1).value and ws.cell(j, 1).value != 'ВСЕГО':
                d = plain(str(ws.cell(j, 1).value))
                sheet = next((wb[t] for t in wb.sheetnames if plain(t) == d), None)
                if sheet is not None:
                    h, rows = sheet_rows(sheet)
                    values = {'Организаций': len(rows)}
                    if 'chain_flag' in h:
                        values['Сетевых'] = sum(1 for r in rows if r[h.index('chain_flag')])
                    if 'district_validation' in h:
                        values['Найдено запросом другого района'] = sum(
                            1 for r in rows if r[h.index('district_validation')] == 'REASSIGNED')
                    g = counts.get(d, {})
                    for name in FOOD_GROUPS:
                        values[name] = g.get(name, 0)
                    values['Без рубрик'] = g.get('—', 0)
                    for name, v in values.items():
                        if name in col:
                            ws.cell(j, col[name]).value = v
                for name, c in col.items():
                    if name != 'Район':
                        totals[name] += ws.cell(j, c).value or 0
                j += 1
            if ws.cell(j, 1).value == 'ВСЕГО':
                for name, c in col.items():
                    if name != 'Район':
                        ws.cell(j, c).value = totals[name]
            break
    wb.save(out)
    print(f'удалено строк: {len(removed)}')
    for line in removed:
        print('  ' + line)


RELIGION_COLS = [('№', 5), ('Район', 16), ('Название', 46), ('Конфессия', 14), ('Вид', 24), ('Рубрики', 30),
                 ('Адрес', 38), ('Телефон', 17), ('Сайт', 28), ('Часы работы', 24), ('Рейтинг', 8), ('Отзывов', 9),
                 ('Источник', 26), ('Ссылка', 30), ('Примечание', 30), ('place_id', 14)]


def merge_religion(wb):
    """One religious sheet in the general book: the Yandex rows and the rows
    other sources found (the «вне Карт» sheet), told apart by Источник. Yandex
    rows keep their place_id; the others carry the reference they came with.
    Running it again on a merged sheet changes nothing."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from religion_check import confession, object_type
    if 'Религия' not in wb.sheetnames:
        return
    header, rows = sheet_rows(wb['Религия'])
    if 'Источник' in header and EXTRA_RELIGION not in wb.sheetnames:
        return
    ix = {h: i for i, h in enumerate(header)}
    get = lambda r, k: r[ix[k]] if k in ix and r[ix[k]] is not None else ''
    merged = []
    for r in rows:
        if 'Источник' in ix:
            if get(r, 'Источник') == 'Яндекс Карты':
                merged.append([get(r, c) for c, _ in RELIGION_COLS])
            continue
        if not get(r, 'title'):
            continue
        title, rubrics = get(r, 'title'), get(r, 'categories')
        merged.append(['', get(r, 'district'), title, confession(f'{title} {rubrics}'), object_type(title, rubrics),
                       rubrics, get(r, 'address'), get(r, 'phone'), get(r, 'website'), get(r, 'opening_hours'),
                       get(r, 'rating'), get(r, 'review_count'), 'Яндекс Карты', get(r, 'maps_url'), '',
                       get(r, 'place_id')])
    if EXTRA_RELIGION in wb.sheetnames:
        h2, rows2 = sheet_rows(wb[EXTRA_RELIGION])
        i2 = {h: i for i, h in enumerate(h2)}
        for r in rows2:
            if not isinstance(r[0], int):
                continue
            g = lambda k: r[i2[k]] if r[i2[k]] is not None else ''
            merged.append(['', g('Район'), g('Название'), g('Конфессия'), g('Вид'), '', g('Адрес'), g('Телефон'), '', '',
                           '', '', g('Источник'), g('Ссылка / номер'), g('Примечание'), ''])
        wb.remove(wb[EXTRA_RELIGION])
    merged.sort(key=lambda m: (str(m[1]) if m[1] and m[1] != 'не указан' else 'я', m[12] != 'Яндекс Карты',
                               str(m[3]) != 'Православие', str(m[2]).lower()))
    at = wb.sheetnames.index('Религия')
    wb.remove(wb['Религия'])
    ws = wb.create_sheet('Религия', at)
    ws.append([c for c, _ in RELIGION_COLS])
    for n, m in enumerate(merged, 1):
        m[0] = n
        ws.append(m)
        for col in ('Сайт', 'Ссылка'):
            k = [c for c, _ in RELIGION_COLS].index(col) + 1
            v = str(ws.cell(ws.max_row, k).value or '').split(';')[0].strip()
            if v.startswith('http'):
                ws.cell(ws.max_row, k).hyperlink = v
                ws.cell(ws.max_row, k).font = LINK
    for cell in ws[1]:
        cell.font, cell.fill = HEAD, FILL
        cell.alignment = Alignment(wrap_text=True, vertical='center')
    for i, (_, w) in enumerate(RELIGION_COLS, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
        for row in ws.iter_rows(min_row=2, min_col=i, max_col=i):
            row[0].alignment = Alignment(wrap_text=True, vertical='top')
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f'A1:{get_column_letter(len(RELIGION_COLS))}{ws.max_row}'


def finalize(out, per_district=None, date=None, extra=None):
    date = date or datetime.date.today().strftime('%d.%m.%Y')
    files = {}
    if per_district:
        for path in sorted(glob.glob(os.path.join(per_district, '[0-9][0-9]_*.xlsx'))):
            stem = os.path.splitext(os.path.basename(path))[0]
            files[stem[3:].replace('_', ' ')] = (int(stem[:2]), path)

    district_stats = {}
    for district, (n, path) in files.items():
        book = load_workbook(path)
        total, counts = group_counts(book['Организации']) if 'Организации' in book.sheetnames else (0, {})
        rel = len(sheet_rows(book['Религия'])[1]) if 'Религия' in book.sheetnames else 0
        er = len(sheet_rows(book['Единая Россия'])[1]) if 'Единая Россия' in book.sheetnames else 0
        if extra is not None:
            extra_religion_sheet(book, [e for e in extra if e['district'] == district])
        more = len(sheet_rows(book[EXTRA_RELIGION])[1]) - 1 if EXTRA_RELIGION in book.sheetnames else 0
        district_stats[district] = (total, counts)
        contents = [['Организации', total, 'питание: ' + (food_note(counts) or '—')]]
        if rel:
            contents.append(['Религия', rel, 'религиозные учреждения района'])
        if more:
            contents.append([EXTRA_RELIGION, more, EXTRA_WHAT])
        if er:
            contents.append(['Единая Россия', er, 'отделение района и окружное отделение ЮЗАО'])
        help_sheet(book, f'{n:02d}. РАЙОН {district.upper()}', contents, date, district_file=True)
        book.save(path)

    wb = load_workbook(out)
    if extra is not None:
        extra_religion_sheet(wb, extra)
    merge_religion(wb)
    districts = [plain(n) for n in wb.sheetnames if plain(n) not in FIXED_SHEETS + ('Все организации', 'Сети')]
    numbers = {d: files[d][0] for d in districts if d in files}
    for d in sorted(d for d in districts if d not in numbers):
        numbers[d] = max(numbers.values(), default=0) + 1
    for sheet in wb:
        if plain(sheet.title) in numbers:
            sheet.title = f'{numbers[plain(sheet.title)]:02d} {plain(sheet.title)}'
    if 'Сводка' in wb.sheetnames:
        renumber_summary(wb['Сводка'], numbers)

    contents, food_total, mismatch = [], 0, []
    for name, what in (('Единая Россия', 'отделения партии: районные и окружное ЮЗАО'),
                       ('Религия', 'религиозные учреждения всех районов'),
                       (EXTRA_RELIGION, EXTRA_WHAT)):
        if name in wb.sheetnames:
            h, rows = sheet_rows(wb[name])
            count = len(rows) - (1 if name == EXTRA_RELIGION else 0)
            if name == 'Религия' and 'Источник' in h:
                src = collections.Counter('Яндекс Карты' if r[h.index('Источник')] == 'Яндекс Карты' else 'other'
                                          for r in rows)
                what = (f'религиозные учреждения всех районов: {src["Яндекс Карты"]} с Яндекс Карт и {src["other"]} '
                        'из списка епархии, OpenStreetMap и ЕГРЮЛ (колонка «Источник»)')
            contents.append([name, count, what])
    for d in sorted(numbers, key=numbers.get):
        sheet = wb[f'{numbers[d]:02d} {d}']
        total, counts = group_counts(sheet)
        if not counts and d in district_stats:
            if district_stats[d][0] != total:
                mismatch.append(f'{d}: в общем файле {total}, в файле района {district_stats[d][0]}')
            counts = district_stats[d][1]
        food_total += total
        contents.append([sheet.title, total, 'питание: ' + (food_note(counts) or '—')])
    contents.append(['ВСЕГО', food_total + sum(r[1] for r in contents if r[0] in FIXED_SHEETS),
                     f'питание {food_total} + религия и отделения партии'])
    help_sheet(wb, 'РЕЕСТР ОРГАНИЗАЦИЙ ЮЗАО', contents, date)

    first = [n for n in FIXED_SHEETS if n in wb.sheetnames]
    ordered = first + [f'{numbers[d]:02d} {d}' for d in sorted(numbers, key=numbers.get)]
    ordered += [n for n in wb.sheetnames if n not in ordered]
    wb._sheets = [wb[n] for n in ordered]
    wb.active = 0
    for sheet in wb:
        sheet.sheet_view.tabSelected = sheet.title == 'Справка'
    wb.save(out)

    print(f'{out}: листы — ' + ', '.join(ordered))
    if files:
        print(f'{per_district}: справка добавлена в {len(files)} файлов')
    for line in mismatch:
        print('РАСХОЖДЕНИЕ', line)


def build(args):
    rows = read_final(args.final)
    religion = [r for r in rows if RELIGION in groups_of(r)]
    food = [r for r in rows if RELIGION not in groups_of(r)]
    order = lambda r: (GROUP_ORDER.get(label(r).split(' / ')[0], 9),
                       (r['categories'] or '').lower(), (r['title'] or '').lower())
    food = annotate(sorted(food, key=lambda r: (r['detected_district'],) + order(r)))
    religion = annotate(sorted(religion, key=lambda r: (r['detected_district'], (r['title'] or '').lower())))
    by_district = collections.OrderedDict()
    for row in food:
        by_district.setdefault(row['detected_district'], []).append(row)

    header, er = er_sheets(args.er) if args.er else (None, [])

    wb = Workbook()
    ws = wb.active
    ws.title = 'Сводка'
    ws['A1'] = 'РЕЕСТР ОРГАНИЗАЦИЙ'
    ws['A1'].font = Font(bold=True, size=15)
    ws['A2'] = 'Яндекс Карты. Дедупликация по place_id, район — по координатам.'
    ws['A2'].font = NOTE
    ws.append([]); ws.append([])
    ws.append(['ПИТАНИЕ — лист на каждый район, всё вместе на листе «Все организации»'])
    ws.cell(ws.max_row, 1).font = Font(bold=True, size=12)
    ws.append(['Район', 'Организаций', 'Общепит', 'Продуктовая розница', 'Пищевое производство',
               'Сетевых', 'Телефон есть', 'Сайт есть'])
    head_row = ws.max_row
    count = lambda v, g: sum(1 for r in v if g in groups_of(r))
    filled = lambda v, k: sum(1 for r in v if (r.get(k) or '').strip())
    line = lambda name, v: [name, len(v), count(v, 'Общепит'), count(v, 'Продуктовая розница'),
                            count(v, 'Пищевое производство'),
                            sum(1 for r in v if r.get('chain_flag') == 'CHAIN'),
                            filled(v, 'phone'), filled(v, 'website')]
    for district, v in sorted(by_district.items(), key=lambda x: -len(x[1])):
        ws.append(line(district, v))
    ws.append(line('ВСЕГО', food))
    total_row = ws.max_row
    ws.append([]); ws.append([])
    ws.append(['ОТДЕЛЬНО ОТ ПИТАНИЯ'])
    ws.cell(ws.max_row, 1).font = Font(bold=True, size=12)
    ws.append(['Раздел', 'Организаций', 'Лист', 'Комментарий'])
    head_row2 = ws.max_row
    ws.append(['Религиозные учреждения', len(religion), 'Религия',
               'Колонки «По адресу» и «Возможный дубль» — для ручной проверки'])
    if er:
        ws.append(['Отделения партии', len(er), 'Единая Россия', 'Из отдельного файла, Картами не собиралось'])
    for row_index in (head_row, head_row2):
        for cell in ws[row_index]:
            cell.font, cell.fill = HEAD, FILL
            cell.alignment = Alignment(wrap_text=True, vertical='center')
    for cell in ws[total_row]:
        cell.font = Font(bold=True)
    for i, width in enumerate([30, 14, 12, 22, 22, 12, 14, 14], 1):
        ws.column_dimensions[get_column_letter(i)].width = width
    start = ws.max_row + 2
    for k, text in enumerate([
        'Строка с религиозной рубрикой не попадает в питание, даже если Яндекс приписал ей заодно кофейню.',
        '«Сеть» — организации с общим телефоном или названием. Для рассылки такие строки стоит схлопывать.',
        '«Сайт» и «Карточка» — кликабельные ссылки.',
        'Исходные данные со всеми служебными полями — в CSV-выгрузке расширения.',
    ]):
        ws.cell(start + k, 1, text).font = NOTE
    ws.freeze_panes = 'A6'

    working_sheet(wb, 'Все организации', food, district_col=True)
    for district, v in sorted(by_district.items()):
        working_sheet(wb, district, v)
    if religion:
        working_sheet(wb, 'Религия', religion, dup=True)

    sheet = wb.create_sheet('Сети')
    sheet.append(['Сеть (название)', 'Точек', 'Районы', 'Телефон'])
    chains = collections.defaultdict(list)
    for row in food:
        if row.get('chain_flag') == 'CHAIN':
            chains[(row['title'] or '').strip().lower()].append(row)
    for _, v in sorted(chains.items(), key=lambda x: -len(x[1])):
        phones = [r['phone'] for r in v if r['phone']]
        sheet.append([v[0]['title'], len(v), ', '.join(sorted({r['detected_district'] for r in v})),
                      collections.Counter(phones).most_common(1)[0][0] if phones else ''])
    for cell in sheet[1]:
        cell.font, cell.fill = HEAD, FILL
    for i, width in enumerate([34, 9, 58, 20], 1):
        sheet.column_dimensions[get_column_letter(i)].width = width
    sheet.freeze_panes = 'A2'
    sheet.auto_filter.ref = f'A1:D{sheet.max_row}'

    if er:
        sheet = wb.create_sheet('Единая Россия')
        sheet.append(header)
        for row in er:
            sheet.append(row)
        for cell in sheet[1]:
            cell.font, cell.fill = HEAD, FILL
            cell.alignment = Alignment(wrap_text=True, vertical='center')
        for i, width in enumerate([18, 26, 46, 30, 44, 22, 28, 16, 14, 30, 40], 1):
            sheet.column_dimensions[get_column_letter(i)].width = width
        sheet.freeze_panes = 'A2'

    wb.save(args.out)

    if args.per_district:
        os.makedirs(args.per_district, exist_ok=True)
        rel_by_district = collections.defaultdict(list)
        for row in religion:
            rel_by_district[row['detected_district']].append(row)
        er_by_district = collections.defaultdict(list)
        for row in er:
            er_by_district[(row[0] or '').strip()].append(row)
        for n, (district, v) in enumerate(sorted(by_district.items()), 1):
            book = Workbook()
            book.remove(book.active)
            working_sheet(book, 'Организации', v)
            if rel_by_district.get(district):
                working_sheet(book, 'Религия', rel_by_district[district], dup=True)
            own_er = er_by_district.get(district, []) + er_by_district.get('ЮЗАО', [])
            if own_er and header:
                sheet = book.create_sheet('Единая Россия')
                sheet.append(header)
                for row in own_er:
                    sheet.append(row)
                for cell in sheet[1]:
                    cell.font, cell.fill = HEAD, FILL
                    cell.alignment = Alignment(wrap_text=True, vertical='center')
                for i, width in enumerate([18, 26, 46, 30, 44, 22, 28, 16, 14, 30, 40], 1):
                    sheet.column_dimensions[get_column_letter(i)].width = width
                sheet.freeze_panes = 'A2'
            name = f"{n:02d}_{district.replace(' ', '_')}.xlsx"
            book.save(os.path.join(args.per_district, name))
        print(f'{args.per_district}: {len(by_district)} файлов по районам')

    if args.csv_dir:
        os.makedirs(args.csv_dir, exist_ok=True)
        fields = [f for f in rows[0] if not f.startswith('_')]
        def dump(path, data):
            with io.open(path, 'w', encoding='utf-8-sig', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore', lineterminator='\r\n')
                writer.writeheader()
                writer.writerows(data)
        dump(os.path.join(args.csv_dir, 'FINAL_pitanie.csv'), food)
        if religion:
            dump(os.path.join(args.csv_dir, 'FINAL_religiya.csv'), religion)

    print(f'{args.out}: питание {len(food)}, религия {len(religion)}, сетей {len(chains)}'
          + (f', отделений партии {len(er)}' if er else ''))
    flagged = [r for r in religion if r['_dup']]
    if flagged:
        print(f'помечено как возможные дубли: {len(flagged)} строк (колонка «Возможный дубль»)')
    finalize(args.out, args.per_district, args.date,
             json.load(open(args.extra_religion, encoding='utf-8')) if args.extra_religion else None)


def main():
    p = argparse.ArgumentParser(description='Рабочий отчёт из выгрузки FINAL_FILTERED')
    p.add_argument('--final', help='CSV выгрузки FINAL_FILTERED из расширения')
    p.add_argument('--finalize', action='store_true',
                   help='не собирать заново, а доработать готовые --out и --per-district: '
                        'справка, порядок листов, номера районов')
    p.add_argument('--remove-ids', help='JSON-список place_id, которые убрать из готовых книг (закрытые навсегда)')
    p.add_argument('--patch-cards', help='JSON {place_id: {address, categories, phone, website, hours, rating, '
                                         'reviews}}: дополнить строки, для которых карточка не загрузилась')
    p.add_argument('--extra-religion', help='JSON из tools/religion_check.py --dobor: лист «Религия — вне Карт»')
    p.add_argument('--date', help='дата фиксации данных для справки, ДД.ММ.ГГГГ (по умолчанию сегодня)')
    p.add_argument('--er', help='xlsx с отделениями партии (ведётся вручную, необязателен)')
    p.add_argument('--out', default='REESTR_otchet.xlsx', help='куда сохранить книгу')
    p.add_argument('--csv-dir', help='также выгрузить питание и религию отдельными CSV')
    p.add_argument('--per-district', help='папка для отдельных xlsx по каждому району')
    args = p.parse_args()
    extra = json.load(open(args.extra_religion, encoding='utf-8')) if args.extra_religion else None
    if args.remove_ids:
        remove_ids(args.out, args.per_district, json.load(open(args.remove_ids, encoding='utf-8')))
    if args.patch_cards:
        patch_cards(args.out, args.per_district, json.load(open(args.patch_cards, encoding='utf-8')))
    if args.finalize:
        finalize(args.out, args.per_district, args.date, extra)
    elif args.final:
        build(args)
    else:
        p.error('нужен --final (собрать отчёт) или --finalize (доработать готовый)')


if __name__ == '__main__':
    main()
