// Read-only UI integration check, including chart data received from the real API.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const out=resolve('artifacts/redesign');await mkdir(out,{recursive:true});
const profile=join(out,'chrome-'+Date.now());
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',windowsHide:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let active;for(let i=0;i<100;i++){try{active=await readFile(join(profile,'DevToolsActivePort'),'utf8');break;}catch{await pause(100);}}
const port=active.split('\n')[0];const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let seq=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
async function wait(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Not ready: '+expression);}
const clickExpression=async expression=>{const box=await evaluate(`(()=>{const e=${expression};if(!e)throw Error('Control not found');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box});};
const click=async text=>clickExpression(`Array.from(document.querySelectorAll('button,[role="tab"],[role="menuitemradio"]')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`);
async function screenshot(name){await pause(250);const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(out,name+'.png'),Buffer.from(r.data,'base64'));}
const url=process.env.UI_URL||'http://localhost:18080';
try {
 await call('Runtime.enable');await call('Page.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:url+'/#measurements'});
 await wait(`!!document.querySelector('.results__table')`);
 await click('Дополнительная статистика');
 await wait(`!!document.querySelector('[role="dialog"] .stats-kpis')`);
 await screenshot('statistics-overview');
 await click('Распределение');await wait(`!!document.querySelector('[role="dialog"] .echart svg')`);
 assert(await evaluate(`document.querySelector('[role="tabpanel"][data-state="active"]').textContent.includes('Асимметрия')`));
 await screenshot('statistics-distribution');
 await click('Сравнения');await wait(`!!document.querySelector('.stats-comparison-matrix [data-comparison]')`);
 assert(await evaluate(`document.querySelector('.stats-comparison-matrix').getBoundingClientRect().height>0`));
 const mirrored=await evaluate(`(()=>{const rows=document.querySelectorAll('.stats-comparison-matrix tbody tr');const value=(row,col)=>Number(rows[row].querySelectorAll('td')[col].querySelector('.stats-comparison-card__effect b').textContent.replace(',','.'));return [value(0,1),value(1,0)];})()`);
 assert(Math.abs(mirrored[0]+mirrored[1])<.0001,'Reverse pair must flip delta');
 await screenshot('statistics-comparison-matrix');
 await click('Тепловые карты');await wait(`!!document.querySelector('.stats-heatmap svg')`);
 for(const mode of ['p_value_adjusted','median_ratio','median_change_percent','hedges_g','wasserstein','probability_a_lower','cliffs_delta']) {
  await evaluate(`(()=>{const e=document.querySelector('.stats-select select');e.value=${JSON.stringify(mode)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(180);
  assert(await evaluate(`document.querySelector('.stats-heatmap svg')?.querySelectorAll('path,rect').length>10`),'Heatmap not rendered: '+mode);
 }
 await screenshot('statistics-heatmap');
 await click('Связи и стабильность');await wait(`!!document.querySelector('.stats-heatmap svg')`);await screenshot('statistics-correlations');
 await evaluate(`(()=>{const e=document.querySelector('[aria-label="Метрика статистики"]');e.value='memory_mb';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(250);
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await screenshot('statistics-mobile');
 assert(await evaluate(`document.querySelector('[role="dialog"]').getBoundingClientRect().width<=innerWidth`));
 assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
 await click('Обзор');await pause(100);
 assert(await evaluate(`document.querySelector('[role="tabpanel"][data-state="active"]').textContent.includes('Основные показатели')`));
 await click('×');await wait(`!document.querySelector('[role="dialog"]')`);
 // Replay a valid empty selection to verify that charts never invent missing data.
 await evaluate(`window.fetchOriginal=window.fetch;window.fetch=(input,init)=>String(input).includes('/api/measurements/statistics?')?Promise.resolve(Response.json({groups:[],comparisons:[],diagnostics:[],omnibus:[],window:30,measurement_ids:[]})):window.fetchOriginal(input,init)`);
 await click('Дополнительная статистика');await wait(`!!document.querySelector('.stats-kpis')`);
 await click('Тепловые карты');assert(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('хотя бы двух вариантов')`));
 await click('Связи и стабильность');assert(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes('Нет данных')`));
 await click('×');
 assert.deepEqual(errors,[]);
 console.log('Extended statistics UI OK: 5 tabs, 7 heatmaps, ECDF, correlations, memory, mobile and empty selection.');
} finally {await call('Browser.close').catch(()=>{});ws.close();if(browser.exitCode===null)browser.kill();}
