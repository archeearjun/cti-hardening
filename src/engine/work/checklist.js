// Maintained source: explicit dependencies; no ordered concatenation.


export function workEvidenceChecklistSteps_() {
  return [
    {key:'sourceRescanned',group:'Source',label:'Original IMSCC re-scanned in CTI'},
    {key:'brightspaceCaptured',group:'Source',label:'Brightspace source JSON saved'},
    {key:'beforeCourseraCaptured',group:'Before re-ingestion',label:'Old Coursera JSON saved'},
    {key:'beforeExcelSaved',group:'Before re-ingestion',label:'Old Coursera XLSX saved'},
    {key:'beforeQaSaved',group:'Before re-ingestion',label:'BEFORE QA report saved'},
    {key:'reingested',group:'Re-ingestion',label:'Latest Smart Ingestion completed'},
    {key:'afterCourseraCaptured',group:'After re-ingestion',label:'New Coursera JSON saved before manual corrections'},
    {key:'afterExcelSaved',group:'After re-ingestion',label:'New Coursera XLSX saved'},
    {key:'afterQaSaved',group:'After re-ingestion',label:'AFTER QA report saved'},
    {key:'evidenceOrganized',group:'Ready to review',label:'Original IMSCC, source JSON and both Coursera file/report sets kept together'}
  ];
}

export function workValidateEvidenceChecklistPatch_(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid evidence checklist.');
  var allowed = workEvidenceChecklistSteps_().map(function(step){ return step.key; });
  var keys = Object.keys(patch), out = {};
  if (!keys.length) throw new Error('No evidence checklist changes were provided.');
  keys.forEach(function(key) {
    if (allowed.indexOf(key) < 0 || typeof patch[key] !== 'boolean') throw new Error('Invalid evidence checklist step: ' + key + '.');
    out[key] = patch[key];
  });
  return out;
}

export function workNormalizeEvidenceChecklist_(saved) {
  var out = {};
  workEvidenceChecklistSteps_().forEach(function(step){ out[step.key] = false; });
  if (saved === '' || saved == null) return out;
  if (typeof saved === 'string') {
    try { saved = JSON.parse(saved); } catch(e) { throw new Error('Saved evidence checklist is unreadable. No progress has been overwritten.'); }
  }
  if (saved && typeof saved === 'object' && !Array.isArray(saved) && !Object.keys(saved).length) return out;
  var patch = workValidateEvidenceChecklistPatch_(saved);
  Object.keys(patch).forEach(function(key){ out[key] = patch[key]; });
  return out;
}
