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

Rules that matter and must not drift:
  * an organisation is identified by place_id, never by name or distance;
  * its district is detected_district (from coordinates), not the query's;
  * a row whose groups include Религиозные учреждения goes to the religious
    sheet only - never into food, whatever else Yandex filed it under.
"""
import argparse, csv, io, math, re, collections, os, sys

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


def main():
    p = argparse.ArgumentParser(description='Рабочий отчёт из выгрузки FINAL_FILTERED')
    p.add_argument('--final', required=True, help='CSV выгрузки FINAL_FILTERED из расширения')
    p.add_argument('--er', help='xlsx с отделениями партии (ведётся вручную, необязателен)')
    p.add_argument('--out', default='REESTR_otchet.xlsx', help='куда сохранить книгу')
    p.add_argument('--csv-dir', help='также выгрузить питание и религию отдельными CSV')
    p.add_argument('--per-district', help='папка для отдельных xlsx по каждому району')
    build(p.parse_args())


if __name__ == '__main__':
    main()
