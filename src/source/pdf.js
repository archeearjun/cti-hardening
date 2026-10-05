

export async function extractPdfTextEvidence_(pdfServices, arrayBuffer, maxPages, maxChars, hints) {
const {pdfjsLib, pdfWorkerUrl, pdfVersion} = pdfServices;
    if (!arrayBuffer || !pdfjsLib || !pdfjsLib.getDocument) return { text:'', pageCount:0, pagesRead:0, parser:'unavailable', pageSamples:[], sampleStrategy:'unavailable' };
    try {
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      }
      var loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false });
      var pdf = await loadingTask.promise;
      var pageLimit = Math.min(pdf.numPages || 0, Math.max(1, Number(maxPages || 60)));
      var charLimit = Math.max(1000, Number(maxChars || 16000));
      hints = hints || {};
      var role = String(hints.role || '').toLowerCase();
      var fileName = String(hints.fileName || '').toLowerCase();
      var stop = { pdf:1, document:1, file:1, final:1, copy:1, version:1, v1:1, v2:1, the:1, and:1, for:1, with:1 };
      var hintTokens = fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(function(t) { return t.length >= 4 && !stop[t]; });
      var roleTokens = role === 'rubric'
        ? ['rubric','criterion','criteria','grading','points','proficient','exemplary','developing','inadequate','performance']
        : ['assessment','assignment','directions','direction','instructions','instruction','expectations','submit','submission','graded','rubric'];
      var pages = [], pagesRead = 0;

      // Read every page allowed by the explicit page budget. v6.5.6 stopped once
      // the text-character budget was full, which biased long documents toward
      // their opening pages and could completely miss the transformed section.
      for (var p = 1; p <= pageLimit; p++) {
        var page = await pdf.getPage(p);
        var tc = await page.getTextContent();
        var pageText = (tc.items || []).map(function(item) { return String(item.str || ''); }).join(' ').replace(/\s+/g, ' ').trim();
        var low = pageText.toLowerCase();
        var score = 0;
        hintTokens.forEach(function(token) { if (low.indexOf(token) > -1) score += 4; });
        roleTokens.forEach(function(token) { if (low.indexOf(token) > -1) score += 1.5; });
        if (p <= 2) score += 1.25;
        if (p > Math.max(0, pageLimit - 2)) score += 0.75;
        if (pageText.length >= 120) score += Math.min(2, pageText.length / 2200);
        pages.push({ page:p, text:pageText, score:score });
        pagesRead++;
        try { page.cleanup(); } catch (e) {}
      }
      try { if (pdf.cleanup) pdf.cleanup(); } catch (e) {}

      var meaningful = pages.filter(function(x) { return x.text && x.text.length >= 40; });
      var ranked = meaningful.slice().sort(function(a,b) { return (b.score - a.score) || (a.page - b.page); });
      var selectedMap = Object.create(null), selected = [];
      function addPage(rec) {
        if (!rec || selectedMap[rec.page]) return;
        selectedMap[rec.page] = true;
        selected.push(rec);
      }
      // Keep document boundaries for context, then fill with role/name-relevant pages.
      meaningful.slice(0, 2).forEach(addPage);
      meaningful.slice(-2).forEach(addPage);
      ranked.slice(0, 8).forEach(addPage);
      selected.sort(function(a,b) { return a.page - b.page; });

      var pageSamples = selected.slice(0, 12).map(function(rec) {
        return { page: rec.page, text: rec.text.slice(0, 3000), score: Number(rec.score.toFixed(2)) };
      });
      var parts = [], used = 0;
      for (var i = 0; i < pageSamples.length && used < charLimit; i++) {
        var remaining = charLimit - used;
        var fragment = pageSamples[i].text.slice(0, remaining);
        if (fragment) { parts.push(fragment); used += fragment.length; }
      }
      return {
        text: parts.join(' ').replace(/\s+/g, ' ').trim(),
        pageCount: Number(pdf.numPages || 0),
        pagesRead: pagesRead,
        truncated: pagesRead < pdf.numPages || meaningful.length > pageSamples.length || selected.some(function(rec) { return rec.text.length > 3000; }) || pageSamples.reduce(function(n, rec) { return n + rec.text.length; }, 0) > charLimit,
        parser:'pdfjs-' + pdfVersion,
        pageSamples: pageSamples,
        sampleStrategy:'role-keyword-page-sampling-v1'
      };
    } catch (e) {
      return { text:'', pageCount:0, pagesRead:0, parser:'error', error:String(e && e.message || e || '').slice(0,300), pageSamples:[], sampleStrategy:'error' };
    } finally {
      if (typeof loadingTask !== 'undefined' && loadingTask) await loadingTask.destroy();
    }
 }
