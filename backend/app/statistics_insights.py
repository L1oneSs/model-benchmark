"""Multivariate diagnostics on the same bounded successful-record selection."""
from itertools import combinations
import math
import warnings

import numpy as np
from scipy import stats
from app.experiment_statistics import METRICS, adjust_holm, finite_values, group_key, safe_number


def valid(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def rank_correlation(x, y, test=False):
    if len(x) < 3 or np.ptp(x) == 0 or np.ptp(y) == 0:
        return None, None
    a, b = stats.rankdata(x), stats.rankdata(y)
    a -= a.mean(); b -= b.mean()
    denominator = np.linalg.norm(a)*np.linalg.norm(b)
    r = float(np.dot(a, b)/denominator)
    p = None
    if test:
        def statistic(sample, axis=-1):
            return np.sum(sample*b, axis=axis)/denominator
        p = float(stats.permutation_test((a,), statistic, permutation_type='pairings',
                    vectorized=True, n_resamples=1999, random_state=0, batch=100).pvalue)
    return r, p


def ordered(group):
    # DB creation order is a proxy, not guaranteed to be the original model-call order.
    return sorted(group, key=lambda row: (str(getattr(row, 'created_at', '')), getattr(row, 'id', 0)))


def insights(rows):
    grouped = {}
    for row in rows:
        grouped.setdefault(group_key(row), []).append(row)
    diagnostics = []
    for (approach, model, backend), group in grouped.items():
        chronology = ordered(group)
        correlations, trends, distributions, chronology_values = [], {}, {}, {}
        for metric in METRICS:
            x = np.array([row.metrics.get(metric) for row in chronology if valid(row.metrics.get(metric))], dtype=float)
            distributions[metric] = sorted(x.tolist())
            chronology_values[metric] = x.tolist()
            n = len(x)
            if n < 3:
                continue
            first, last = float(np.median(x[:n//2])), float(np.median(x[n//2:]))
            rho, _ = rank_correlation(np.arange(n), x)
            lag1 = None
            if n >= 4 and np.ptp(x[:-1]) > 0 and np.ptp(x[1:]) > 0:
                lag1 = safe_number(np.corrcoef(x[:-1], x[1:])[0, 1])
            trends[metric] = {'samples': n, 'spearman_r': rho,
                'slope': float(stats.linregress(np.arange(n), x).slope), 'lag1': lag1,
                'first_half_median': first, 'last_half_median': last,
                'median_change_percent': (last-first)/first*100 if first > 0 else None}
        for a, b in combinations(METRICS, 2):
            pairs = [(row.metrics.get(a), row.metrics.get(b)) for row in group
                     if valid(row.metrics.get(a)) and valid(row.metrics.get(b))]
            if not pairs:
                continue
            x, y = map(np.array, zip(*pairs))
            spearman, p = rank_correlation(x, y, test=True)
            pearson = pearson_p = None
            if len(x) >= 3 and np.ptp(x) > 0 and np.ptp(y) > 0:
                result = stats.pearsonr(x, y)
                pearson, pearson_p = safe_number(result.statistic), safe_number(result.pvalue)
            correlations.append({'a': a, 'b': b, 'samples': len(pairs), 'spearman_r': spearman,
                                 'spearman_p': p, 'pearson_r': pearson, 'pearson_p': pearson_p})
        adjust_holm(correlations, 'spearman_p', 'spearman_p_adjusted')
        adjust_holm(correlations, 'pearson_p', 'pearson_p_adjusted')
        diagnostics.append({'approach': approach, 'model': model, 'backend': backend,
                            'trends': trends, 'correlations': correlations, 'distributions': distributions,
                            'chronology': chronology_values})
    omnibus = []
    for metric in METRICS:
        samples = [finite_values([row.metrics.get(metric) for row in group]) for group in grouped.values()]
        samples = [sample for sample in samples if len(sample) >= 2]
        if len(samples) < 2:
            continue
        all_values = np.concatenate(samples)
        h, p = (0., 1.) if np.ptp(all_values) == 0 else stats.kruskal(*samples)
        epsilon = max(0., (float(h)-len(samples)+1)/(len(all_values)-len(samples)))
        variance_p = None
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', RuntimeWarning)
            if all(len(x) >= 3 for x in samples):
                variance_p = safe_number(stats.levene(*samples, center='median').pvalue)
        omnibus.append({'metric': metric, 'groups': len(samples), 'samples': len(all_values),
                        'kruskal_h': float(h), 'p_value': float(p),
                        'eta_squared_h': min(1., epsilon), 'epsilon_squared': min(1., float(h)/(len(all_values)-1)),
                        'variance_p': variance_p, 'small_groups': any(len(x) < 5 for x in samples)})
    adjust_holm(omnibus, 'p_value', 'p_value_adjusted')
    adjust_holm(omnibus, 'variance_p', 'variance_p_adjusted')
    return {'diagnostics': diagnostics, 'omnibus': omnibus,
            'methods': {'correlations': 'Pairwise complete observations within each model/backend; Spearman p: 1999 permutations, seed 0; Holm within each group/test.',
                        'trend': 'Descriptive only, ordered by DB created_at and ID; no stationarity claim.',
                        'omnibus': 'Kruskal-Wallis and median-centered Levene; Holm across available metrics separately for each test.'}}
