"""Analyze the actual observations of checks/validate-stand.mjs."""
import json
from pathlib import Path
import sys
import numpy as np
from scipy import stats
from app.experiment_statistics import compare_values, describe

directory=Path(sys.argv[1])
run=json.loads((directory/'run.json').read_text())
values=np.array([r['metrics']['inference_ms'] for r in run['records']])
indices=np.random.default_rng(run['seed']).permutation(len(values))
a,b=indices[:5],indices[5:]
comparison=compare_values(values[a].tolist(),values[b].tolist())
trend=stats.spearmanr(np.arange(1,len(values)+1),values) if np.ptp(values)>0 else (0.,1.)
trend_p=1.
if np.ptp(values)>0:
    # Ten observations: use permutations rather than the large-sample p approximation.
    ranks=stats.rankdata(values); ranks-=np.mean(ranks)
    order=np.arange(len(values),dtype=float); order-=np.mean(order)
    denominator=np.linalg.norm(ranks)*np.linalg.norm(order)
    def correlation(sample, axis=-1):
        return np.sum(sample*order,axis=axis)/denominator
    trend_p=float(stats.permutation_test((ranks,),correlation,permutation_type='pairings',
                  vectorized=True,n_resamples=9999,random_state=run['seed']).pvalue)
profile=json.loads((directory/'cpu-profile.json').read_text())
nodes={n['id']:n for n in profile['nodes']}
parents={child:n['id'] for n in profile['nodes'] for child in n.get('children',[])}
def category(node_id):
    while node_id in nodes:
        frame=nodes[node_id]['callFrame']
        name,url=frame['functionName'],frame.get('url','')
        if name=='(idle)': return 'idle'
        if '/src/models/' in url or '/node_modules/' in url or '.wasm' in url: return 'sut'
        if '/src/benchmark/' in url: return 'driver'
        node_id=parents.get(node_id)
    return 'unknown'
duration={'idle':0,'sut':0,'driver':0,'unknown':0}
for node_id,delta in zip(profile.get('samples',[]),profile.get('timeDeltas',[])):
    duration[category(node_id)]+=delta
total=sum(duration.values()) or 1
bound=100*(duration['driver']+duration['unknown'])/total
node_cpu=run['node_harness_cpu_percent_one_core']
result={'configuration':run['configuration'],'text':run['text'],'n':len(values),
        'times_ms':values.tolist(),'summary':describe(values.tolist()),
        'cv_percent':float(np.std(values,ddof=1)/np.mean(values)*100),
        'aa':{'group_a_indices':(a+1).tolist(),'group_b_indices':(b+1).tolist(),**comparison,
              'no_difference_detected':comparison['p_value']>=.05},
        'stability':{'spearman_rho':float(trend[0]),'p_value':trend_p,
                     'p_value_asymptotic':float(trend[1]),'method':'two-sided permutation, 9999 resamples, seed 42',
                     'no_trend_detected':trend_p>=.05},
        'cpu':{'profile_microseconds':duration,'browser_driver_upper_bound_percent':bound,
               'node_harness_percent_one_core':node_cpu,'sum_upper_bound_percent':bound+node_cpu,
               'below_80_percent':bound+node_cpu<80,
               'scope':'Main-thread sampled time of driver and all unattributed work plus Node CPU/core. SUT and idle separately classified; not Docker CPU.'}}
(directory/'analysis.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
# Scientific figure from the original observation order, not the shuffled A/A groups.
import matplotlib
matplotlib.use('Agg')
from matplotlib import pyplot as plt
plt.rcParams['svg.hashsalt']='stand-validation'
figure,axis=plt.subplots(figsize=(8,3),dpi=150)
axis.plot(np.arange(1,len(values)+1),values,marker='o',color='#2563eb')
axis.set(xlabel='Порядковый номер прогона',ylabel='Время обработки, мс',title='Определение тональности: USE / WASM')
axis.set_xticks(np.arange(1,len(values)+1));axis.grid(alpha=.25)
figure.tight_layout()
figure.savefig(directory/'latency.svg',metadata={'Date':None})
figure.savefig(directory/'latency.png')
plt.close(figure)
print(json.dumps(result,ensure_ascii=True))
