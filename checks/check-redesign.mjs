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
const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
async function wait(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(100);}throw Error('Not ready: '+expression);}
const clickExpression=async expression=>{const box=await evaluate(`(()=>{const e=${expression};if(!e)throw Error('Control not found');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box});};
const click=async text=>clickExpression(`Array.from(document.querySelectorAll('button,[role="tab"],[role="menuitemradio"]')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`);
async function screenshot(name){await pause(250);const r=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(out,name+'.png'),Buffer.from(r.data,'base64'));}
const url=process.env.UI_URL||'http://localhost:18080';
try{
 await call('Runtime.enable');await call('Page.enable');
 await call('Page.addScriptToEvaluateOnNewDocument',{source:`
 if(!localStorage.getItem('benchmark-theme'))localStorage.setItem('benchmark-theme','light');
 const originalFetch=window.fetch;
 window.fetch=(input,init)=>String(input).endsWith('/api/agent/history')
   ?Promise.resolve(Response.json({turns:window.fixtureTurns||(window.uiChartFixture?[{question:'Проверка графика',answer:'Сравнение памяти по вариантам.',thinking:'',sources:[],model:'UI fixture',charts:[window.uiChartFixture]}]:[]),limit:30}))
   :originalFetch(input,init);
 `});
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url});await wait(`!!document.querySelector('.panel')`);
 await screenshot('stand-light');
 await clickExpression(`document.querySelector('[aria-label="Выбрать тему"]')`);await wait(`!!document.querySelector('[role="menuitemradio"]')`);await click('Тёмная');await wait(`document.documentElement.classList.contains('dark')`);
 await screenshot('stand-dark');
 await call('Page.reload');await wait(`!!document.querySelector('.panel')`);assert.equal(await evaluate(`document.documentElement.classList.contains('dark')`),true,'Theme not persisted');
 await clickExpression(`document.querySelector('[aria-label="Выбрать тему"]')`);await wait(`!!document.querySelector('[role="menuitemradio"]')`);await click('Как в системе');
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});await wait(`!document.documentElement.classList.contains('dark')`);
 await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await wait(`document.documentElement.classList.contains('dark')`);
 await click('Измерения');await wait(`!!document.querySelector('.results__table tbody tr')`);
 await click('Графики');await wait(`document.querySelectorAll('[role="dialog"] .echart svg').length>0`);
 assert.equal(await evaluate(`document.querySelector('[role="dialog"]').getBoundingClientRect().width<=innerWidth`),true);
 await screenshot('charts-dark');
 for(const kind of ['line','scatter','histogram','box','bar']){
  await evaluate(`(()=>{const e=document.querySelector('[aria-label="Вид графика"]');e.value=${JSON.stringify(kind)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(150);
  assert(await evaluate(`document.querySelector('[role="dialog"] .echart svg')?.querySelectorAll('path,rect').length>0`),'Chart failed: '+kind);
 }
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});await wait(`!document.querySelector('[role="dialog"]')`);
 await click('Дополнительная статистика');await wait(`!!document.querySelector('[role="dialog"] table')`);await click('×');await wait(`!document.querySelector('[role="dialog"]')`);
 await click('Рекомендации');await wait(`!!document.querySelector('.recommendations tbody tr')`);await screenshot('recommendations-dark');
 await evaluate(`(()=>{const field=document.querySelector('[aria-label="Поиск по рекомендациям"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'not-a-matching-criterion-987');field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await wait(`document.body.textContent.includes('По этому запросу ничего не найдено')`);
 // Replay typed history locally: no model inference or writes to the user's chat.
 await evaluate(`window.uiChartFixture={kind:'line',title:'Проверка графика агента',metric:'memory_mb',unit:'МБ',points:[{label:'<img src=x onerror=alert(1)>',value:-2,samples:5},{label:'WASM',value:3,samples:5}]}`);
 await click('Агент');await wait(`!!document.querySelector('.rag__form')`);
 await click('Thinking: выключен');await wait(`!!document.querySelector('.rag__composer-actions button[aria-pressed=true]')`);
 assert(await evaluate(`!!document.querySelector('.rag__form .rag__delete')`));
 await wait(`!!document.querySelector('.agent-chart .echart svg')`);
 assert.equal(await evaluate(`document.querySelectorAll('.agent-chart img').length`),0);
 await screenshot('agent-dark');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await screenshot('agent-mobile');assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'Mobile overflow');
  await click('Рекомендации');
  const markdown = '**Ключевые выводы:**\n\n* **WebGPU** - быстрый инференс.\n* Второй пункт\n\n| Модель | Инференс |\n| --- | --- |\n| TF.js | 75 мс |\n\n```python\nprint("result")\n```\n\n[Документация](https://example.com)\n\n[unsafe](javascript:alert%281%29)\n\n<script>window.__markdownExecuted = true</script>';
  await evaluate(`window.fixtureTurns = [{question:'Покажи результаты',answer:${JSON.stringify(markdown)},thinking:'**Рассуждение**',sources:[],model:'fixture'}]`);
  await click('Агент');
  await wait(`document.querySelector('.rag__markdown strong')?.textContent === 'Рассуждение'`);
  assert.equal(await evaluate(`document.querySelector('.rag__answer > .rag__markdown strong').textContent`), 'Ключевые выводы:');
  assert.equal(await evaluate(`document.querySelectorAll('.rag__answer > .rag__markdown ul li').length`), 2);
  assert.equal(await evaluate(`document.querySelectorAll('.rag__markdown table tbody tr').length`), 1);
  assert.equal(await evaluate(`document.querySelector('.rag__markdown pre code').textContent.trim()`), 'print("result")');
  assert.equal(await evaluate(`!!document.querySelector('.rag__markdown a[href^="javascript:"]')`), false);
  assert.equal(await evaluate(`!!document.querySelector('.rag__markdown script') || !!window.__markdownExecuted`), false);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Markdown has horizontal overflow');
  await screenshot('agent-markdown-mobile');
  if (process.env.CHART_FIXTURE_FILE) {
    const charts = JSON.parse(await readFile(process.env.CHART_FIXTURE_FILE, 'utf8'));
    await click('Рекомендации');
    await evaluate(`window.fixtureTurns = [{question:'Графики в трёх форматах',answer:'Результаты',thinking:'',sources:[],model:'fixture',charts:${JSON.stringify(charts)}}]`);
    await click('Агент');
    await wait(`document.querySelector('.agent-chart img')?.naturalWidth > 0`);
    assert.equal(await evaluate(`document.querySelector('.agent-chart iframe').getAttribute('sandbox')`), 'allow-scripts');
    assert.equal(await evaluate(`document.querySelectorAll('.agent-chart').length`), 3);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const interactive = charts.find(chart => chart.renderer === 'python_interactive');
    let plotReady = false;
    for (let attempt = 0; attempt < 40 && !plotReady; attempt++) {
      const targets = await call('Target.getTargets');
      const frame = targets.targetInfos.find(item => item.type === 'iframe' && item.url.endsWith(interactive.artifact_url));
      if (frame) {
        const attached = await call('Target.attachToTarget', { targetId: frame.targetId, flatten: true });
        const result = await call('Runtime.evaluate', { expression: `!!document.querySelector('.plotly-graph-div')?.data?.length`, returnByValue: true }, attached.sessionId);
        plotReady = result.result.value === true;
        await call('Target.detachFromTarget', { sessionId: attached.sessionId });
      }
      if (!plotReady) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(plotReady, true, 'Interactive Python chart did not execute Plotly inside sandbox');
    await evaluate(`document.querySelector('.agent-chart iframe').scrollIntoView({block:'center'})`);
    await screenshot('agent-python-mobile');
  }
  await click('Рекомендации');
  await evaluate(`window.fixtureTurns = Array.from({length:30}, () => ({question:'Тестовый вопрос',answer:'Тестовый ответ',thinking:'',sources:[],model:'fixture'}))`);
  await click('Агент');
  await wait(`document.body.textContent.includes('Достигнут лимит истории')`);
  assert.equal(await evaluate(`document.querySelector('.rag__send').disabled`), true);

 await click('Измерения');await wait(`!!document.querySelector('.results')`);await screenshot('measurements-mobile');assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'Measurements overflow');
 assert.deepEqual(errors,[]);console.log('UI OK: themes/persistence, navigation, five chart kinds, agent ECharts, escaping, Markdown safety, history limit, search, thinking, optional Python charts, dialogs and mobile layout');
}finally{await call('Browser.close').catch(()=>{});ws.close();if(browser.exitCode===null)browser.kill();}
