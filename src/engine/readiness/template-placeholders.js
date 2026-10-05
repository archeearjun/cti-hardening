/** Explicit authoring prompts only. Bracketed course names, citations, array
 * notation and learner prose using the word "include" are not placeholders. */
export function qaTemplatePlaceholders_(value) {
    var pattern=/\[(?:(?:add|insert|enter)\s+[^\]]{3,80}|include\s+(?:your\s+(?:title|contact\s+(?:details|information)|bio(?:graphy)?)|information\s+for\s+your\s+preferred\s+method\s+of\s+contact|the\s+(?:instructor|course|assessment))\b[^\]]{0,160}|brief\s+description\s+of\s+(?:assessment|assignment)\s+\d{1,3})\]/gi;
    var matches=String(value||'').match(pattern)||[];
    return matches.filter(function(v,i,all){return all.indexOf(v)===i;}).slice(0,6);
}
