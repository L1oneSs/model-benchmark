// Real USE/WASM validation. Isolated browser, local weights, temporary DB records.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve, join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const smoke=process.argv.includes('--smoke');
const warmup=smoke?1:Number(process.argv.find(arg=>arg.startsWith('--warmup='))?.split('=')[1]||20);
assert(Number.isInteger(warmup)&&warmup>=1&&warmup<=100,'warmup must be 1..100');
const runId=new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8);
const out=join(root,'artifacts','stand-validation',runId);
await mkdir(out,{recursive:true});
const docker=(args)=>execFileSync('docker',['compose',...args],{cwd:root,encoding:'utf8',windowsHide:true});
const port=service=>docker(['port',service,service==='frontend'?'80':'8000']).trim().split('\n')[0].split(':').at(-1);
const api=`http://localhost:${port('backend')}`;
const ui=`http://localhost:${port('frontend')}`;
const services=docker(['ps','--format','json']).trim().split('\n').filter(Boolean).map(JSON.parse);
for(const name of ['frontend','backend','database','llm'])assert(services.some(s=>s.Service===name&&s.State==='running'),name+' not running');
const health=await(await fetch(api+'/api/health')).json();
assert.equal(health.database,'ok');assert((await fetch(ui)).ok);
const modelDir=join(root,'frontend','public','models','model-b');
const manifest=JSON.parse(await readFile(join(modelDir,'model.json'),'utf8'));
const hashes={};
for(const name of ['model.json','vocab.json',...manifest.weightsManifest.flatMap(item=>item.paths)])
  hashes[name]=createHash('sha256').update(await readFile(join(modelDir,name))).digest('hex');
const browser=process.env.CHROME_BIN||[
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome','/usr/bin/chromium',
].find(existsSync);
assert(browser,'Set CHROME_BIN to a Chromium executable');
process.env.VITE_MODEL_SOURCE='local';
const {createServer}=await import('../frontend/node_modules/vite/dist/node/index.js');
const validationAssets=(req,res,next)=>{
  if(req.url==='/__validation.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Stand validation</title><h1>Stand validation</h1>');return;}
  const match=req.url?.match(/^\/wasm\/([a-zA-Z0-9._-]+\.wasm)$/);
  if(match){const file=join(root,'frontend','node_modules','@tensorflow','tfjs-backend-wasm','dist',basename(match[1]));if(existsSync(file)){res.setHeader('Content-Type','application/wasm');createReadStream(file).pipe(res);return;}}
  next();
};
const vite=await createServer({root:join(root,'frontend'),server:{host:'127.0.0.1',port:0},logLevel:'error',
  plugins:[{name:'stand-validation-assets',configureServer(server){server.middlewares.use(validationAssets);}}]});
