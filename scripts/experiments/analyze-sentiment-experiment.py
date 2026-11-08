"""Analyze the actual randomized pilot; paired rounds are the timing units."""
import csv
import itertools
import json
from pathlib import Path
import shutil
import sys

import numpy as np
from scipy import stats
import matplotlib
matplotlib.use('Agg')
from matplotlib import pyplot as plt

source, destination = map(Path, sys.argv[1:3])
destination.mkdir(parents=True, exist_ok=True)
manifest = json.loads((source/'manifest.json').read_text(encoding='utf-8'))
rows = json.loads((source/'measurements.json').read_text(encoding='utf-8'))
assert (source/'complete.json').exists(), 'Incomplete experiment'
assert len(rows) == manifest['planned_measurements']
for name in ['manifest.json', 'measurements.json', 'complete.json', 'probe.json']:
    shutil.copy2(source/name, destination/name)

def label(row):
    answer = row.get('metadata', {}).get('adapter_metadata', {}).get('output_raw') or row.get('metadata', {}).get('output_raw') or row.get('output_summary', '')
    answer = answer.lower().replace('тональность', '').strip().strip('.! ')
    return {'позитивная':'positive', 'негативная':'negative'}.get(answer, answer)

def export(name, records):
    with (destination/name).open('w', encoding='utf-8-sig', newline='') as f:
        writer=csv.DictWriter(f, fieldnames=list(records[0]), delimiter=';')
        writer.writeheader(); writer.writerows(records)

export('measurements.csv', [{**r['pilot'], 'status':r['status'], **r['metrics'],
    'correct':label(r)==r['pilot']['expected'], 'output':r.get('output_summary'),
    'settings':json.dumps(r['settings'],ensure_ascii=False),
    'environment':json.dumps(r['environment'],ensure_ascii=False),
    'metadata':json.dumps(r['metadata'],ensure_ascii=False)} for r in rows])
variants=list(dict.fromkeys(r['pilot']['variant'] for r in rows))
metrics=['inference_ms','load_ms','first_token_ms','total_ms','memory_mb']
series={}; summary=[]
for length in ['short','long']:
    for variant in variants:
        group=[r for r in rows if r['pilot']['length']==length and r['pilot']['variant']==variant]
        for metric in metrics:
            values=[]
            for round_id in range(1,6):
                pair=[r for r in group if r['pilot']['round']==round_id]
                valid=[r['metrics'].get(metric) for r in pair if r['status']=='ok']
                if len(valid)==2 and all(isinstance(v,(float,int)) and np.isfinite(v) for v in valid):
                    values.append(float(np.mean(valid)))
            series[(length,variant,metric)]=values
            if values:
                ci=stats.bootstrap((np.array(values),),np.mean,method='percentile',n_resamples=10000,random_state=42).confidence_interval
                summary.append(dict(length=length,variant=variant,metric=metric,n_rounds=len(values),
                    data_origin=group[0].get('metadata',{}).get('data_origin','measured'),
                    mean=float(np.mean(values)),min=float(min(values)),max=float(max(values)),
                    sd=float(np.std(values,ddof=1)),ci_low=float(ci.low),ci_high=float(ci.high),
                    correct=sum(label(r)==r['pilot']['expected'] and r['status']=='ok' for r in group),total=len(group)))
comparisons=[]
for length in ['short','long']:
    for a,b in itertools.combinations(variants,2):
        x=np.array(series[length,a,'inference_ms']); y=np.array(series[length,b,'inference_ms'])
        if len(x)!=5 or len(y)!=5: continue
        differences=x-y
        # Enumerate all 32 sign assignments for five matched randomized rounds.
        null=np.array([np.mean(differences*np.array(signs)) for signs in itertools.product([-1,1],repeat=5)])
        p=float(np.mean(np.abs(null)>=abs(np.mean(differences))-1e-12))
        delta=float(np.sign(x[:,None]-y[None,:]).mean())
        indices=np.random.default_rng(42).integers(0,5,(10000,5))
        ratios=np.mean(x[indices],axis=1)/np.mean(y[indices],axis=1)
        lo,hi=np.quantile(ratios,[.025,.975])
        comparisons.append(dict(length=length,a=a,b=b,ratio=float(x.mean()/y.mean()),
            data_origin='includes_simulated' if 'gemini_nano' in [a,b] and manifest.get('illustrative_measurements') else 'measured',
            faster_a_percent=float((1-x.mean()/y.mean())*100),ratio_ci_low=float(lo),ratio_ci_high=float(hi),
            cliffs_delta=delta,p_value=p,p_holm=1.0))
# One correction family includes all requested inference comparisons, both lengths.
previous=0.
for i,c in enumerate(sorted(comparisons,key=lambda c:c['p_value'])):
    previous=max(previous,min(1.,c['p_value']*(len(comparisons)-i)));c['p_holm']=previous
export('summary.csv', summary)
if comparisons: export('comparisons.csv', comparisons)
(destination/'analysis.json').write_text(json.dumps({'summary':summary,'comparisons':comparisons},indent=2),encoding='utf-8')
plt.rcParams['svg.hashsalt']='sentiment-pilot'
names={'cpu':'CPU','wasm':'WASM','webgl':'WebGL','webgpu':'WebGPU','gemini_nano':'Prompt API*' if manifest.get('illustrative_measurements') else 'Prompt API'}
for metric, title in [('inference_ms','Время обработки, мс'),('load_ms','Подготовка модели, мс'),('first_token_ms','До первого предсказания, мс'),('total_ms','Полное время вызова, мс'),('memory_mb','Изменение JS-кучи, МБ')]:
    fig, axes=plt.subplots(1,2,figsize=(11,4),dpi=160)
    for ax,length in zip(axes,['short','long']):
        for index,variant in enumerate(variants):
            values=series[length,variant,metric]
            if values:
                ax.scatter(np.full(len(values),index),values,s=22,alpha=.7)
                ax.plot([index-.2,index+.2],[np.mean(values)]*2,color='black',linewidth=2)
        ax.set_xticks(range(len(variants)),[names[v] for v in variants],rotation=25)
        ax.set_title('Короткие тексты' if length=='short' else 'Длинные тексты')
        ax.set_ylabel(title);ax.grid(axis='y',alpha=.25)
        shown=[v for variant in variants for v in series[length,variant,metric]]
        if metric in ['inference_ms','total_ms','first_token_ms'] and shown and min(shown)>0 and max(shown)/min(shown)>50:
            ax.set_yscale('log');ax.set_ylabel(title+' (лог. шкала)')
    fig.suptitle('Средние значения за круг: точки - пять кругов, черта - среднее')
    if manifest.get('illustrative_measurements'):
        fig.text(.5,.005,'* Prompt API: смоделированные данные; CPU, WASM, WebGL, WebGPU: реальные измерения.',ha='center',fontsize=8)
    fig.tight_layout();fig.savefig(destination/f'{metric}.png');fig.savefig(destination/f'{metric}.svg',metadata={'Date':None});plt.close(fig)
print(json.dumps({'summary':summary,'comparisons':comparisons}))
