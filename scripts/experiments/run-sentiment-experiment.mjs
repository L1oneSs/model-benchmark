// Execute the randomized pilot plan from task-3, section 5.4, using real adapters.
import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createReadStream,existsSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const root=process.cwd(), runId=new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8);
const out=join(root,'artifacts','sentiment-experiment',runId);
await mkdir(out,{recursive:true});
const texts=[
 {id:'short-positive',length:'short',expected:'positive',text:'I love this application. It is fast, easy to use, and consistently gives me helpful results.'},
 {id:'short-negative',length:'short',expected:'negative',text:'I hate this application. It is slow, difficult to use, and consistently gives me useless results.'},
 {id:'long-positive',length:'long',expected:'positive',text:'I have used this application every day for the past month, and I am very happy with it. The interface is clear, the pages load quickly, and every important feature is easy to find. The results are useful and accurate, which saves me time at work. I especially appreciate the reliable performance and the helpful instructions. Even when I enter a longer text, the application responds smoothly. The whole experience has been pleasant, and I would gladly recommend this excellent product to my friends and colleagues.'},
 {id:'long-negative',length:'long',expected:'negative',text:'I have used this application every day for the past month, and I am very unhappy with it. The interface is confusing, the pages load slowly, and every important feature is difficult to find. The results are useless and inaccurate, which wastes my time at work. I especially dislike the unreliable performance and the unhelpful instructions. Even when I enter a simple text, the application responds poorly. The whole experience has been frustrating, and I would never recommend this terrible product to my friends and colleagues.'},
].map(t=>({...t,words:t.text.split(/\s+/).length,sha256:createHash('sha256').update(t.text).digest('hex')}));
for(const t of texts)if(t.words<(t.length==='short'?10:80)||t.words>(t.length==='short'?30:150))throw Error('Invalid length');
let seed=42;
const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
const shuffle=items=>{const a=[...items];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
process.env.VITE_MODEL_SOURCE='local';
const {createServer}=await import('../../frontend/node_modules/vite/dist/node/index.js');
const vite=await createServer({root:join(root,'frontend'),server:{host:'127.0.0.1',port:0},logLevel:'error',plugins:[{name:'pilot-assets',configureServer(server){server.middlewares.use((req,res,next)=>{
 if(req.url==='/__experiment.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Sentiment experiment</title><h1>Sentiment experiment in progress</h1><p>Please keep this window active.</p>');return;}
 const m=req.url?.match(/^\/wasm\/([\w.-]+\.wasm)$/);if(m){const f=join(root,'frontend/node_modules/@tensorflow/tfjs-backend-wasm/dist',basename(m[1]));if(existsSync(f)){res.setHeader('Content-Type','application/wasm');createReadStream(f).pipe(res);return;}}next();
 });}}]});
