import { isAssessmentLikeFingerprintV662 } from "./assessments-2.js";
import { ctiGuardOptionEvidence_, ctiOptionLabelLooksLikeFeedback_ } from "./assessments-3.js";
import { exactAssessmentLayoutV61313 } from "./assessments-4.js";
import { MAX_TEXT_SAMPLE } from "./config.js";
import { isItemSpecificCourseRoute } from "./navigation-2.js";
import { hasVisibleLoadingIndicator } from "./text-and-dom-2.js";
import { isVisibleElement, splitCarryDescriptionAndLabel, textWithoutExactBadges } from "./text-and-dom-3.js";
import { isGlobalChromeElement } from "./text-and-dom-4.js";
import { courseId, normalizeName, unique } from "./text-and-dom.js";

export function isAssignmentTextBlockV61321(part) {
    return !!(part && /^assignment-part-\d+$/.test(part.getAttribute('data-testid') || '') && /~textBlock!~/i.test(part.id || ''));
  }

export function parseAssignmentTextBlockV61321(part) {
    if(!isAssignmentTextBlockV61321(part) || !part.isConnected || hasVisibleLoadingIndicator(part))return null;
    const visible=isVisibleElement(part);
    const clean=value=>String(value || '').replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
    // Coursera keeps collapsed assignment parts mounted in the exact item editor.
    // Their DOM text is still authoritative item-scoped content even when the
    // accordion panel itself is not currently visible.
    const flat=clean((visible ? part.innerText : '') || part.textContent),fields=[...part.querySelectorAll('textarea,[contenteditable="true"],[contenteditable="plaintext-only"]')].filter(isVisibleElement);
    const labeled=fields.filter(el=>/^Content\s*\*?$/i.test(clean(el.getAttribute('aria-label'))));
    const boundary=flat.match(/^\d*\s*Text block\s+(.+?)\s+Title\s+(.+?)\s+Content\s+([\s\S]+)$/i);
    const repeatedTitle=!!(boundary && clean(boundary[1])===clean(boundary[2]));
    let text='',title=repeatedTitle?clean(boundary[2]):'',method='';
    if(labeled.length===1) {
      text=clean(labeled[0].value || labeled[0].innerText || labeled[0].textContent);method='LABELED_TEXT_BLOCK_CONTENT_FIELD';
    } else if(!labeled.length && repeatedTitle) {
      text=clean(boundary[3]);method=visible?'BOUNDED_TEXT_BLOCK_PART':'BOUNDED_COLLAPSED_TEXT_BLOCK_PART';
    }
    if(!text)return null;
    const limit=MAX_TEXT_SAMPLE,frames=[...part.querySelectorAll('iframe,embed,object')].length;
    return {id:String(part.id),kind:'text-block',title,text:text.slice(0,limit),method,visible,
      observedCharacters:text.length,capturedCharacters:Math.min(text.length,limit),limit,truncated:text.length>limit,
      embeddedFrameCount:frames,embeddedFrameTextIncluded:false,submissionBehavior:'NOT_INFERRED_FROM_INSTRUCTIONS'};
  }

