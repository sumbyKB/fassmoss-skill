"""Analyze evidence collected from visible FastMoss pages, without credentials."""
import argparse
import json
import math
from pathlib import Path
from statistics import median


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def divide(a, b, scale=1):
    return a / b * scale if numeric(a) and numeric(b) and b > 0 else None


def summarize(rows):
    # Never combine partial numerators and denominators into a spurious ratio.
    paired = [r for r in rows if numeric(r.get('gmv')) and numeric(r.get('units'))]
    revenue = sum(r['gmv'] for r in paired)
    units = sum(r['units'] for r in paired)
    amounts = [r['gmv'] for r in rows if numeric(r.get('gmv'))]
    return {'observed_records': len(rows), 'gmv_records': len(amounts),
            'observed_gmv': sum(amounts) if amounts else None,
            'mean_record_gmv': sum(amounts) / len(amounts) if amounts else None,
            'median_record_gmv': median(amounts) if amounts else None,
            'top1_share_of_observed_gmv': divide(max(amounts), sum(amounts)) if amounts else None,
            'gmv_per_unit': divide(revenue, units), 'paired_gmv_units_records': len(paired),
            'scope': '仅已采集记录；GMV/销量为件均销售额，不是订单客单价。'}


def live_metrics(row):
    """Session-level efficiency; person-visits are deliberately not unique UV."""
    seconds = row.get('duration_seconds')
    products = row.get('product_metrics', [])
    unique = {}
    for product in products:
        if not isinstance(product.get('id'), str) or not product.get('source_url'):
            raise ValueError('Product metric requires text id and source_url')
        if product.get('session_id') != row['id']:
            raise ValueError('Product metric belongs to another session')
        for key in ('gmv', 'units', 'commission_rate'):
            if product.get(key) is not None and not numeric(product[key]):
                raise ValueError('Invalid product numeric: ' + key)
        if numeric(product.get('commission_rate')) and product['commission_rate'] > 1:
            raise ValueError('Commission must be a fraction')
        if product['id'] in unique and unique[product['id']] != product:
            raise ValueError('Conflicting session product duplicate')
        unique[product['id']] = product
    matched = row.get('session_scope_verified') is True
    return {'duration_hours': divide(seconds, 3600),
            'computed_gmv_per_hour': divide(row.get('gmv'), seconds, 3600) if matched else None,
            'computed_units_per_hour': divide(row.get('units'), seconds, 3600) if matched else None,
            'gmv_per_1000_person_visits': divide(row.get('gmv'), row.get('viewer_visits'), 1000) if matched else None,
            'active_product_ratio': divide(row.get('active_product_count'), row.get('listed_product_count')) if matched else None,
            'platform_metrics': row.get('platform_metrics', {}),
            'observed_product_rows': list(unique.values()),
            'product_coverage': row.get('product_coverage', '未采集'),
            'warnings': ['人次不是去重UV；不称点击转化率', '平台转化率及平均成交单价保留原标签，分母定义未核实',
                         '平台小时值与总额/时长可能不同，保留两者，不静默覆盖']}


