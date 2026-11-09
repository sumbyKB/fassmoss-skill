import copy
import unittest
from history_analysis import analyze


class HistoryTest(unittest.TestCase):
    def setUp(self):
        self.data = dict(creator_id='1', source_url='https://www.fastmoss.com/example', collected_at='2026-11-09', currency='USD', period='28d', coverage='synthetic test only', records=[dict(id='v1', kind='video', source_url='https://www.fastmoss.com/v1', currency='USD', period='28d', gmv=100, units=10, views=1000, products=[{'id': 'p1'}])])

    def test_missing_denominators_and_dedup(self):
        self.data['records'] *= 2
        result = analyze(self.data)
        self.assertEqual(result['video']['observed_records'], 1)
        self.assertEqual(result['video']['gmv_per_unit'], 10)
        self.assertIsNone(result['record_metrics'][0]['click_order_conversion'])
        self.assertIsNone(result['record_metrics'][0]['observed_gpm'])
        self.assertIsNone(result['live']['observed_gmv'])

    def test_competitor_attribution(self):
        self.data['records'][0]['products_complete'] = True
        self.data['competitors'] = [{'name': 'test', 'product_ids': ['p1']}]
        result = analyze(self.data)['competitors'][0]
        self.assertEqual(result['observed_promotion_count'], 1)
        self.assertEqual(result['effect_single_product_only']['observed_gmv'], 100)
        self.data['records'][0]['products'].append({'id': 'p2'})
        result = analyze(self.data)['competitors'][0]
        self.assertEqual(result['multi_product_unattributed_count'], 1)
        self.assertIsNone(result['effect_single_product_only']['observed_gmv'])

    def test_period_conflict(self):
        self.data['records'][0]['period'] = '90d'
        with self.assertRaises(ValueError):
            analyze(self.data)

    def test_conflicting_duplicates(self):
        other = copy.deepcopy(self.data['records'][0])
        other['gmv'] = 20
        self.data['records'].append(other)
        with self.assertRaises(ValueError):
            analyze(self.data)

    def test_scenario(self):
        self.data['scenarios'] = [dict(assumed_gmv=1000, margin_rate=.5, commission_rate=.1, refund_loss_rate=.1, fixed_cost=400)]
        result = analyze(self.data)['scenarios'][0]
        self.assertAlmostEqual(result['profit'], -100)
        self.assertAlmostEqual(result['profit_roi'], -.25)


if __name__ == '__main__':
    unittest.main()
