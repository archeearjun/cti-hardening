

export function createCtiProgressPanelV1(title, options) {
    options = options || {};
    const started = Date.now();
    const state = { phase:'Starting', detail:'', count:'', completed:null, total:null, outcome:'running', startedAt:new Date(started).toISOString() };
    let host, root, timer, finished = 0, phaseStarted = started, updated = started, minimized = false;
    const durations = {};
    const key = options.key || '__CTI_PROGRESS_PANEL__';
    const duration = ms => Math.floor(Math.max(0, ms) / 60000) + 'm ' + String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0') + 's';
    const snapshot = () => ({...state, elapsedMs:(finished || Date.now()) - started,
      phaseElapsedMs:(finished || Date.now()) - phaseStarted, phaseDurationsMs:{...durations,
        [state.phase]:(durations[state.phase] || 0) + (finished || Date.now()) - phaseStarted}});
    const dispose = () => { clearInterval(timer); if (host) host.remove(); };
    const draw = () => {
      if (!root) return;
      const node = id => root.getElementById(id);
      const end = finished || Date.now();
      node('clock').textContent = 'Elapsed ' + duration(end - started);
      node('phase').textContent = state.phase;
      node('detail').textContent = state.detail;
      node('count').textContent = state.count;
      node('activity').textContent = finished ? 'Finished in ' + duration(end - started) :
        'This step: ' + duration(end - phaseStarted) + (end - updated >= 30000 ? ' · Waiting for the next progress update' : '');
      node('close').hidden = !finished;
      node('pulse').hidden = !!finished;
      node('card').dataset.outcome = state.outcome;
      node('body').hidden = minimized;
      node('toggle').textContent = minimized ? 'Expand' : 'Minimize';
      node('toggle').setAttribute('aria-expanded', String(!minimized));
      const determinate = !finished && Number.isFinite(state.completed) && Number.isFinite(state.total) && state.total > 0;
      node('bar').hidden = !determinate;
      if (determinate) { node('bar').max = state.total; node('bar').value = Math.max(0, Math.min(state.total, state.completed)); }
      node('foot').textContent = finished ? (options.finishedNote || 'Capture completion is separate from content verification. Review the JSON for evidence gaps.') :
        'Elapsed time is shown; remaining time is not estimated.';
      const steps = options.stages || [];
      const current = steps.indexOf(state.phase);
      root.querySelectorAll('[data-step]').forEach((el, i) => {
        el.dataset.current = String(i === current && !finished);
        el.dataset.done = String(current > i || state.outcome === 'success');
      });
    };
    const safeDraw = () => { try { draw(); } catch (_) {} };
    const controller = {
      update(patch) {
        if (finished) return;
        if (patch.phase && patch.phase !== state.phase) {
          durations[state.phase] = (durations[state.phase] || 0) + Date.now() - phaseStarted;
          phaseStarted = Date.now();
          state.completed = state.total = null;
          state.count = '';
        }
        Object.assign(state, patch);
        updated = Date.now();
        safeDraw();
      },
      finish(outcome, detail, count) {
        if (finished) return;
        controller.update({outcome:outcome || 'review', detail:detail || '', count:count || state.count});
        finished = Date.now();
        minimized = false;
        clearInterval(timer);
        safeDraw();
      },
      snapshot, dispose,
      reveal() { minimized = false; safeDraw(); }
    };
    try {
      if (window[key] && typeof window[key].dispose === 'function') window[key].dispose();
      window[key] = controller;
      host = document.createElement('div');
      host.setAttribute('data-cti-progress', 'true');
      host.style.cssText = 'all:initial!important;position:fixed!important;right:18px!important;bottom:18px!important;z-index:2147483645!important;width:min(370px,calc(100vw - 36px))!important;display:block!important;';
      // Closed shadow + outside body: body text, links, question discovery and
      // body mutation observers cannot ingest the progress display as evidence.
      root = host.attachShadow({mode:'closed'});
      root.innerHTML = `<style>
        :host{color-scheme:light}*{box-sizing:border-box}[hidden]{display:none!important}
        #card{font:14px/1.45 system-ui,-apple-system,sans-serif;background:#fff;color:#172b4d;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 8px 36px #0f172a26;overflow:hidden}
        header{padding:14px 16px 10px;background:#f6f8fc;border-bottom:1px solid #e2e8f0}
        .row{display:flex;gap:10px;justify-content:space-between;align-items:center}#title{font-size:14px;font-weight:700}
        #clock{font-variant-numeric:tabular-nums;font-size:13px;color:#334155;white-space:nowrap}
        #body{padding:14px 16px}#phase{font-size:16px;font-weight:700;color:#1d4ed8}
        #detail{margin:8px 0;overflow-wrap:anywhere;max-height:100px;overflow:auto}
        #count{font-weight:600;margin:8px 0}#activity,#foot{font-size:12px;color:#64748b}
        #bar{width:100%;height:7px;accent-color:#2563eb;margin:5px 0}
        #steps{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0 0;font-size:11px}
        [data-step]{padding:3px 6px;border-radius:5px;color:#64748b;background:#eef2f6}
        [data-step][data-current=true]{background:#dbeafe;color:#1d4ed8;font-weight:700}
        [data-step][data-done=true]{background:#dcfce7;color:#166534}
        footer{display:flex;justify-content:flex-end;gap:8px;padding:8px 12px;border-top:1px solid #e2e8f0}
        button{font:inherit;font-size:12px;color:#334155;background:white;border:1px solid #cbd5e1;border-radius:6px;padding:5px 9px;cursor:pointer}
        button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
        #pulse{width:8px;height:8px;display:inline-block;border-radius:50%;background:#2563eb;margin-right:6px;animation:pulse 1.4s ease-in-out infinite}
        [data-outcome=success] #phase{color:#166534}[data-outcome=error] #phase{color:#b91c1c}[data-outcome=review] #phase{color:#92400e}
        @keyframes pulse{50%{opacity:.35}}@media(prefers-reduced-motion:reduce){#pulse{animation:none}}
      </style><section id="card" role="region" aria-label="CTI progress"><header><div class="row"><span id="title"></span><span id="clock"></span></div><div id="steps"></div></header><div id="body"><div role="status" aria-live="polite"><span id="pulse" aria-hidden="true"></span><span id="phase"></span></div><div id="detail"></div><div id="count"></div><progress id="bar" aria-label="Current stage progress" hidden></progress><div id="activity"></div><p id="foot"></p></div><footer><button id="toggle" type="button" aria-expanded="true">Minimize</button><button id="close" type="button" hidden>Dismiss</button></footer></section>`;
      root.getElementById('title').textContent = title;
      (options.stages || []).forEach(label => {
        const el = document.createElement('span');
        el.setAttribute('data-step', ''); el.textContent = label;
        root.getElementById('steps').appendChild(el);
      });
      root.addEventListener('click', event => event.stopPropagation());
      root.getElementById('toggle').onclick = () => { minimized = !minimized; safeDraw(); };
      root.getElementById('close').onclick = dispose;
      document.documentElement.appendChild(host);
      safeDraw();
      timer = setInterval(safeDraw, 1000);
    } catch (_) { if (host) host.remove(); root = null; }
    return controller;
  }

