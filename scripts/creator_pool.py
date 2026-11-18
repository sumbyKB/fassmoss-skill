"""Evidence-preserving creator snapshots. Python standard library only."""
import argparse
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def connect(path):
    db = sqlite3.connect(path)
    db.execute('CREATE TABLE IF NOT EXISTS snapshots (id TEXT, collected_at TEXT, payload TEXT, PRIMARY KEY(id,collected_at))')
    return db


def ingest(db, rows):
    # Validate the entire batch before writing; retries are idempotent.
    for row in rows:
        for key in ('id', 'collected_at', 'source_url', 'country', 'currency', 'period_days'):
            if not row.get(key):
                raise ValueError('Missing field: ' + key)
        if not isinstance(row['id'], str):
            raise ValueError('id must be text')
        for key in ('followers', 'gmv', 'units', 'quote'):
            value = row.get(key)
            if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0):
                raise ValueError('Invalid numeric field: ' + key)
    with db:
        db.executemany('INSERT OR IGNORE INTO snapshots VALUES (?,?,?)',
                       [(r['id'], r['collected_at'], json.dumps(r, ensure_ascii=False)) for r in rows])


def latest(db):
    return [json.loads(r[0]) for r in db.execute('SELECT payload FROM snapshots s WHERE collected_at=(SELECT MAX(collected_at) FROM snapshots WHERE id=s.id) ORDER BY id')]


def number(text):
    match = re.fullmatch(r'(\d+(?:\.\d+)?)([万wWkK]?)', text)
    if not match:
        raise ValueError('Invalid number: ' + text)
    return float(match[1]) * {'': 1, '万': 10000, 'w': 10000, 'k': 1000}[match[2].lower()]


def _num(text):
    """宽松解析数值：兼容货币符号、千分位、'1.65万'/'฿838.51万' 与纯数字。"""
    if text is None or text == '':
        return None
    if isinstance(text, bool):
        return None
    if isinstance(text, (int, float)):
        return float(text)
    s = str(text).replace(',', '').strip()
    m = re.search(r'(\d+(?:\.\d+)?)([万wWkK]?)', s)
    if not m:
        return None
    return float(m.group(1)) * {'': 1, '万': 10000, 'w': 10000, 'k': 1000}[m.group(2).lower()]


def flatten_final(rows, meta):
    """把 analyze.mjs 的 creators-final.json（含 search28/overview 嵌套）拍平成池子所需的扁平 schema。
    meta 提供 collected_at / country / currency；缺 collected_at 时用文件 mtime 兜底。"""
    out = []
    for c in rows:
        if not c.get('id'):
            continue
        s28 = c.get('search28') or {}
        ov = c.get('overview') or {}
        followers = s28.get('followers') if s28.get('followers') is not None else (ov.get('fans') or {}).get('n')
        gmv = s28.get('gmv') if s28.get('gmv') is not None else (ov.get('gmvTotal') or {}).get('n')
        out.append({
            'id': str(c.get('id')),
            'collected_at': meta.get('collected_at'),
            'source_url': c.get('url') or '',
            'country': meta.get('country') or '',
            'currency': meta.get('currency') or '',
            'period_days': 28,
            'name': c.get('name'),
            'followers': _num(followers),
            'gmv': _num(gmv),
            'units': _num(s28.get('units')),
            'quote': None,
            'category': '箱包',
            'gender': s28.get('gender'),
            'female_pct': s28.get('femalePct'),
            'age_band': s28.get('ageBand'),
        })
    return out


