// Derived negative evidence only. These records never grant completeness.
export function qaSourceTextLimitation_(source) {
    if (!source) return null;
    var reasons = [];
    if (source.evidenceTruncated === true) reasons.push('SOURCE_SAMPLE_TRUNCATED');
    if (source.sourceTextRefreshRequired === true) reasons.push('SOURCE_TEXT_REFRESH_REQUIRED');
    if (source.textHashScope === 'CAPTURED_SAMPLE') reasons.push('SOURCE_HASH_IS_SAMPLE_ONLY');
    if (source.textCoverage && source.textCoverage.status === 'INCOMPLETE') reasons.push('SOURCE_DECLARED_TEXT_INCOMPLETE');
    (source.assetDetails || []).forEach(function(file) {
        if (file && (file.readError || file.pdfReadError)) reasons.push('SOURCE_FILE_READ_FAILED');
    });
    return reasons.length ? {schemaVersion:1,platform:'SOURCE',status:'INSUFFICIENT_EVIDENCE',
        reasons:Array.from(new Set(reasons)),reason:'Source text is incomplete or unreadable. A matching sample cannot verify the complete instructional body.'} : null;
}

export function qaDirectCaptureLimitation_(item) {
    var p = item && item.payload || {}, contract = p.captureContract || item && item.captureContract;
    if (!contract || contract.itemId !== String(item.id || '') ||
        !(p.directDataSources || p.directPublishedReadingEvidence || p.directNativeRecheckAttempt)) return null;
    if (contract.complete !== false) return null;
    return {schemaVersion:1,platform:'COURSERA',status:'INSUFFICIENT_EVIDENCE',itemId:String(item.id),
        captureStatus:String(contract.status || ''),reasons:(Array.isArray(contract.reasons) ? contract.reasons : []).filter(function(r){return typeof r === 'string';}),
        reason:'The native capture retains this item but has not verified its complete body. Configuration, references and historical observations are not complete current instructional evidence.'};
}

export function qaApplyIncompleteTraversalGap_(result, traversal, sourceGap, destinationItems) {
    var nativeIds=(destinationItems || []).filter(function(item){return item.directCaptureLimitation &&
        item.directCaptureLimitation.itemId===String(item.id || '');}).map(function(item){return String(item.id);});
    nativeIds=Array.from(new Set(nativeIds));
    if (!result || result.verdict !== 'MISSING' || (!sourceGap && !nativeIds.length && !(traversal && traversal.recorded && !traversal.complete))) return result;
    result.verdict = 'UNVERIFIED';
    result.evidenceCoverage = 0;
    result.fidelityPercent = 0;
    result.issues = (result.issues || []).filter(function(v){return v !== 'MISSING_ITEM';}).concat(['PAYLOAD_UNVERIFIED']);
    result.checks.structure = {status:'UNVERIFIED',weight:0,standaloneMatch:'NOT_FOUND'};
    result.checks.evidenceAvailability = {schemaVersion:1,status:'INSUFFICIENT_EVIDENCE',
        source:sourceGap || null,destination:nativeIds.length ? {
            reasonCode:'DESTINATION_NATIVE_BODIES_UNVERIFIED',unresolvedItemIds:nativeIds,
            unresolvedCount:nativeIds.length,inventoryMayBeComplete:true
        } : traversal && traversal.recorded && !traversal.complete ? {
            reasonCode:'DESTINATION_TRAVERSAL_INCOMPLETE',unresolvedItemIds:traversal.unresolvedItemIds.slice(),
            unresolvedCount:traversal.unresolvedCount} : null,
        reason:'No standalone match was found. Incomplete source content or unread destination items prevent a definitive absence claim; retained or transformed content may not yet be located.'};
    return result;
}