export function createBrightspaceProgressPanelV110(title, options) {
  options = options || {};
  const key = options.key || '__CTI_BRIGHTSPACE_PROGRESS__';
  const runningKey = options.runningKey || '__CTI_BRIGHTSPACE_SOURCE_CAPTURE_RUNNING__';
  const previous = window[key];
  if (previous && typeof previous.isAlive === 'function' && previous.isAlive()) {
    const prior = previous.snapshot();
    if ((!options.courseId || prior.courseId === String(options.courseId)) && (!options.buildId || prior.buildId === String(options.buildId))) {
      previous.reveal(); return previous;
    }
    if (previous.isRunning()) { previous.reveal(); throw Error('Pause the existing Brightspace capture before starting another course or build.'); }
    previous.dispose();
  } else if (previous && typeof previous.dispose === 'function') previous.dispose();
  window[runningKey] = false;
  let host, root, timer, disposed = false, minimized = false, active = null, downloading = false;
  let started = 0, finished = 0, phaseStarted = 0, updated = 0;
  const durations = {};
  const state = {phase:'Ready',detail:'Click Capture/resume to read this course. Saved observations keep their original timestamps.',count:'',completed:null,total:null,outcome:'idle',running:false,pauseRequested:false,downloadAvailable:false,storageError:'',checkpointSavedAt:'',startedAt:'',courseId:String(options.courseId || ''),buildId:String(options.buildId || '')};
  const duration = value => Math.floor(Math.max(0,value)/60000)+'m '+String(Math.floor(Math.max(0,value)/1000)%60).padStart(2,'0')+'s';
  function snapshot() {
    const end=finished || Date.now();
    return {...state,running:!!active || state.running,elapsedMs:started ? end-started : 0,phaseElapsedMs:phaseStarted ? end-phaseStarted : 0,
      phaseDurationsMs:{...durations,...(phaseStarted ? {[state.phase]:(durations[state.phase] || 0)+end-phaseStarted} : {})}};
  }
  function draw() {
    if(!root || disposed)return;
    const node=id=>root.getElementById(id),value=snapshot(),busy=value.running;
    node('phase').textContent=state.phase;node('detail').textContent=state.detail;node('count').textContent=state.count;
    node('clock').textContent=started ? 'This attempt: '+duration(value.elapsedMs) : 'Not started';
    node('checkpoint').textContent=state.checkpointSavedAt ? 'Last local checkpoint: '+state.checkpointSavedAt : 'No local checkpoint recorded for this attempt yet.';
    node('activity').textContent=busy ? 'This step: '+duration(value.phaseElapsedMs)+(Date.now()-updated>=30000 ? ' · Waiting for the next progress update' : '') : started ? 'Attempt elapsed time: '+duration(value.elapsedMs) : 'No course request has started from this card.';
    node('storage').hidden=!state.storageError;node('storage').textContent=state.storageError;
    node('start').disabled=busy || downloading || typeof options.onStart!=='function';
    node('pause').disabled=!busy || state.pauseRequested || typeof options.onPause!=='function';
    node('download').disabled=!state.downloadAvailable || downloading || typeof options.onDownload!=='function';
    node('close').hidden=busy || downloading;node('body').hidden=minimized;
    node('toggle').textContent=minimized ? 'Expand' : 'Minimize';node('toggle').setAttribute('aria-expanded',String(!minimized));
    node('card').dataset.outcome=state.outcome;
    const determinate=busy && Number.isFinite(state.completed) && Number.isFinite(state.total) && state.total>0;
    node('bar').hidden=!determinate;
    if(determinate){node('bar').max=state.total;node('bar').value=Math.min(state.total,Math.max(0,state.completed));}
  }
  function update(patch) {
    if(disposed || !patch)return;
    if(patch.phase && patch.phase!==state.phase){
      if(phaseStarted)durations[state.phase]=(durations[state.phase] || 0)+Date.now()-phaseStarted;
      phaseStarted=started && !finished ? Date.now() : 0;state.completed=state.total=null;state.count='';
    }
    for(const name of ['phase','detail','count','outcome','storageError','checkpointSavedAt'])if(patch[name]!==undefined)state[name]=String(patch[name]).slice(0,12000);
    for(const name of ['completed','total'])if(patch[name]!==undefined)state[name]=patch[name];
    if(patch.downloadAvailable!==undefined)state.downloadAvailable=!!patch.downloadAvailable;
    updated=Date.now();draw();
  }
  function finish(outcome, detail, count) {
    update({outcome:outcome || 'review',detail:detail || '',count:count===undefined ? state.count : count});
    finished=started ? Date.now() : 0;state.running=false;minimized=false;window[runningKey]=false;
    if(timer)clearInterval(timer);timer=null;draw();
  }
  function start() {
    if(disposed || active || state.running || downloading || typeof options.onStart!=='function')return active || Promise.resolve(false);
    started=phaseStarted=updated=Date.now();finished=0;
    for(const name of Object.keys(durations))delete durations[name];
    state.startedAt=new Date(started).toISOString();state.phase='Starting capture';
    state.detail='Reading this course only. Earlier observations keep their original timestamps.';
    state.outcome='running';state.running=true;state.pauseRequested=false;state.checkpointSavedAt='';window[runningKey]=true;
    if(!timer)timer=setInterval(draw,1000);
    active=Promise.resolve().then(()=>options.onStart()).then(result=>{
      if(state.running){update({phase:state.pauseRequested ? 'Paused' : 'Attempt finished'});finish('review','Review the retained capture and its evidence gaps. Completion of this action does not certify the whole course.');}
      return result;
    }).catch(error=>{update({phase:state.pauseRequested ? 'Paused' : 'Capture interrupted'});finish(state.pauseRequested ? 'review' : 'error',String(error && error.message || error));throw error;})
      .finally(()=>{active=null;state.running=false;window[runningKey]=false;draw();});
    draw();return active;
  }
  async function pause() {
    if(disposed || !active || state.pauseRequested || typeof options.onPause!=='function')return false;
    state.pauseRequested=true;update({phase:'Pausing',detail:'Stopping the current request and retaining the latest partial capture. Wait for the paused result before closing this page.'});
    await options.onPause();return true;
  }
  async function downloadSaved() {
    if(disposed || !state.downloadAvailable || downloading || typeof options.onDownload!=='function')return false;
    downloading=true;draw();
    try{await options.onDownload();return true;}
    catch(error){update({storageError:'Download failed: '+String(error && error.message || error)+' Keep this page open and try again.'});throw error;}
    finally{downloading=false;draw();}
  }
  const controller={update,finish,snapshot,start,pause,download:downloadSaved,
    isRunning(){return !!active || state.running;},isAlive(){return !disposed && !!host;},
    reveal(){if(!disposed && host){minimized=false;if(!host.isConnected)document.documentElement.appendChild(host);draw();}return controller;},
    dispose(){if(active || state.running || downloading)return false;disposed=true;if(timer)clearInterval(timer);if(host)host.remove();if(window[key]===controller)delete window[key];window[runningKey]=false;return true;}};
  host=document.createElement('div');host.setAttribute('data-cti-progress','true');
  host.style.cssText='all:initial!important;position:fixed!important;right:18px!important;bottom:18px!important;z-index:2147483645!important;width:min(400px,calc(100vw - 36px))!important;display:block!important;';
  root=host.attachShadow({mode:'closed'});
  root.innerHTML=`<style>
    :host{color-scheme:light}*{box-sizing:border-box}[hidden]{display:none!important}
    #card{font:14px/1.45 system-ui,-apple-system,sans-serif;background:#fff;color:#172b4d;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 8px 36px #0f172a26;overflow:hidden}
    header{padding:13px 16px;background:#f6f8fc;border-bottom:1px solid #e2e8f0}#title{font-weight:700}#clock{font-size:12px;color:#526174;margin-top:3px}
    #body{padding:14px 16px}#phase{font-size:16px;font-weight:700;color:#1d4ed8}#detail,#count{margin:8px 0;overflow-wrap:anywhere}#detail{max-height:130px;overflow:auto}
    #count{font-weight:600}#activity,#foot,#checkpoint{font-size:12px;color:#526174;overflow-wrap:anywhere}#storage{color:#9f1239;overflow-wrap:anywhere}#bar{width:100%;height:8px;accent-color:#2563eb}
    #actions,footer{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}footer{justify-content:flex-end;border-top:1px solid #e2e8f0;padding:8px 12px;margin:0}
    button{font:inherit;font-size:13px;color:#334155;background:#fff;border:1px solid #94a3b8;border-radius:6px;padding:7px 10px;cursor:pointer;min-height:36px}
    #start{background:#1d4ed8;color:#fff;border-color:#1d4ed8}button:disabled{opacity:.55;cursor:default}button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
    [data-outcome=error] #phase{color:#b91c1c}[data-outcome=review] #phase{color:#92400e}[data-outcome=success] #phase{color:#166534}
  </style><section id="card" role="region" aria-label="CTI Brightspace capture"><header><div id="title"></div><div id="clock"></div></header><div id="body"><div id="phase" role="status" aria-live="polite"></div><p id="detail"></p><p id="count"></p><progress id="bar" aria-label="Current stage progress" hidden></progress><div id="activity"></div><p id="checkpoint"></p><p id="storage" role="alert" hidden></p><p id="foot">Captured, empty, unavailable and unverified are distinct. Saved progress is local to this browser and origin; keep a downloaded capture.</p><div id="actions"><button id="start" type="button">Capture/resume</button><button id="pause" type="button" disabled>Pause</button><button id="download" type="button" disabled>Download saved capture</button></div></div><footer><button id="toggle" type="button" aria-expanded="true">Minimize</button><button id="close" type="button">Dismiss</button></footer></section>`;
  root.getElementById('title').textContent=String(title || 'CTI · Brightspace capture');
  root.addEventListener('click',event=>event.stopPropagation());
  root.getElementById('start').onclick=()=>{void start().catch(()=>{});};
  root.getElementById('pause').onclick=()=>{void pause().catch(error=>update({storageError:String(error && error.message || error)}));};
  root.getElementById('download').onclick=()=>{void downloadSaved().catch(()=>{});};
  root.getElementById('toggle').onclick=()=>{minimized=!minimized;draw();};
  root.getElementById('close').onclick=()=>controller.dispose();
  document.documentElement.appendChild(host);window[key]=controller;draw();return controller;
}