def analyze(data):
    for key in ('creator_id', 'source_url', 'collected_at', 'currency', 'period', 'coverage'):
        if not data.get(key):
            raise ValueError('Missing metadata: ' + key)
    records, keys = [], set()
    for row in data.get('records', []):
        if row.get('kind') not in ('video', 'live') or not isinstance(row.get('id'), str) or not row.get('source_url'):
            raise ValueError('Each record requires kind, text id and source_url')
        if row.get('period') != data['period'] or row.get('currency') != data['currency']:
            raise ValueError('Mixed period/currency: analyze separately')
        for field in ('gmv', 'units', 'views', 'orders', 'clicks', 'refund_orders', 'duration_seconds', 'viewer_visits', 'listed_product_count', 'active_product_count'):
            if row.get(field) is not None and not numeric(row[field]):
                raise ValueError('Invalid number: ' + field)
        if numeric(row.get('refund_orders')) and numeric(row.get('orders')) and row['refund_orders'] > row['orders']:
            raise ValueError('Refund orders exceed orders')
        if numeric(row.get('active_product_count')) and numeric(row.get('listed_product_count')) and row['active_product_count'] > row['listed_product_count']:
            raise ValueError('Active products exceed listed products')
        key = (row['kind'], row['id'])
        if key in keys:
            if next(r for r in records if (r['kind'], r['id']) == key) != row:
                raise ValueError('Conflicting duplicate: ' + row['id'])
            continue
        keys.add(key)
        records.append(row)
    metrics = []
    for row in records:
        # Only explicit matching scopes may produce click/refund/order metrics.
        scoped = row.get('denominators_verified') is True
        metrics.append({'id': row['id'], 'kind': row['kind'], 'source_url': row['source_url'],
                        'gmv_per_unit': divide(row.get('gmv'), row.get('units')),
                        'order_aov': divide(row.get('gmv'), row.get('orders')) if scoped else None,
                        'click_order_conversion': divide(row.get('orders'), row.get('clicks')) if scoped else None,
                        'refund_order_rate': divide(row.get('refund_orders'), row.get('orders')) if scoped else None,
                        'observed_gpm': divide(row.get('gmv'), row.get('views'), 1000) if row.get('views_scope_verified') else None})
        if row['kind'] == 'live':
            metrics[-1]['live_efficiency'] = live_metrics(row)
    competitors = []
    for competitor in data.get('competitors', []):
        product_ids = set(competitor.get('product_ids', []))
        shop_ids = set(competitor.get('shop_ids', []))
        if not product_ids and not shop_ids:
            raise ValueError('Competitor needs explicit product_ids or shop_ids')
        matched = [r for r in records if any(p.get('id') in product_ids or p.get('shop_id') in shop_ids for p in r.get('products', []) + r.get('product_metrics', []))]
        product_effects = []
        for row in matched:
            if row['kind'] != 'live':
                continue
            for product in live_metrics(row)['observed_product_rows']:
                if product.get('id') in product_ids or product.get('shop_id') in shop_ids:
                    product_effects.append({'session_id': row['id'], **product})
        attributed = []
        for row in matched:
            products = row.get('products', [])
            if len(products) == 1 and row.get('products_complete') is True:
                attributed.append(row)
        competitors.append({'name': competitor['name'], 'observed_promotion_count': len(matched),
                            'video_count': sum(r['kind'] == 'video' for r in matched),
                            'live_count': sum(r['kind'] == 'live' for r in matched),
                            'effect_single_product_only': summarize(attributed),
                            'live_product_effects': product_effects,
                            'live_product_observed_gmv': sum(p['gmv'] for p in product_effects if numeric(p.get('gmv'))) if any(numeric(p.get('gmv')) for p in product_effects) else None,
                            'live_product_effect_scope': '仅已采集场次商品行，不叠加全场GMV；商品未出现于部分列表不代表未推广。',
                            'multi_product_unattributed_count': len(matched) - len(attributed),
                            'evidence_urls': [r['source_url'] for r in matched],
                            'meaning': '挂车推广记录，不是已证实付费合作；多商品场次不将全场GMV归给竞品。'})
    comments = data.get('comments', [])
    valid_comments = {}
    for comment in comments:
        if comment.get('id') and comment.get('source_url') and comment.get('text'):
            valid_comments[comment['id']] = comment
    sentiments = {'positive': 0, 'neutral': 0, 'negative': 0, 'unclassified': 0}
    for comment in valid_comments.values():
        label = comment.get('sentiment')
        if label not in sentiments or not comment.get('sentiment_basis'):
            label = 'unclassified'
        sentiments[label] += 1
    scenarios = []
    for scenario in data.get('scenarios', []):
        required = ('assumed_gmv', 'margin_rate', 'commission_rate', 'refund_loss_rate', 'fixed_cost')
        if not all(numeric(scenario.get(k)) for k in required):
            raise ValueError('Incomplete scenario assumptions')
        for rate in ('margin_rate', 'commission_rate', 'refund_loss_rate'):
            if scenario[rate] > 1:
                raise ValueError('Rates must be fractions in [0,1]')
        net = scenario['margin_rate'] - scenario['commission_rate'] - scenario['refund_loss_rate']
        contribution = scenario['assumed_gmv'] * net
        scenarios.append({**scenario, 'contribution_before_fixed_cost': contribution,
                          'profit': contribution - scenario['fixed_cost'],
                          'profit_roi': (contribution - scenario['fixed_cost']) / scenario['fixed_cost'] if scenario['fixed_cost'] else None,
                          'break_even_gmv': scenario['fixed_cost'] / net if net > 0 else None,
                          'label': '用户成本与销售假设的情景计算，不是平台预测；所有金额同币种'})
    return {'creator_id': data['creator_id'], 'source_url': data['source_url'],
            'collected_at': data['collected_at'], 'period': data['period'], 'currency': data['currency'],
            'coverage': data['coverage'], 'video': summarize([r for r in records if r['kind'] == 'video']),
            'live': summarize([r for r in records if r['kind'] == 'live']), 'record_metrics': metrics,
            'competitors': competitors, 'comment_sample': {'size': len(valid_comments), 'labels': sentiments,
                'scope': '仅已提供正文样本；标签为人工/AI判断，不能由评论数推断舆情或退款率'},
            'scenarios': scenarios,
            'potential': '待同类目同价格段全量数据、投流归因及真实成本验证；不外推当前头部样本',
            'limitations': ['转化率、客单价和退款率缺少已验证分母时为null',
                            '未读取的直播/视频不当作零表现', '竞品须由明确商品或店铺ID配置，不凭名称猜测',
                            '样本集中度不是完整历史集中度，页面估算GMV不是实际结算收入']}


def markdown(report):
    lines = ['# 历史带货表现拆解', '', f"达人：{report['creator_id']} | 币种：{report['currency']}",
             f"周期：{report['period']}", f"来源：{report['source_url']}",
             f"采集时间：{report['collected_at']}", f"覆盖范围：{report['coverage']}", '']
    for title, key in [('短视频样本', 'video'), ('直播样本', 'live')]:
        lines += ['## ' + title, '', '```json', json.dumps(report[key], ensure_ascii=False, indent=2), '```', '']
    for title, key in [('逐条指标', 'record_metrics'), ('竞品推广', 'competitors'), ('评论舆情样本', 'comment_sample'), ('成本情景', 'scenarios')]:
        lines += ['## ' + title, '', '```json', json.dumps(report[key], ensure_ascii=False, indent=2), '```', '']
    lines += ['## 投产潜力与限制', '', report['potential'], ''] + ['- ' + x for x in report['limitations']]
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = analyze(json.loads(args.input.read_text(encoding='utf-8-sig')))
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'analysis.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    (args.output / 'report.md').write_text(markdown(report), encoding='utf-8')
    print('Report saved: ' + str(args.output))


if __name__ == '__main__':
    main()
