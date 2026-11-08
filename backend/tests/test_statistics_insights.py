import json
import math
from types import SimpleNamespace
import unittest

import numpy as np
from app.experiment_statistics import describe, compare_values, comparisons, summarize_groups
from app.statistics_insights import insights


def row(value, index=0, backend='cpu', memory=None):
    return SimpleNamespace(id=index, created_at=f'2026-10-31T00:00:{index:02}',
        approach='tensorflow_js',model_name='Test',settings={'backend':backend},
        metrics={'inference_ms':value,'memory_mb':memory})


class ExtendedStatisticsTests(unittest.TestCase):
    def test_known_spread_percentiles_and_outlier(self):
        s=describe([1,2,3,4,5,6,7,8,9,100])
        self.assertEqual(s['median'],5.5)
        self.assertEqual(s['q1'],3.25)
        self.assertEqual(s['q3'],7.75)
        self.assertEqual(s['outliers'],1)
        self.assertEqual(s['outlier_percent'],10)
        self.assertEqual(s['mad'],2.5)
        self.assertEqual(s['trimmed_mean'],5.5)
        self.assertAlmostEqual(s['variance'],np.var([1,2,3,4,5,6,7,8,9,100],ddof=1))
        self.assertLessEqual(s['mean_ci95'][0],s['mean'])
        self.assertGreaterEqual(s['mean_ci95'][1],s['mean'])

    def test_undefined_statistics_are_null_and_json_safe(self):
        for values in [[0],[0,0,0],[-2,0,2],[1,1,1],[None,True,math.nan]]:
            with self.subTest(values=values):
                s=describe(values)
                json.dumps(s,allow_nan=False)
        self.assertIsNone(describe([0,0,0])['cv_percent'])
        self.assertIsNone(describe([-2,0,2])['geometric_mean'])
        self.assertIsNone(describe([1,1,1])['normality'])
        self.assertIsNone(describe([1])['variance'])
        self.assertIsNone(describe([1])['sem'])

    def test_extended_comparison_orientation_and_ties(self):
        a,b=[1,2,3],[4,5,6]
        forward,reverse=compare_values(a,b),compare_values(b,a)
        self.assertEqual(forward['median_difference'],-3)
        self.assertEqual(forward['median_ratio'],.4)
        self.assertEqual(forward['median_change_percent'],-60)
        self.assertEqual(forward['probability_a_lower'],1)
        self.assertAlmostEqual(forward['hedges_g'],-reverse['hedges_g'])
        self.assertAlmostEqual(forward['wasserstein'],3)
        self.assertAlmostEqual(forward['welch_p'],reverse['welch_p'])
        constant=compare_values([0,0,0],[0,0,0])
        self.assertIsNone(constant['median_ratio'])
        self.assertIsNone(constant['hedges_g'])
        self.assertIsNone(constant['welch_p'])
        self.assertEqual(constant['probability_a_lower'],.5)
        json.dumps(constant,allow_nan=False)

    def test_correlations_use_same_record_pairs_and_keep_undefined_constant(self):
        rows=[row(i,i,memory=2*i) for i in range(1,7)]
        rows.append(row(100,7,memory=None))
        result=insights(rows)
        pair=result['diagnostics'][0]['correlations'][0]
        self.assertEqual(pair['samples'],6)
        self.assertAlmostEqual(pair['spearman_r'],1)
        self.assertAlmostEqual(pair['pearson_r'],1)
        constant=insights([row(i,i,memory=0) for i in range(1,7)])
        self.assertIsNone(constant['diagnostics'][0]['correlations'][0]['spearman_r'])
        json.dumps(result,allow_nan=False)
        json.dumps(constant,allow_nan=False)

    def test_trend_uses_chronological_order_and_counts_missing_metrics(self):
        rows=[row(30,3),row(10,1),row(20,2)]
        diagnostic=insights(rows)['diagnostics'][0]
        self.assertEqual(diagnostic['chronology']['inference_ms'],[10,20,30])
        self.assertAlmostEqual(diagnostic['trends']['inference_ms']['slope'],10)
        rows.append(row(None,4))
        self.assertEqual(summarize_groups(rows)[0]['metrics']['inference_ms']['missing'],1)

    def test_omnibus_and_each_test_holm_family(self):
        rows=[row(i,i,'cpu') for i in range(1,7)]+[row(i+20,i,'wasm') for i in range(1,7)]
        rows += [row(i+40,i,'webgl') for i in range(1,7)]
        result=insights(rows)
        self.assertEqual(result['omnibus'][0]['groups'],3)
        self.assertTrue(0 <= result['omnibus'][0]['epsilon_squared'] <= 1)
        for pair in comparisons(rows):
            for source,target in [('p_value','p_value_adjusted'),('welch_p','welch_p_adjusted'),('variance_p','variance_p_adjusted')]:
                if pair[source] is not None:
                    self.assertGreaterEqual(pair[target],pair[source])

    def test_empty_selection(self):
        self.assertEqual(insights([])['diagnostics'],[])
        self.assertEqual(insights([])['omnibus'],[])
