

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