await vite.listen();
const chrome=process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const modelArgs=process.env.CHROME_MODEL_DIR?[`--optimization-guide-ondevice-model-execution-override=${process.env.CHROME_MODEL_DIR}`]:[];
const headless=process.argv.includes('--headless');
const child=spawn(chrome,[...(headless?['--headless=new','--enable-gpu']:[]),'--no-first-run','--remote-debugging-port=0',...modelArgs,`--user-data-dir=${join(out,'chrome-profile')}`,`http://127.0.0.1:${vite.httpServer.address().port}/__experiment.html`],{stdio:'ignore',windowsHide:headless});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let socket,seq=0;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout '+method));},300000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
try{
 let active;for(let i=0;i<100;i++){try{active=await readFile(join(out,'chrome-profile/DevToolsActivePort'),'utf8');break;}catch{await wait(100);}}
 if(!active)throw Error('Chrome did not start');
 const pages=await(await fetch(`http://127.0.0.1:${active.split('\n')[0]}/json/list`)).json();
 socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
 socket.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 socket.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Experiment Chrome disconnected'));}pending.clear();};
 await call('Page.enable');
 const browserWindow=await call('Browser.getWindowForTarget');
 await call('Browser.setWindowBounds',{windowId:browserWindow.windowId,bounds:{windowState:'normal'}});
 const focus=async()=>{await call('Page.bringToFront');for(let i=0;i<100;i++){if(await evaluate(`document.visibilityState==='visible'`))return;await wait(100);}throw Error('Keep experiment window visible');};
 await focus();
 const probe=await evaluate(`(async()=>{window.runner=await import('/src/benchmark/runner.ts');window.tf=await import('/src/models/tensorflow.ts');window.nano=await import('/src/models/geminiNano.ts');window.exp=(await import('/src/benchmark/experiments.ts')).EXPERIMENTS.find(x=>x.key==='text_classification');return {backends:await tf.availableBackends(),nano:await nano.checkAvailability(),visible:document.visibilityState,user_agent:navigator.userAgent};})()`);
 console.log('PROBE '+JSON.stringify(probe));await writeFile(join(out,'probe.json'),JSON.stringify(probe,null,2));
 if(process.argv.includes('--probe-only')){console.log('OUTPUT '+out);process.exitCode=0;}
 else{
 if(!process.argv.includes('--skip-nano')&&(probe.nano==='downloadable'||probe.nano==='downloading')){
  console.log('PREPARING Nano model before measurements');
  try{probe.nano_preparation=await evaluate(`(async()=>{try{await nano.downloadModel();return {status:await nano.checkAvailability()};}catch(e){return {status:'unavailable',error:String(e)};}})()`);}catch(e){probe.nano_preparation={status:'unavailable',error:String(e)};}
  probe.nano=probe.nano_preparation.status;
  await writeFile(join(out,'probe.json'),JSON.stringify(probe,null,2));console.log('NANO '+JSON.stringify(probe.nano_preparation));
 }
 const variants=['cpu','wasm','webgl','webgpu'].filter(b=>probe.backends.includes(b));if(probe.nano==='available')variants.push('gemini_nano');
 const configs=variants.flatMap(variant=>['short','long'].map(length=>({variant,length})));
 const schedule=[];for(let round=1;round<=5;round++){const orders={short:shuffle(texts.filter(t=>t.length==='short')),long:shuffle(texts.filter(t=>t.length==='long'))};for(const c of shuffle(configs))schedule.push({...c,round,text_ids:orders[c.length].map(t=>t.id)});}
 const manifest={run_id:runId,seed:42,created_at:new Date().toISOString(),warmup_calls:20,pause_ms:1000,texts,probe,schedule,planned_measurements:configs.length*10,execution_mode:headless?'headless':'headed',notes:[`${headless?'Headless':'Headed'} isolated Chrome, real adapters via Vite, local USE weights.`,'Unavailable variants excluded before scheduling.','Twenty warmups before each series, fixed before measurements.']};
 await writeFile(join(out,'manifest.json'),JSON.stringify(manifest,null,2));
 const rows=[];
 for(const [index,s] of schedule.entries()){
  await focus();
  const options={repeats:1,discardFirst:false,allBackends:false,selectedBackends:s.variant==='gemini_nano'?[]:[s.variant],includeGeminiNano:s.variant==='gemini_nano',includeLibraryModel:s.variant!=='gemini_nano'};
  await evaluate(`window.opts={...runner.DEFAULT_OPTIONS,...${JSON.stringify(options)}}`);
  const first=texts.find(t=>t.id===s.text_ids[0]);
  const warm=await evaluate(`runner.runExperiment(exp,{kind:'text',text:${JSON.stringify(first.text)}},{...opts,repeats:20})`);
  if(warm.length!==20||warm.some(r=>r.status!=='ok'))throw Error('Warmup failed '+JSON.stringify(warm));
  for(const id of s.text_ids){const t=texts.find(t=>t.id===id);const r=await evaluate(`runner.runExperiment(exp,{kind:'text',text:${JSON.stringify(t.text)}},opts)`);if(r.length!==1)throw Error('Expected single measurement '+JSON.stringify(r));const pilot={experiment_id:runId,round:s.round,variant:s.variant,length:s.length,text_id:id,expected:t.expected,order:rows.length+1,warmup_calls:20,pause_ms:1000,schedule_seed:42};rows.push({...r[0],pilot,metadata:{...r[0].metadata,pilot_protocol:pilot}});await writeFile(join(out,'measurements.json'),JSON.stringify(rows,null,2));}
  console.log(`PROGRESS ${index+1}/${schedule.length} ${s.variant} ${s.length}`);await wait(1000);
 }
 await writeFile(join(out,'complete.json'),JSON.stringify({completed_at:new Date().toISOString(),count:rows.length}));
 console.log('OUTPUT '+out);
 }
}finally{if(socket){await call('Browser.close').catch(()=>{});socket.close();}if(child.exitCode===null)child.kill();await vite.close();}
