

export function qaAssessmentScoreLabel_(a) {
    a=a||{};var value=a.fidelity!=null?a.fidelity:a.similarity;
    if(value==null)return '';
    if(a.status==='UNVERIFIED')return 'not verified';
    var pct=Math.max(0,Math.min(100,Number(value)*100));
    return (a.status!=='VERIFIED' && pct>=99.95?'<100':pct.toFixed(1).replace(/\.0$/,''))+'% observed-field match';
 }

export function qaAssessmentAnswerEvidenceText_(sa) {
   if(sa.answerEvidenceApplicable===false)return 'N/A (written-response questions; grading still requires review)';
   return sa.answerEvidenceCoverage==null?'not recorded':Math.round(Number(sa.answerEvidenceCoverage||0)*100)+'%';
 }

export function qaAssessmentEvidenceText_(sa) {
   sa=sa||{};var lines=[];
   if(sa.reason)lines.push('Assessment evidence: '+sa.status+' — '+sa.reason);
   if((sa.unmatchedSourceQuestions||[]).length)lines.push('Unmatched source question(s): '+sa.unmatchedSourceQuestions.join(', '));
   if((sa.unmatchedCourseraQuestions||[]).length)lines.push('Unmatched Coursera question(s): '+sa.unmatchedCourseraQuestions.join(', '));
   if((sa.sourceMediaQuestionNumbers||[]).length)lines.push('Question media: '+(sa.questionMediaStatus||'UNVERIFIED')+' | source question(s): '+sa.sourceMediaQuestionNumbers.join(', '));
   (sa.sourcePackageMediaGaps||[]).forEach(function(m){
     lines.push('Source Q'+m.question+' media '+m.status+' | reference: '+(m.ref||'not recorded')+' | expected package path: '+(m.expectedPath||'not recorded')+((m.candidates||[]).length?' | candidate paths: '+m.candidates.join(' ; '):''));
   });
   return lines.join('\n');
 }

export function qaQuestionDifferenceText_(q) {
    if(!q)return '';
    var d=q.details||{},lines=[],normalization=d.optionFeedbackNormalization;
    if(!(q.mismatches||[]).length && !normalization && !d.optionCaptureIssue)return '';
    if(d.optionCaptureIssue)lines.push('Capture evidence gap: '+d.optionCaptureIssue+'. Raw answer and feedback text remain below for inspection; no answer-key change is proven.');
    if(normalization){
      lines.push('Option feedback separated from answer text: '+normalization.basis+'. Correctness markers were retained.');
      (normalization.changes||[]).forEach(function(o){lines.push('  Raw captured row '+JSON.stringify(o.rawText)+' → answer text '+JSON.stringify(o.normalizedText)+' | feedback '+JSON.stringify(o.feedbackText));});
    }
    lines.push('Source prompt: '+String(q.prompt||'Not captured'));
    lines.push('Coursera prompt: '+String(q.courseraPrompt||'Not captured'));
    if(Array.isArray(d.sourceCorrectAnswers))lines.push('Source correct answer(s): '+JSON.stringify(d.sourceCorrectAnswers));
    if(Array.isArray(d.courseraCorrectAnswers))lines.push((normalization?'Coursera correct answer(s) after feedback separation: ':'Captured Coursera correct answer(s): ')+(d.courseraAnswerTextReliable===false?'Not observed':JSON.stringify(d.courseraCorrectAnswers)));
    if(!Array.isArray(d.sourceCorrectAnswers) && !Array.isArray(d.courseraCorrectAnswers)) {
      (d.correctAnswerPairs||[]).forEach(function(p){lines.push('Matched answer evidence: source '+JSON.stringify(p.source||'')+' → Coursera '+JSON.stringify(p.coursera||''));});
    }
    function options(label,rows){if(!Array.isArray(rows))return;lines.push(label+':');rows.forEach(function(o,i){lines.push('  '+(i+1)+'. '+String(o.text||o.label||'')+(o.description&&String(o.text||'').indexOf(o.description)===-1?' — '+o.description:'')+(o.correct===true?' [marked correct]':o.correct===false?' [marked incorrect]':' [correctness not observed]'));});}
    options('Source options',d.sourceOptions);options(normalization?'Coursera options after feedback separation':'Captured Coursera options',d.courseraOptions);
    if(!Array.isArray(d.sourceOptions) && !Array.isArray(d.courseraOptions)) {
      (d.optionPairs||[]).forEach(function(p){lines.push('Matched option evidence: source '+JSON.stringify(p.source||'')+' → Coursera '+JSON.stringify(p.coursera||''));});
    }
    if((q.mismatches||[]).indexOf('TYPE')>=0)lines.push('Question type: source '+String(q.sourceType||'unknown')+' → Coursera '+String(q.courseraType||'unknown'));
    if((q.mismatches||[]).indexOf('POINTS')>=0)lines.push('Points: source '+String(d.pointsSource)+' → Coursera '+String(d.pointsCoursera));
    if(d.sourceAnswerTextReliable!=null||d.courseraAnswerTextReliable!=null)lines.push('Answer evidence marked reliable: source '+String(d.sourceAnswerTextReliable)+' | Coursera '+String(d.courseraAnswerTextReliable));
    return lines.join('\n');
 }
