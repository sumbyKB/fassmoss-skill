import unittest
from history_analysis import analyze


class LiveTest(unittest.TestCase):
    def data(self):
        return dict(creator_id='1', source_url='https://www.fastmoss.com/c', collected_at='2026-11-09', currency='USD', period='28d', coverage='synthetic', competitors=[dict(name='test', shop_ids=['shop1'])], records=[dict(id='live1', kind='live', source_url='https://www.fastmoss.com/l', period='28d', currency='USD', gmv=1000, units=100, duration_seconds=7200, viewer_visits=10000, listed_product_count=10, active_product_count=4, session_scope_verified=True, product_metrics=[dict(id='p1', shop_id='shop1', session_id='live1', source_url='https://www.fastmoss.com/p', gmv=200, units=20)])])

    def test_efficiency_and_product_attribution(self):
        result = analyze(self.data())
        efficiency = result['record_metrics'][0]['live_efficiency']
        self.assertEqual(efficiency['computed_gmv_per_hour'], 500)
        self.assertEqual(efficiency['gmv_per_1000_person_visits'], 100)
        self.assertEqual(efficiency['active_product_ratio'], .4)
        self.assertEqual(result['competitors'][0]['live_count'], 1)
        self.assertEqual(result['competitors'][0]['live_product_observed_gmv'], 200)
        self.assertIsNone(result['record_metrics'][0]['click_order_conversion'])

    def test_duplicate_product_not_double_counted(self):
        data = self.data()
        data['records'][0]['product_metrics'] *= 2
        self.assertEqual(analyze(data)['competitors'][0]['live_product_observed_gmv'], 200)

    def test_wrong_session_rejected(self):
        data = self.data()
        data['records'][0]['product_metrics'][0]['session_id'] = 'other'
        with self.assertRaises(ValueError):
            analyze(data)


if __name__ == '__main__':
    unittest.main()