export function collectAssignmentTextBlocksV61321(root,fp) {
    if(!root || !fp || !isAssessmentLikeFingerprintV662(fp))return null;
    let layout=exactAssessmentLayoutV61313(root,fp);
    // Text blocks may live in a collapsed body that Coursera keeps mounted
    // outside the smaller editor surface returned by the generic surface finder.
    // Recover only inside the exact item route and require one assignment outline
    // plus one body containing item-bound assignment parts.
    if(!layout && isItemSpecificCourseRoute(location.href,fp,courseId())) {
      for(let node=root,depth=0;node && depth<16&&!layout;node=node.parentElement,depth++) {
        if(node===document.body || node===document.documentElement)break;
        if(!node.isConnected)continue;
        const rails=[...node.querySelectorAll('[data-testid="item-layout-left-sidebar"]')].filter(isVisibleElement);
        const bodies=[...node.querySelectorAll('[data-testid="item-layout-content"]')].filter(body=>
          body && body.isConnected && body.querySelector('[data-testid^="assignment-part-"]'));
        if(rails.length===1 && bodies.length===1 && /Assignment outline/i.test(rails[0].innerText || rails[0].textContent || ''))
          layout={root:node,sidebar:rails[0],content:bodies[0],method:'EXACT_ROUTE_COLLAPSED_TEXT_BLOCK_LAYOUT'};
      }
    }
    if(!layout || hasVisibleLoadingIndicator(layout.root))return null;
    const parts=[...layout.content.querySelectorAll('[data-testid^="assignment-part-"]')];
    const textParts=parts.filter(isAssignmentTextBlockV61321);
    if(!textParts.length)return null;
    const blocks=textParts.map(parseAssignmentTextBlockV61321).filter(Boolean);
    const rail=String(layout.sidebar.innerText || layout.sidebar.textContent || '').replace(/\s+/g,' ').trim();
    const count=rail.match(/\bContent\s*\(\s*(\d+)\s*\)/i),declared=count?Number(count[1]):null;
    const links=assignmentOutlineLinksV61320(layout.sidebar,layout.root).filter(a=>!a.structural && !/^#for-(?:content|learning-objectives)$/.test(a.href));
    const blockIds=new Set(blocks.map(b=>b.id));
    const allLinksMapped=links.length===blocks.length && links.every(a=>{try{return blockIds.has(decodeURIComponent(a.href.slice(1)));}catch(_){return false;}});
    return {schemaVersion:1,itemId:String(fp.id),courseId:String(courseId()),route:location.href,
      declaredContentParts:declared,observedPartCount:parts.length,observedTextBlockCount:textParts.length,
      otherPartCount:parts.length-textParts.length,blocks,
      completeTextBlockOnly:declared>0 && declared===parts.length && parts.length===blocks.length && allLinksMapped && blocks.every(b=>!b.truncated),
      sourceCompleteness:'NOT_DETERMINED',meaning:'Text blocks are instruction content. Their presence does not establish submission controls, question count for mixed editors, or external-frame content.'};
  }

export function assignmentTextBlockBodyV61321(root,fp) {
    const evidence=collectAssignmentTextBlocksV61321(root,fp);
    if(!evidence || !evidence.completeTextBlockOnly)return null;
    const full=evidence.blocks.map(b=>[b.title,b.text].filter(Boolean).join(' ')).join(' '),text=full.slice(0,MAX_TEXT_SAMPLE);
    const incomplete=full.length>MAX_TEXT_SAMPLE || evidence.blocks.some(b=>b.embeddedFrameCount>0);
    return {text,confidence:'high',priority:98,scoped:true,completeness:incomplete?.72:.94,
      scopeKind:'assignment-text-blocks',fullObservedTextLength:full.length,textCaptureLimit:MAX_TEXT_SAMPLE,
      textCaptureTruncated:full.length>MAX_TEXT_SAMPLE};
  }

export function assignmentOutlineLinksV61320(sidebar,root) {
    return [...sidebar.querySelectorAll('a[href^="#"]')].map(a=>{
      const href=String(a.getAttribute('href') || '');
      let targetId='';try{targetId=decodeURIComponent(href.slice(1));}catch(_){}
      const label=String(a.innerText || a.textContent || '').replace(/\s+/g,' ').trim();
      const target=targetId && document.getElementById(targetId);
      const question=!!(target && (/^assignment-part-/.test(target.getAttribute('data-testid') || '') || target.closest('[data-testid^="assignment-part-"]')));
      // Only the two exact authoring section labels are navigation, not questions.
      // Question anchors (including unresolved IDs) continue to block empty proof.
      const structural=!question && !/[~]/.test(targetId) &&
        /^(?:Learning objectives|Content\s*\*?)$/i.test(label) &&
        (!target || (root.contains(target) && !target.querySelector('[data-testid^="assignment-part-"]')));
      return {href:href.slice(0,260),label:label.slice(0,180),targetFound:!!target,question,structural};
    });
  }

export function emptyAssessmentProbeV61320(root,fp) {
    const result={status:'NOT_ESTABLISHED',reason:'EXACT_LAYOUT_NOT_FOUND',snapshot:null,outlineLinks:[]};
    const layout=exactAssessmentLayoutV61313(root,fp);
    if(!layout)return result;
    result.layoutMethod=layout.method || 'MARKED_OUTLINE_AND_BODY';
    result.outlineLinks=assignmentOutlineLinksV61320(layout.sidebar,layout.root);
    if(hasVisibleLoadingIndicator(layout.root)){result.reason='LOADING_INDICATOR';return result;}
    if(layout.root.querySelector('[data-testid^="assignment-part-"]')){result.reason='QUESTION_PART_PRESENT';return result;}
    const rail=String(layout.sidebar.innerText || layout.sidebar.textContent || '').replace(/\s+/g,' ').trim();
    const body=String(layout.content.innerText || layout.content.textContent || '').replace(/\s+/g,' ').trim();
    if(!/Content you add will show in order here\.?/i.test(rail)){result.reason='EMPTY_OUTLINE_MARKER_ABSENT';return result;}
    if(!/Generate questions/i.test(body) || !/Create AI[- ]graded question/i.test(body) || !/Select content type/i.test(body)){result.reason='EMPTY_BODY_CONTROLS_ABSENT';return result;}
    if(/Content\s*\(\s*[1-9]\d*\s*\)/i.test(rail)){result.reason='POSITIVE_QUESTION_COUNT';return result;}
    if(result.outlineLinks.some(a=>!a.structural)){result.reason='QUESTION_OR_UNRESOLVED_OUTLINE_LINK';return result;}
    result.status='EMPTY_CANDIDATE';result.reason='OUTLINE_AND_BODY_AGREE';
    result.snapshot={signature:rail+'\n'+body+'\n'+JSON.stringify(result.outlineLinks),route:location.href,marker:'Content you add will show in order here.'};
    return result;
  }

export function observedAssignmentLayoutV61319(root) {
    if(!root || !root.isConnected || !isVisibleElement(root))return null;
    for(let node=root,depth=0;node && depth<10;node=node.parentElement,depth++) {
      if(node===document.body || node===document.documentElement)break;
      if(!node.isConnected || !isVisibleElement(node))continue;
      const rails=[...node.querySelectorAll('[data-testid="item-layout-left-sidebar"]')].filter(isVisibleElement);
      if(rails.length!==1)continue;
      const sidebar=rails[0],railText=String(sidebar.innerText || sidebar.textContent || '');
      if(!/Assignment outline/i.test(railText))continue;
      const parts=[...node.querySelectorAll('[data-testid^="assignment-part-"]')].filter(el=>!sidebar.contains(el) && isVisibleElement(el));
      const anchors=[...sidebar.querySelectorAll('a[href^="#"]')];
      const observedTargets=new Set(anchors.map(a=>{try{return decodeURIComponent(String(a.getAttribute('href') || '').slice(1));}catch(_){return '';}}));
      const empty=/Content you add will show in order here\.?/i.test(railText) && !/Content\s*\(\s*[1-9]\d*\s*\)/i.test(railText) && !parts.length && assignmentOutlineLinksV61320(sidebar,node).every(a=>a.structural);
      if(!empty && (!parts.length || !parts.some(p=>p.id && observedTargets.has(p.id))))continue;
      const candidates=[...node.querySelectorAll('div,main,section,article,form')].slice(0,5000).filter(el=>{
        if(!isVisibleElement(el) || el===sidebar || el.contains(sidebar) || sidebar.contains(el))return false;
        if(parts.length)return !/^assignment-part-/.test(el.getAttribute('data-testid') || '') && parts.every(p=>el.contains(p));
        const text=String(el.innerText || el.textContent || '');
        return /Generate questions/i.test(text) && /Create AI[- ]graded question/i.test(text) && /Select content type/i.test(text);
      });
      candidates.sort((a,b)=>String(a.innerText || a.textContent || '').length-String(b.innerText || b.textContent || '').length);
      if(candidates.length)return {root:node,sidebar,content:candidates[0],method:'OBSERVED_OUTLINE_AND_ASSOCIATED_BODY'};
    }
    return null;
  }

export function assessmentLayoutDiagnosticV61318(root,fp) {
    const probe=emptyAssessmentProbeV61320(root,fp);
    const result={route:location.href,exactRoute:isItemSpecificCourseRoute(location.href,fp,courseId()),
      emptyProbe:{...probe,snapshot:probe.snapshot?{marker:probe.snapshot.marker,route:probe.snapshot.route}:null},ancestors:[]};
    for(let node=root,depth=0;node && depth<10;node=node.parentElement,depth++) {
      if(node===document.body || node===document.documentElement)break;
      result.ancestors.push({tag:node.tagName,testId:String(node.getAttribute('data-testid') || ''),
        className:String(node.getAttribute('class') || '').slice(0,240),connected:!!node.isConnected,
        outlineLinks:[...node.querySelectorAll('[data-testid="item-layout-left-sidebar"]')].slice(0,2).map(rail=>assignmentOutlineLinksV61320(rail,node)),
        sidebarCount:node.querySelectorAll('[data-testid="item-layout-left-sidebar"]').length,
        contentCount:node.querySelectorAll('[data-testid="item-layout-content"]').length,
        outlineMarker:/Assignment outline/.test(String(node.innerText || node.textContent || '')),
        emptyOutlineMarker:/Content you add will show in order here/.test(String(node.innerText || node.textContent || ''))});
    }
    return result;
  }

export function attachQuestionFailureEvidenceV61318(payload) {
    const p=payload || {},questions=p.structuredAssessment && p.structuredAssessment.questions || [];
    const errors=questions.filter(q=>/^\s*\[Error:\s*Image could not be created\]\s*$/i.test(String(q.prompt || ''))).map(q=>({
      ordinal:Number(q.id || 0),id:String(q.id || ''),prompt:String(q.prompt)}));
    if(!errors.length)return;
    const old=p.ingestionFailure || {};
    p.ingestionFailure=Object.assign({},old,{detected:true,confidence:'VERY_HIGH',
      codes:unique([...(old.codes || []),'QUESTION_IMAGE_CREATION_ERROR'],20),questionErrors:errors,
      reason:old.reason || 'Captured question prompts contain explicit image-creation error placeholders.'});
  }

export function isStructuredAssessmentFingerprint(fp) {
    const blob = normalizeName([fp && fp.type, fp && fp.typeName, fp && fp.name].filter(Boolean).join(" "));
    return /assignment|assessment|quiz|staffgraded|graded assignment|gradedassignment/.test(blob);
  }

export function assessmentTypeKey(raw) {
    const s = String(raw || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (/multiple correct|multiple select|checkbox/.test(s)) return "multiple-select";
    if (/single correct|multiple choice|single select|radio/.test(s)) return "single-select";
    if (/true false/.test(s)) return "true-false";
    if (/regular expression|regex/.test(s)) return "regex";
    if (/^(?:text match|numeric|numeric answer)$/.test(s) || /text entry|short answer|fill in/.test(s)) return "text-entry";
    if (/essay|long answer/.test(s)) return "essay";
    return "unknown";
  }

export function exactAssessmentBadgeElements(root) {
    if (!root || !root.querySelectorAll) return [];
    const candidates = [];
    try {
      root.querySelectorAll("span,div,p,strong,em,label,[role='status'],[role='note']").forEach(el => {
        if (!isVisibleElement(el) || isGlobalChromeElement(el)) return;
        const t = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (t !== "Correct" && t !== "Incorrect") return;
        // Keep the innermost exact badge. Parent wrappers often expose the same
        // text and would otherwise create duplicate option rows.
        let childExact = false;
        try {
          [...el.children].forEach(ch => {
            const ct = String(ch.innerText || ch.textContent || "").replace(/\s+/g, " ").trim();
            if (ct === t) childExact = true;
          });
        } catch (e) {}
        if (!childExact) candidates.push(el);
      });
    } catch (e) {}
    return candidates;
  }

export function optionRowForBadge(badge, card, allBadges) {
    if (!badge || !card) return null;
    let best=null, bestScore=-Infinity;
    for(let cur=badge.parentElement;cur && cur!==card && card.contains(cur);cur=cur.parentElement){
      if(!isVisibleElement(cur))continue;
      const badgeCount=(allBadges||[]).filter(b=>cur.contains(b)).length;
      if(badgeCount>1)break; // Never cross into another choice or question.
      const text=String(cur.innerText||cur.textContent||'').replace(/\s+/g,' ').trim();
      if(badgeCount!==1 || text.length<3 || text.length>1600 || /^(?:Correct|Incorrect)$/.test(text))continue;
      const choiceControls=[...cur.querySelectorAll('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]')].filter(el=>isVisibleElement(el));
      if(choiceControls.length>1)break;
      const parts=optionSemanticPartsFromRow(cur),label=String(parts.label||'');
      let score=parts.feedbackOnly?-1000:0;
      if(choiceControls.length===1)score+=300;
      if(ctiOptionLabelLooksLikeFeedback_(label))score-=500;
      if(parts.optionFeedback)score+=100;
      if(label && label.length<=90)score+=20;
      if(cur.getAttribute('data-testid')==='option')score+=5;
      // Prefer the nearest equally supported row, but allow a parent containing
      // the actual choice beside a nested badge/feedback field to replace it.
      if(score>bestScore){best=cur;bestScore=score;}
    }
    return best;
  }

export function splitOptionSemanticText(rawText) {
    const text = String(rawText || "").replace(/\s+/g, " ").trim();
    if (!text) return {label:"", description:"", text:"", aliases:[]};
    const marker = text.match(/\bDescription\s*:\s*/i);
    let label = text, description = "";
    if (marker && marker.index != null) {
      label = text.slice(0, marker.index).trim();
      description = text.slice(marker.index + marker[0].length).trim();
    }
    return {label, description, text:[label, description].filter(Boolean).join(" ").trim(), aliases:[]};
  }

export function optionDomTextV6136(root) {
    function walk(node) {
      if (!node) return '';
      if (node.nodeType===3) return String(node.nodeValue || '');
      if (node.nodeType!==1) return '';
      const tag=String(node.tagName || '').toLowerCase();
      if (/^(?:script|style|template)$/.test(tag)) return '';
      if (tag==='br') return '\n';
      // Prefer a single authoritative TeX annotation to parallel visual and
      // accessibility renderings. Do not infer math from arbitrary aria labels.
      const classes=String(node.getAttribute('class') || '').split(/\s+/);
      if (tag==='mjx-container' || classes.indexOf('katex')>=0 || classes.indexOf('MathJax')>=0) {
        const annotations=Array.from(node.querySelectorAll('annotation[encoding="application/x-tex"]'));
        if(annotations.length===1 && String(annotations[0].textContent || '').trim())return ' '+String(annotations[0].textContent).trim()+' ';
      }
      const text=Array.from(node.childNodes || []).map(walk).join('');
      if(tag==='sup')return '^'+text;

      return /^(?:address|article|aside|blockquote|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|th|thead|tr|ul)$/.test(tag) ? '\n'+text+'\n' : text;
    }
    return walk(root).replace(/[\t\r ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{2,}/g,'\n').trim();
  }

export function optionDomEvidenceV6136(row) {
    const nodes=[];
    function walk(node,depth) {
      if (!node || nodes.length>=24 || depth>7) return;
      if (node.nodeType===3) { const text=String(node.nodeValue || '').trim(); if(text)nodes.push({depth,text:text.slice(0,240)}); return; }
      if (node.nodeType!==1) return;
      const entry={depth,tag:String(node.tagName || '').toLowerCase()};
      for (const name of ['data-testid','data-test','role','contenteditable','aria-label']) {
        const value=node.getAttribute(name);if(value!=null)entry[name]=String(value).slice(0,100);
      }
      nodes.push(entry);
      for (const child of Array.from(node.childNodes || []))walk(child,depth+1);
    }
    walk(row,0);
    return {method:'BOUNDED_OPTION_DOM_STRUCTURE',nodes,possiblyTruncated:nodes.length>=24};
  }

export function optionSemanticPartsFromRow(row) {
    if (!row) return {label:"", description:"", text:"", aliases:[]};
    const rootMarker=['data-testid','data-test','aria-label','class','name','id'].map(k=>row.getAttribute(k)||'').join(' ');
    if(/(?:^|[^a-z])(?:feedback|explanation|GradeFeedback)(?:[^a-z]|$)/i.test(rootMarker)){
      const raw=textWithoutExactBadges(row);
      return {label:raw,text:raw,description:'',aliases:[],feedbackOnly:true};
    }
    let clone;
    try { clone = row.cloneNode(true); } catch (e) { clone = null; }
    if (!clone) return splitOptionSemanticText(textWithoutExactBadges(row));
    try {
      [...clone.querySelectorAll("*")].forEach(el => {
        const t = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if ((t === "Correct" || t === "Incorrect") && (!el.children || ![...el.children].some(ch => String(ch.innerText || ch.textContent || "").replace(/\s+/g, " ").trim() === t))) el.remove();
      });
    } catch (e) {}
    const rawBeforeFeedback=optionDomTextV6136(clone).replace(/\s+/g,' ').trim();
    const concatenatedText=String(clone.textContent || '').replace(/\s+/g,' ').trim();
    let optionFeedback=null;
    try {
      // Remove only explicit feedback fields. Bold text, punctuation and a
      // matching source answer do not establish a field boundary.
      const fields=[...clone.querySelectorAll('*')].filter(el => {
        const marker=['data-testid','data-test','aria-label','class','name','id'].map(k=>el.getAttribute(k)||'').join(' ');
        return /(?:^|[^a-z])(?:feedback|explanation|GradeFeedback)(?:[^a-z]|$)/i.test(marker);
      });
      const outer=fields.filter(el=>!fields.some(other=>other!==el && other.contains(el)));
      const feedback=outer.map(el=>optionDomTextV6136(el)).filter(Boolean);
      outer.forEach(el=>el.remove());
      const remaining=optionDomTextV6136(clone).replace(/\s+/g,' ').trim();
      if(feedback.length && remaining)optionFeedback={rawText:rawBeforeFeedback,feedbackText:feedback.join(' '),method:feedback.length===1 && /^(?:Correct|Incorrect)\.$/.test(feedback[0])?'SEPARATE_TERMINAL_DOM_NODE':'EXPLICIT_FEEDBACK_DOM_FIELD'};
      else if(feedback.length)return {label:rawBeforeFeedback,text:rawBeforeFeedback,description:'',aliases:[],feedbackOnly:true};
    } catch(e) {}
    const raw = optionDomTextV6136(clone);
    if(optionFeedback)optionFeedback.normalizedText=raw.replace(/\s+/g,' ').trim();
    let lines = raw.split(/\r?\n+/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    lines = lines.filter((v,i,a) => a.indexOf(v) === i && v !== "Correct" && v !== "Incorrect");
    let descAt = lines.findIndex(x => /^Description\s*:?$/i.test(x) || /^Description\s*:/i.test(x));
    let pre = descAt >= 0 ? lines.slice(0, descAt) : lines.slice();
    let post = descAt >= 0 ? lines.slice(descAt) : [];
    if (post.length && /^Description\s*:/i.test(post[0])) post[0] = post[0].replace(/^Description\s*:\s*/i, "").trim();
    else if (post.length && /^Description\s*$/i.test(post[0])) post.shift();
    post = post.filter(Boolean);
    if (!pre.length) return splitOptionSemanticText(textWithoutExactBadges(row));
    // A line break alone does not prove that later paragraphs are feedback or
    // aliases. Retain the whole choice unless a field boundary identifies them.
    const label = pre.join(' ');
    const aliases = [];
    const description = post.join(" ").trim();
    const suspiciousJoin=/^([A-Za-z][A-Za-z0-9+\-]{0,15})\1\s+\S/.test(concatenatedText) || /[A-Za-z0-9)](?:Correct|Incorrect)(?:[.!]\s+\S|\s+(?:according|because|answer|response|option|choice|in this context)\b)/.test(concatenatedText);
    const unresolved=!optionFeedback && descAt<0 && suspiciousJoin;
    return {label, description, text:[label, description].filter(Boolean).join(" ").trim(), aliases, optionFeedback,
      optionFieldIssue:unresolved?'ANSWER_AND_FEEDBACK_BOUNDARY_UNRESOLVED':undefined,
      optionDomEvidence:unresolved?optionDomEvidenceV6136(row):undefined};
  }

export function stripCourseraOptionDecoration(text) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return {label:"", aliases:[]};
    let cleaned = raw.replace(/\s*\(\s*(?:\+\/-\s*)?\d+(?:\.\d+)?\s*(?:pts?|points?)\s+per\s+answer\s*\)\s*$/i, "").trim();
    const aliases = [];
    if (cleaned !== raw) aliases.push(raw);

    // Coursera can render both the short label and its decorated label in the same
    // option row, e.g. "Correct Answers, Limited Selections" twice. Collapse only
    // an exact duplicated phrase; never fuzzy-collapse arbitrary learner text.
    const duplicate = cleaned.match(/^(.{5,140}?)\s+\1$/i);
    if (duplicate && duplicate[1]) {
      aliases.push(cleaned);
      cleaned = duplicate[1].trim();
    }
    return {label:cleaned || raw, aliases:[...new Set(aliases.filter(Boolean))]};
  }

export function recoverCollapsedBadgeOptions(optionBlock) {
    const text = String(optionBlock || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    const badge = /\s+(Correct|Incorrect)(?!\s+(?:Selections|Answers?)(?:\b|,))(?=\s|$)/g;
    const matches = [];
    let m;
    while ((m = badge.exec(text)) !== null && matches.length < 30) {
      matches.push({index:m.index, end:badge.lastIndex, status:String(m[1]).toLowerCase()});
    }
    if (matches.length < 2 || matches.length > 12) return null;

    const options = [];
    let previousEnd = 0;
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const segment = text.slice(previousEnd, current.index).trim();
      let labelText = segment;
      if (i > 0) {
        const split = splitCarryDescriptionAndLabel(segment);
        if (!split || !split.label) return null;
        if (options[i - 1] && !options[i - 1].description) {
          options[i - 1].description = split.description.replace(/^Description\s*:?\s*/i, "").trim();
          options[i - 1].text = [options[i - 1].label, options[i - 1].description].filter(Boolean).join(" ").trim();
        }
        labelText = split.label;
      }
      labelText = labelText.replace(/^Description\s*:?\s*/i, "").trim();
      const canonical = stripCourseraOptionDecoration(labelText);
      if (!canonical.label || canonical.label.length > 220) return null;
      options.push({
        id:String(i + 1),
        label:canonical.label,
        description:"",
        text:canonical.label,
        aliases:canonical.aliases || [],
        correct:current.status === "correct"
      });
      previousEnd = current.end;
    }

    const tail = text.slice(matches[matches.length - 1].end).replace(/^Description\s*:?\s*/i, "").trim();
    if (tail && options.length) {
      options[options.length - 1].description = tail;
      options[options.length - 1].text = [options[options.length - 1].label, tail].filter(Boolean).join(" ").trim();
    }

    // Recovery is accepted only when every row has a bounded semantic label and
    // every badge supplied an explicit correctness state.
    if (!options.length || options.some(o => !o.label || o.correct === null)) return null;
    return options;
  }

export function parseCourseraAssessmentTextFallback(rootText) {
    const rawText = String(rootText || "");
    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text || !/\bQuestion\s*Type\b/i.test(text) || !/\bPrompt\b/i.test(text)) return null;
    const declaredMatch = text.match(/\bContent\s*\((\d+)\)/i);
    const declared = declaredMatch ? Number(declaredMatch[1]) : null;

    const detailMatch = rawText.match(/\bContent\s+1\s*Auto-Graded\b/i) || rawText.match(/\b1\s*Auto-Graded\b/i);
    let detail = detailMatch && detailMatch.index != null ? rawText.slice(detailMatch.index) : rawText;
    const exportMatch = detail.match(/\bExport\s+Settings\b/i);
    if (exportMatch && exportMatch.index > 0) detail = detail.slice(0, exportMatch.index);

    const marker = /(\d+)\s*Auto-Graded\s+([0-9]+(?:\.[0-9]+)?)\s*point(?:s)?\s+Question\s*Type\s+([\s\S]+?)\s+Prompt\s+/gi;
    const found = [];
    let m;
    while ((m = marker.exec(detail)) !== null && found.length < 200) {
      found.push({index:m.index, end:marker.lastIndex, number:Number(m[1]), points:Number(m[2]), rawType:String(m[3] || "").replace(/\s+/g, " ").trim()});
    }
    if (!found.length) return null;

    const questions = found.map((f, idx) => {
      const end = idx + 1 < found.length ? found[idx + 1].index : detail.length;
      const bodyRaw = String(detail.slice(f.end, end) || "");
      const body = bodyRaw.replace(/\s+/g, " ").trim();

      const markers = [
        {name:"Options", re:/\bOptions\b/i},
        {name:"Correct Answers", re:/\bCorrect Answers?\b/i},
        {name:"Feedback", re:/\bIncorrect Answers?:\s*Explanation\b/i}
      ].map(x => {
        const mm = bodyRaw.match(x.re);
        return mm && mm.index != null ? {name:x.name,index:mm.index,length:mm[0].length} : null;
      }).filter(Boolean).sort((a,b) => a.index - b.index);

      const firstMarker = markers.length ? markers[0] : null;
      const prompt = (firstMarker ? bodyRaw.slice(0, firstMarker.index) : bodyRaw).replace(/\s+/g, " ").trim();
      let options = [], correctAnswers = [], feedback = "";

      const optionsMarker = markers.find(x => x.name === "Options");
      if (optionsMarker) {
        let optionBlockRaw = bodyRaw.slice(optionsMarker.index + optionsMarker.length);
        const feedbackMatch = optionBlockRaw.match(/\bIncorrect Answers?:\s*Explanation\b/i);
        if (feedbackMatch && feedbackMatch.index != null) {
          feedback = optionBlockRaw.slice(feedbackMatch.index + feedbackMatch[0].length).replace(/\s+/g, " ").trim();
          optionBlockRaw = optionBlockRaw.slice(0, feedbackMatch.index);
        }
        const optionBlock = optionBlockRaw.replace(/\s+/g, " ").trim();
        const badge = /\s+(Correct|Incorrect)(?!\s+(?:Selections|Answers?)(?:\b|,))(?=\s|$)/g;
        let last = 0, bm, optionIndex = 0;
        while ((bm = badge.exec(optionBlock)) !== null) {
          const chunk = optionBlock.slice(last, bm.index).replace(/\s+/g, " ").trim();
          if (chunk) {
            const parts = splitOptionSemanticText(chunk);
            const opt = {id:String(++optionIndex), text:parts.text || chunk, label:parts.label || chunk, description:parts.description || "", aliases:parts.aliases || [], optionFeedback:parts.optionFeedback || undefined, optionFieldIssue:parts.feedbackOnly?'FEEDBACK_ONLY_OPTION_FIELD':parts.optionFieldIssue, optionDomEvidence:parts.optionDomEvidence, correct:String(bm[1]).toLowerCase() === "correct"};
            options.push(opt);
            if (opt.correct) correctAnswers.push(opt.label || opt.text);
          }
          last = badge.lastIndex;
        }

        let typeKeyForRecovery = assessmentTypeKey(f.rawType);
        if (typeKeyForRecovery === "multiple-select") {
          const suspicious = options.length > 6 || !options.length || options.some(o => {
            const t = String(o.text || "");
            return t.length > 180 || /\bCorrect (?:Selections|Answers?)\b/i.test(t);
          });
          if (suspicious) {
            const recovered = recoverCollapsedBadgeOptions(optionBlock);
            if (recovered && recovered.length >= 2) {
              options = recovered;
              correctAnswers = recovered.filter(o => o.correct).map(o => o.label || o.text);
            } else {
              options = [];
              correctAnswers = [];
            }
          }
        }
      } else {
        const collapsedBody = bodyRaw.replace(/\s+/g, " ").trim();
        const ca = collapsedBody.match(/Correct Answers?\s+(.+?)(?:\s+Correct\b|\s+Incorrect Answers?:|$)/i);
        if (ca && ca[1]) correctAnswers.push(String(ca[1]).replace(/\s+/g, " ").trim());
        const fb = collapsedBody.match(/Incorrect Answers?:\s*Explanation\s+(.+)$/i);
        if (fb && fb[1]) feedback = String(fb[1]).replace(/\s+/g, " ").trim();
      }

      let typeKey = assessmentTypeKey(f.rawType);
      if (typeKey === "single-select" && options.length === 2) {
        const pair = options.map(o => String(o.label || o.text || "").toLowerCase()).sort().join("|");
        if (pair === "false|true") typeKey = "true-false";
      }
      const optionTextReliable = options.length > 0 && options.every(o => String(o.label || o.text || "").length <= 220 && String(o.text || "").length <= 1200);
      const answerTextReliable = correctAnswers.length > 0 && (optionTextReliable || /^(regex|text-entry)$/.test(typeKey));
      return {
        id:String(f.number),
        type:typeKey,
        rawType:f.rawType,
        prompt,
        options,
        correctAnswers:[...new Set(correctAnswers.filter(Boolean))],
        feedback,
        points:f.points,
        optionTextReliable,
        answerTextReliable,
        parserConfidence:answerTextReliable ? 0.94 : 0.84
      };
    }).filter(q => q.prompt).map(ctiGuardOptionEvidence_);

    if (!questions.length) return null;
    const countAgreement = declared == null || declared === questions.length;
    return {
      schemaVersion:1,
      parser:"coursera-editor-text-v3-semantic-options",
      origin:"coursera-authoring-editor",
      declaredQuestionCount:declared || questions.length,
      questionCount:questions.length,
      answerEvidenceQuestionCount:questions.filter(q => q.answerTextReliable && q.correctAnswers.length).length,
      questions,
      parserConfidence:countAgreement ? 0.94 : 0.78,
      warnings:countAgreement ? [] : ["Declared content count does not equal text-parsed question count."]
    };
  }