await vite.listen();
const vitePort=vite.httpServer.address().port;
const profileDir=join(out,'chrome-profile');
const child=spawn(browser,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking',
  '--remote-debugging-port=0',`--user-data-dir=${profileDir}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,loaded=false,seq=0;const pending=new Map();
let validationKey;
async function waitFor(fn){for(let i=0;i<300;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error('Validation timeout');}
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'));},180000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
  const active=await waitFor(async()=>{try{return await readFile(join(profileDir,'DevToolsActivePort'),'utf8');}catch{return null;}});
  const cdpPort=active.split('\n')[0];
  const pages=await(await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Page.loadEventFired')loaded=true;if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
  await call('Page.enable');await call('Runtime.enable');
  await call('Page.navigate',{url:`http://127.0.0.1:${vitePort}/__validation.html`});await waitFor(()=>loaded);
  await call('Network.enable');
  await call('Network.setBlockedURLs',{urls:['https://*']});
  // Imports and model loading happen before the ten measurements.
  await evaluate(`(async()=>{window.__runner=await import('/src/benchmark/runner.ts');const {EXPERIMENTS}=await import('/src/benchmark/experiments.ts');window.__experiment=EXPERIMENTS.find(x=>x.key==='text_classification');window.__options={...__runner.DEFAULT_OPTIONS,allBackends:false,selectedBackends:['wasm'],includeGeminiNano:false,discardFirst:false,repeats:${warmup}};window.__input={kind:'text',text:__experiment.defaultText};window.__warmup=await __runner.runExperiment(__experiment,__input,__options);})()`);
  const records=await evaluate(`__runner.runExperiment(__experiment,__input,{...__options,repeats:${smoke?1:10}})`);
  assert.equal(records.length,smoke?1:10,'Expected measurements; check WASM availability and assets');
  for(const r of records){assert.equal(r.status,'ok',JSON.stringify(r));assert.equal(r.settings.backend,'wasm');assert.equal(r.settings.model_source,'local');assert(Number.isFinite(r.metrics.inference_ms));}
  let cpuProfile=null,nodeCpu=null;
  if(!smoke){
    await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval:1000});await call('Profiler.start');
    const cpuStart=process.cpuUsage(),wallStart=performance.now();
    const diagnostic=await evaluate(`__runner.runExperiment(__experiment,__input,{...__options,repeats:10})`);
    const cpu=process.cpuUsage(cpuStart);nodeCpu=(cpu.user+cpu.system)/(performance.now()-wallStart)/10;
    cpuProfile=(await call('Profiler.stop')).profile;
    assert(diagnostic.every(r=>r.status==='ok'));
    await writeFile(join(out,'cpu-profile.json'),JSON.stringify(cpuProfile));
  }
  validationKey='stand-validation-'+randomUUID();
  const savedResponse=await fetch(api+'/api/measurements',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({runs:records.map(r=>({...r,experiment_key:validationKey,metadata:{...r.metadata,validation:true,original_experiment_key:'text_classification'}}))})});
  assert.equal(savedResponse.status,201,await savedResponse.clone().text());
  const saved=await savedResponse.json();assert.equal(saved.length,records.length);
  assert(saved.every(r=>r.metadata.data.sha256===records[0].metadata.data.sha256));
  const exported=await fetch(api+'/api/measurements/export.csv?experiment_key='+validationKey);assert(exported.ok);
  await writeFile(join(out,'measurements.csv'),Buffer.from(await exported.arrayBuffer()));
  const run={run_id:runId,mode:smoke?'smoke':'experiment',experiment:'text_classification',configuration:'USE / TensorFlow.js / WASM',
    text:records[0].metadata.data.text,model_source:'local',weights_sha256:hashes,warmup_calls:warmup,seed:42,
    services:services.map(s=>({service:s.Service,state:s.State,health:s.Health})),health,
    records,node_harness_cpu_percent_one_core:nodeCpu,
    notes:['CPU profile is a separate ten-call diagnostic, excluded from A/A times.','Isolated headless Chrome and Vite, local weights; Chrome built-in API is not tested.','Temporary database records are deleted after checking storage/export.']};
  await writeFile(join(out,'run.json'),JSON.stringify(run,null,2));
  console.log('RAW_RESULTS='+out);
  if(smoke)console.log('SMOKE_OK: 4 services running, HTTP/API/DB available, real USE/WASM inference and metrics storage/export verified.');
  else{
    const analysis=docker(['run','--rm','--no-deps','-e','PYTHONPATH=/srv','-v',`${out}:/validation`,
      '-v',`${join(root,'checks')}:/checks:ro`,'backend','python','/checks/analyze-stand-validation.py','/validation']);
    console.log(analysis.trim());
    const checks=JSON.parse(analysis);
    if(!checks.aa.no_difference_detected||!checks.stability.no_trend_detected||!checks.cpu.below_80_percent){
      console.error('VALIDATION_WARNING: an A/A, trend or driver-load check did not pass; inspect analysis.json.');
      process.exitCode=2;
    }
  }
}finally{
  if(validationKey){
    const code="import sys; from sqlalchemy import delete; from app.db.database import SessionLocal; from app.db.models import Measurement; s=SessionLocal(); s.execute(delete(Measurement).where(Measurement.experiment_key==sys.argv[1])); s.commit(); s.close()";
    docker(['exec','-T','backend','python','-c',code,validationKey]);
  }
  if(socket){await call('Browser.close').catch(()=>{});socket.close();}
  if(child.exitCode===null)child.kill();
  await vite.close();
}