def search(rows, query):
    constraints = {}
    match = re.search(r'粉丝\s*(\d+(?:\.\d+)?[万wWkK]?)\s*[-–—~至到]\s*(\d+(?:\.\d+)?[万wWkK]?)', query)
    if match:
        low, high = match.groups()
        if high[-1] in '万wWkK' and low[-1].isdigit():
            low += high[-1]
        constraints['followers'] = [number(low), number(high)]
    match = re.search(r'报价\s*(?:≤|<=|不超过)\s*(\d+(?:\.\d+)?[万wWkK]?)', query)
    if match:
        constraints['quote_max'] = number(match[1])
    matches, pending = [], []
    for row in rows:
        unknown, rejected = [], False
        if 'followers' in constraints:
            value = row.get('followers')
            if value is None:
                unknown.append('粉丝数')
            elif not constraints['followers'][0] <= value <= constraints['followers'][1]:
                rejected = True
        if 'quote_max' in constraints:
            unknown.append('报价币种及合作单位需确认')
        if not rejected:
            pending.append({'creator': row, 'pending': unknown + ['类目、内容风格、转化、周期及其他文字条件需逐项核验']})
    return {'query': query, 'parsed': constraints, 'verified_matches': matches, 'candidates': pending,
            'notice': '规则解析仅覆盖粉丝区间和报价上限；候选不代表满足全部自然语言条件。'}


def profile(row):
    missing = [k for k in ('content_tags', 'audience', 'quote', 'conversion_rate', 'return_rate', 'sentiment') if row.get(k) is None]
    result = {'identity': row, 'missing': missing, 'calculations': {},
              'risks': ['总GMV不代表类目GMV或合作ROI', '竞品挂车不等于付费合作'],
              'cooperation_formats': '待内容、报价和履约证据核实',
              'roi_prediction': '缺少毛利、合作成本和退款损失，暂不预测'}
    if row.get('gmv') is not None and row.get('units'):
        result['calculations']['gmv_per_unit'] = {'value': row['gmv'] / row['units'], 'currency': row['currency'], 'meaning': '总GMV/总销量，非订单客单价'}
    events = row.get('promotions', [])
    seen = set()
    brands = {}
    for event in events:
        if not all(event.get(k) for k in ('id', 'brand', 'source_url', 'kind')):
            continue
        key = (event['kind'], event['id'], event['brand'])
        if key not in seen:
            seen.add(key)
            brands[event['brand']] = brands.get(event['brand'], 0) + 1
    result['observed_brand_promotions'] = brands
    result['promotion_scope'] = '仅统计已提供的去重记录，非全量；效果保留在原始证据中'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=ROOT / 'outputs' / 'creator-pool.sqlite3')
    sub = parser.add_subparsers(dest='command', required=True)
    p_import = sub.add_parser('import')
    p_import.add_argument('file', type=Path)
    p_import.add_argument('--final', action='store_true', help='直接导入 analyze.mjs 的 creators-final.json（自动拍平 + 读同目录 details.json 的 meta）')
    sub.add_parser('search').add_argument('query')
    sub.add_parser('profiles')
    args = parser.parse_args()
    args.db.parent.mkdir(parents=True, exist_ok=True)
    with connect(args.db) as db:
        if args.command == 'import':
            rows = json.loads(args.file.read_text(encoding='utf-8-sig'))
            if getattr(args, 'final', False):
                meta = {}
                meta_file = args.file.parent / 'details.json'
                if meta_file.exists():
                    m = (json.loads(meta_file.read_text(encoding='utf-8-sig')) or {}).get('meta') or {}
                    meta['collected_at'] = m.get('collected_at')
                    meta['country'] = m.get('country')
                    # details.meta 顶层无 currency（在 filters.currency），candidates.meta 顶层有
                    meta['currency'] = m.get('currency') or (m.get('filters') or {}).get('currency')
                if not meta.get('currency'):
                    cand_file = args.file.parent / 'candidates.json'
                    if cand_file.exists():
                        meta['currency'] = (json.loads(cand_file.read_text(encoding='utf-8-sig')) or {}).get('meta', {}).get('currency')
                if not meta.get('collected_at'):
                    meta['collected_at'] = datetime.fromtimestamp(args.file.stat().st_mtime, tz=timezone.utc).isoformat()
                rows = flatten_final(rows, meta)
            ingest(db, rows)
            result = {'imported_batch_rows': len(rows), 'pool_size': len(latest(db))}
        elif args.command == 'search':
            result = search(latest(db), args.query)
        else:
            result = [profile(row) for row in latest(db)]
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
