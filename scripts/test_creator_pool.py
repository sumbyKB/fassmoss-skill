import unittest
from creator_pool import connect, ingest, latest, search, profile


class PoolTest(unittest.TestCase):
    def test_roundtrip(self):
        row = dict(id='1234567890123456789', collected_at='2026-11-09T11:00:00+08:00', source_url='https://www.fastmoss.com/zh/influencer/detail/123', country='US', currency='USD', period_days=28, followers=53700, gmv=1000, units=100)
        with connect(':memory:') as db:
            ingest(db, [row, row])
            self.assertEqual(len(latest(db)), 1)
            bad = dict(row, id=123)
            with self.assertRaises(ValueError):
                ingest(db, [dict(row, id='other'), bad])
            self.assertEqual(len(latest(db)), 1)
            result = search(latest(db), '包包、粉丝2–10w、报价≤8k')
            self.assertEqual(result['parsed']['followers'], [20000, 100000])
            self.assertEqual(len(result['candidates']), 1)
            self.assertEqual(result['verified_matches'], [])
            self.assertEqual(profile(row)['calculations']['gmv_per_unit']['value'], 10)
            self.assertIn('return_rate', profile(row)['missing'])
            self.assertEqual(search([dict(row, followers=100)], '粉丝2–10w')['candidates'], [])


if __name__ == '__main__':
    unittest.main()
