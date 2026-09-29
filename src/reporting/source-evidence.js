

export function qaExternalWebpageDiagnosticText_(e) {
   return '  External webpage evidence: '+e.status+' | '+e.reasonCode+' — '+e.reason+'\n' +
     '    Source resource type: '+(e.sourceTypeRaw||'not recorded')+' | Source URL(s): '+((e.sourceUrls||[]).join(' ; ')||'not captured')+'\n' +
     '    Captured URL(s): '+((e.capturedUrls||[]).join(' ; ')||'not available')+' | link confidence: '+(e.linkEvidenceConfidence==null?'unknown':Math.round(e.linkEvidenceConfidence*100)+'%')+' | Plugin marker: '+(e.configurationMarkerObserved?'observed':'not observed')+'\n'+
     (e.runtime?'    Frame evidence: readable='+e.runtime.readableFrames+' | inaccessible='+e.runtime.inaccessibleFrames+' | playback='+e.runtime.playbackStatus+' | launch='+e.runtime.launchStatus+'\n':'');
 }

export function qaSourceAssetProvenanceText_(e) {
   return (e.matches||[]).map(function(m){return '  Source file: '+m.destinationFile+' | SHA-256: '+m.sha256+'\n'+(m.sources||[]).map(function(s){return '    '+s.sourcePath+' → '+s.sourceName+' | '+s.filePath+'\n';}).join('');}).join('');
 }
