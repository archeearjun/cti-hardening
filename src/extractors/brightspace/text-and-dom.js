

export async function sha256(text) {
    try {
      const bytes = new TextEncoder().encode(String(text || ''));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
    } catch (_) { return ''; }
  }

export function absoluteUrl(url, base) {
    try { return new URL(String(url || ''), base || location.href).href; } catch (_) { return ''; }
  }

export function sameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (_) { return false; }
  }

export function findOrgUnitId() {
    // Brightspace New Content Experience commonly uses /d2l/le/lessons/<orgUnitId>/...
    // and many D2L web components keep navigation links inside open shadow roots.
    // We therefore collect candidates from several *already-loaded* browser sources
    // and score them. This makes no network request.
    const candidates = [];
    const add = (value, score, source) => {
      const v = String(value == null ? '' : value).trim();
      if (!/^\d{2,}$/.test(v)) return;
      candidates.push({ value:v, score:Number(score)||0, source:String(source||'unknown') });
    };

    const inspectUrl = (raw, baseScore, source) => {
      if (!raw) return;
      let s = String(raw);
      try { s = new URL(s, location.href).href; } catch (_) {}
      const patterns = [
        /\/d2l\/le\/(?:lessons|content|sequence|activities)\/(\d+)(?:\/|\?|#|$)/i,
        /\/d2l\/home\/(\d+)(?:\/|\?|#|$)/i,
        /[?&](?:ou|orgUnitId|ouId|orgUnit|contextId)=(\d+)(?:&|#|$)/i,
        /\/d2l\/api\/le\/[\d.]+\/(\d+)(?:\/|\?|#|$)/i,
        /\/d2l\/lms\/[^?#]*?\/(\d+)(?:\/|\?|#|$)/i
      ];
      for (const re of patterns) {
        const m = s.match(re);
        if (m) add(m[1], baseScore, source + ':' + re.source.slice(0,40));
      }
    };

    // 1) Current URL is the strongest signal.
    inspectUrl(location.href, 120, 'location');
    try {
      const u = new URL(location.href);
      for (const key of ['ou','orgUnitId','ouId','orgUnit','contextId']) add(u.searchParams.get(key), 120, 'location.query.' + key);
    } catch (_) {}

    // 2) Resources that the current Brightspace page already loaded. NCE normally
    // calls course-scoped endpoints containing the org unit id.
    try {
      for (const e of performance.getEntriesByType('resource') || []) {
        inspectUrl(e && e.name, 105, 'performance.resource');
      }
    } catch (_) {}

    // 3) DOM + open shadow DOM. Brightspace navigation heavily uses web components.
    const roots = [document];
    const seenRoots = new Set();
    while (roots.length) {
      const root = roots.shift();
      if (!root || seenRoots.has(root)) continue;
      seenRoots.add(root);
      let els = [];
      try { els = Array.from(root.querySelectorAll('*')); } catch (_) {}
      for (const el of els) {
        try {
          if (el.shadowRoot) roots.push(el.shadowRoot);
          if (el.getAttribute) {
            const attrs = ['data-org-unit-id','data-orgunitid','org-unit-id','data-ou','data-context-id','data-org-unit'];
            for (const a of attrs) add(el.getAttribute(a), 100, 'dom.attr.' + a);
            for (const a of ['href','action','src']) inspectUrl(el.getAttribute(a), 88, 'dom.' + a);
          }
        } catch (_) {}
      }
    }

    // 4) Inline bootstrap/config text. Only inspect a bounded amount of text and
    // only explicit org-unit shaped keys; do not scan storage/cookies.
    try {
      const scripts = Array.from(document.scripts || []).slice(0, 250);
      const keyPatterns = [
        /["']?orgUnitId["']?\s*[:=]\s*["']?(\d+)["']?/ig,
        /["']?orgUnitID["']?\s*[:=]\s*["']?(\d+)["']?/ig,
        /["']?ouId["']?\s*[:=]\s*["']?(\d+)["']?/ig,
        /["']?orgUnit["']?\s*[:=]\s*["']?(\d+)["']?/ig
      ];
      for (const s of scripts) {
        const body = String(s.textContent || '').slice(0, 500000);
        for (const re of keyPatterns) {
          re.lastIndex = 0;
          let m, n = 0;
          while ((m = re.exec(body)) && n++ < 10) add(m[1], 75, 'inline.config');
        }
      }
    } catch (_) {}

    if (!candidates.length) return { id:'', source:'none', candidates:[] };

    // Aggregate repeated observations. This helps when the same course id appears
    // in several already-loaded URLs, while still prioritizing the current URL.
    const agg = new Map();
    for (const c of candidates) {
      const cur = agg.get(c.value) || { id:c.value, score:0, maxScore:0, hits:0, sources:[] };
      cur.score += c.score;
      cur.maxScore = Math.max(cur.maxScore, c.score);
      cur.hits++;
      if (!cur.sources.includes(c.source)) cur.sources.push(c.source);
      agg.set(c.value, cur);
    }
    const ranked = Array.from(agg.values()).sort((a,b) =>
      (b.maxScore - a.maxScore) || (b.score - a.score) || (b.hits - a.hits)
    );
    const best = ranked[0];
    return { id:best.id, source:best.sources[0] || 'detected', candidates:ranked.slice(0,10) };
  }

export function listObjects(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    const keys = ['Objects','objects','Items','items','Results','results','Modules','modules','Topics','topics'];
    for (const k of keys) if (Array.isArray(payload[k])) return payload[k];
    return [];
  }

export function getId(obj, names) {
    for (const n of names) if (obj && obj[n] != null && String(obj[n]) !== '') return obj[n];
    return null;
  }

export function activityTypeLabel(v) {
    const n = Number(v);
    const labels = {
      '-1':'UnknownActivity', 0:'Module', 1:'File', 2:'Link', 3:'Dropbox', 4:'Quiz',
      5:'DiscussionForum', 6:'DiscussionTopic', 7:'LTI', 8:'Chat', 9:'Schedule',
      10:'Checklist', 11:'SelfAssessment', 12:'Survey', 13:'OnlineRoom', 14:'CourseLink',
      20:'Scorm_1_3', 21:'Scorm_1_3_Root', 22:'Scorm_1_2', 23:'Scorm_1_2_Root',
      24:'Scorm', 25:'Lor', 26:'LorScorm', 27:'LTIAdvantage', 28:'OrgUnit', 29:'ActivityInstance'
    };
    return Number.isFinite(n) && Object.prototype.hasOwnProperty.call(labels, n) ? labels[n] : '';
  }

export function ctiDeclaredQuizCountFromText_(value) {
    var text=String(value || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    var words=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'];
    var contradictory=false;
    text=text.replace(new RegExp('\\b('+words.join('|')+')\\s*\\((\\d+)\\)','gi'),function(all,word,digits){
      if(words.indexOf(word.toLowerCase())!==Number(digits)){contradictory=true;return all;}
      return digits;
    });
    if(contradictory)return null;
    // Exam length is metadata, not a proof of question-bank or pool completeness.
    var pattern=/\b(\d+)[ -]+(?:(?:short[ -]answer|long[ -]answer(?:\s*\(calculation\))?|true\s*\/\s*false|multiple[ -]choice|multiple[ -]select|matching|essay|numeric|written[ -]response)(?:\s*,?\s*(?:and\s+)?))*questions?\b/gi;
    var counts=[],m;
    while((m=pattern.exec(text))) {
      var before=text.slice(Math.max(0,m.index-70),m.index);
      // Do not mistake "answer 5 of 20 questions" for a declared exam total.
      if (/\b(?:\d+\s+of|from|pool of|bank of)\s*$/i.test(before)) continue;
      var n=Number(m[1]);
      if(n>0 && Number.isSafeInteger(n) && counts.indexOf(n)<0) counts.push(n);
    }
    return counts.length===1?counts[0]:null;
  }

export function flattenTree(nodes, out = []) {
    (nodes || []).forEach(n => {
      out.push(n);
      if (n.children) flattenTree(n.children, out);
    });
    return out;
  }

export function download(name, text, mime) {
    const blob = new Blob([text], {type:mime || 'text/plain;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
