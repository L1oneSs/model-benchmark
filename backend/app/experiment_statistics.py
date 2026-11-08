"""Shared statistics for the measurements UI and the agent."""
from itertools import combinations
import math
import warnings

import numpy as np
from scipy import stats

METRICS = ('load_ms', 'first_token_ms', 'inference_ms', 'total_ms', 'memory_mb')


def finite_values(values):
    return sorted(float(x) for x in values
                  if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x))


def describe(values):
    x = np.asarray(finite_values(values))
    if not x.size:
        return None
    ci = None
    if x.size >= 2:
        # Percentile avoids undefined BCa intervals for constant/tied samples.
        bounds = stats.bootstrap((x,), np.median, method='percentile', n_resamples=2000,
                                 random_state=0, batch=200).confidence_interval
        ci = [float(bounds.low), float(bounds.high)]
    median, mean = float(np.median(x)), float(np.mean(x))
    q1, q3 = np.quantile(x, [.25, .75])
    lower, upper = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
    outliers = int(np.sum((x < lower) | (x > upper)))
    std = float(np.std(x, ddof=1)) if x.size > 1 else None
    mean_ci = None
    if x.size >= 2:
        bounds = stats.bootstrap((x,), np.mean, method='percentile', n_resamples=2000,
                                 random_state=0, batch=200).confidence_interval
        mean_ci = [float(bounds.low), float(bounds.high)]
    normality = None
    if 3 <= x.size <= 5000 and np.ptp(x) > 0:
        test = stats.shapiro(x)
        normality = {'statistic': safe_number(test.statistic), 'p_value': safe_number(test.pvalue)}
    nonconstant = np.ptp(x) > 0
    return {'median': median, 'mean': mean,
            'min': float(x.min()), 'max': float(x.max()),
            'stdev': float(np.std(x, ddof=1)) if x.size > 1 else 0.0,
            'p95': float(np.quantile(x, .95)),
            'iqr': float(np.quantile(x, .75) - np.quantile(x, .25)),
            'ci95': ci, 'samples': int(x.size), 'mean_ci95': mean_ci,
            **{key: float(np.quantile(x, p)) for key, p in
               [('p5', .05), ('p10', .1), ('q1', .25), ('q3', .75), ('p90', .9), ('p99', .99)]},
            'range': float(np.ptp(x)), 'variance': std**2 if std is not None else None,
            'sem': std / math.sqrt(x.size) if std is not None else None,
            'cv_percent': std / mean * 100 if std is not None and mean > 0 else None,
            'mad': float(np.median(np.abs(x - median))),
            'robust_sigma': float(stats.median_abs_deviation(x, scale='normal')),
            'trimmed_mean': float(stats.trim_mean(x, .1)),
            'geometric_mean': safe_number(stats.gmean(x)) if np.all(x > 0) else None,
            'harmonic_mean': safe_number(stats.hmean(x)) if np.all(x > 0) else None,
            'skewness': safe_number(stats.skew(x, bias=False)) if x.size >= 3 and nonconstant else None,
            'excess_kurtosis': safe_number(stats.kurtosis(x, fisher=True, bias=False)) if x.size >= 4 and nonconstant else None,
            'outlier_low': float(lower), 'outlier_high': float(upper),
            'outliers': outliers, 'outlier_percent': outliers / x.size * 100,
            'zeros': int(np.sum(x == 0)), 'unique': int(np.unique(x).size),
            'tail_ratio': float(np.quantile(x, .95) / median) if median > 0 else None,
            'normality': normality}


def safe_number(value):
    """Undefined statistics must be JSON null, never NaN/Infinity or fake zero."""
    return float(value) if value is not None and math.isfinite(value) else None


def compare_values(a, b):
    a, b = finite_values(a), finite_values(b)
    result = {'n_a': len(a), 'n_b': len(b), 'cliffs_delta': None, 'p_value': None,
              'u_statistic': None, 'method': None, 'median_difference': None,
              'mean_difference': None, 'median_ratio': None, 'median_change_percent': None,
              'probability_a_lower': None, 'hedges_g': None, 'wasserstein': None,
              'welch_t': None, 'welch_p': None, 'welch_df': None,
              'variance_p': None}
    if not a or not b:
        return result
    # U includes half the ties; 2U/(n*m)-1 equals mean(sign(a_i-b_j)).
    if len(set(a + b)) == 1:
        u, p, method = len(a) * len(b) / 2, 1.0, 'constant'
    else:
        tied = len(set(a + b)) != len(a + b)
        method = 'exact' if min(len(a), len(b)) <= 8 and not tied else 'asymptotic'
        algorithm = method
        if tied and min(len(a), len(b)) < 10:
            method = 'permutation'
            algorithm = stats.PermutationMethod(n_resamples=9999, random_state=0)
        u, p = stats.mannwhitneyu(a, b, alternative='two-sided', method=algorithm)
    result['cliffs_delta'] = float(2 * u / (len(a) * len(b)) - 1)
    median_a, median_b = float(np.median(a)), float(np.median(b))
    result.update(median_difference=median_a-median_b, mean_difference=float(np.mean(a)-np.mean(b)),
                  median_ratio=median_a/median_b if median_b > 0 and median_a >= 0 else None,
                  median_change_percent=(median_a-median_b)/median_b*100 if median_b > 0 else None,
                  probability_a_lower=(1-result['cliffs_delta'])/2,
                  wasserstein=float(stats.wasserstein_distance(a, b)))
    if len(a) >= 2 and len(b) >= 2:
        result.update(p_value=float(p) if math.isfinite(p) else None,
                      u_statistic=float(u), method=method)
        va, vb = np.var(a, ddof=1), np.var(b, ddof=1)
        pooled = ((len(a)-1)*va+(len(b)-1)*vb)/(len(a)+len(b)-2)
        if pooled > 0:
            correction = 1 - 3/(4*(len(a)+len(b))-9)
            result['hedges_g'] = safe_number(correction*(np.mean(a)-np.mean(b))/math.sqrt(pooled))
        # scipy warns when variance is tiny; retain only finite returned values.
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', RuntimeWarning)
            if va > 0 or vb > 0:
                welch = stats.ttest_ind(a, b, equal_var=False)
                result.update(welch_t=safe_number(welch.statistic), welch_p=safe_number(welch.pvalue),
                              welch_df=safe_number(welch.df))
            if len(a) >= 3 and len(b) >= 3:
                result['variance_p'] = safe_number(stats.levene(a, b, center='median').pvalue)
    return result


def group_key(row):
    return (row.approach, row.model_name, (row.settings or {}).get('backend'))


def summarize_groups(rows):
    groups = {}
    for row in rows:
        groups.setdefault(group_key(row), []).append(row)
    result = []
    for (approach, model, backend), group in groups.items():
        metrics = {}
        for metric in METRICS:
            summary = describe([(r.metrics or {}).get(metric) for r in group])
            if summary is not None:
                metrics[metric] = {**summary, 'missing': len(group)-summary['samples']}
        result.append({'approach': approach, 'model': model, 'backend': backend,
                       'runs': len(group),
                       'metrics': metrics})
    return result


def comparisons(rows):
    groups = {}
    for row in rows:
        groups.setdefault(group_key(row), []).append(row)
    result = []
    for (key_a, a), (key_b, b) in combinations(groups.items(), 2):
        for metric in METRICS:
            values_a = finite_values([(r.metrics or {}).get(metric) for r in a])
            values_b = finite_values([(r.metrics or {}).get(metric) for r in b])
            if not values_a or not values_b:
                continue
            result.append({'a': dict(zip(('approach', 'model', 'backend'), key_a)),
                           'b': dict(zip(('approach', 'model', 'backend'), key_b)),
                           'metric': metric, 'unit': 'individual_measurement',
                           **compare_values(values_a, values_b)})
    # Holm adjustment within each metric across the requested group comparisons.
    for metric in METRICS:
        family = [item for item in result if item['metric'] == metric]
        for source, target in [('p_value', 'p_value_adjusted'), ('welch_p', 'welch_p_adjusted'),
                               ('variance_p', 'variance_p_adjusted')]:
            adjust_holm(family, source, target)
    return result


def adjust_holm(items, source, target):
    tested = sorted((item for item in items if item.get(source) is not None), key=lambda item: item[source])
    previous = 0.0
    for i, item in enumerate(tested):
        previous = max(previous, min(1.0, item[source] * (len(tested)-i)))
        item[target] = previous


STATISTICS_NOTE = ('Summaries and comparisons use individual successful measurements, grouped by model and backend. '
                   'Mann-Whitney assumes independent observations; '
                   'matched inputs, environments and randomized order are not verified automatically. '
                   'Negative Cliff delta means A has smaller values than B; p is two-sided, Holm adjustment per metric. '
                   'P-values require at least two observations per group. CI: percentile bootstrap, 2000 resamples, seed 0. '
                   'Welch compares independent means; median-centered Levene compares variances. '
                   'Outliers use 1.5 IQR fences and are retained. Shapiro p>=0.05 does not prove normality. '
                   'Ratios require a positive denominator; CV requires a positive mean; gmean/hmean require all-positive values.')
