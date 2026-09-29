// Maintained source: explicit dependencies; no ordered concatenation.
import { nonNegativeInteger_ } from "../validation.js";
import { countCoreEmptyFolders_ } from "../matching/text.js";

export function countEmptyFolders_(nodes) {
  var count = 0;
  if (!nodes) return count;
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].autoDeleted) count++;
    if (nodes[i].children && nodes[i].children.length > 0) count += countEmptyFolders_(nodes[i].children);
  }
  return count;
}

export function computeRiskMetrics_(webcontent, assessments, discussions, weblinks, lti, unknown, emptyFolders) {
  webcontent = nonNegativeInteger_(webcontent); assessments = nonNegativeInteger_(assessments); discussions = nonNegativeInteger_(discussions); weblinks = nonNegativeInteger_(weblinks); lti = nonNegativeInteger_(lti); unknown = nonNegativeInteger_(unknown); emptyFolders = nonNegativeInteger_(emptyFolders);
  var totalItems = webcontent + assessments + discussions + weblinks + lti + unknown;
  // IFS v1 is deliberately preserved for longitudinal comparability. It is a
  // deterministic workload/friction index, not a calibrated probability of failure.
  var ifs = (lti * 10) + (emptyFolders * 5) + (unknown * 3) + (assessments * 2) + (discussions * 1.5) + weblinks + (webcontent * 0.5);
  var isBoilerplate = totalItems > 0 && totalItems <= 5 && assessments === 0 && webcontent === 0;
  if (totalItems === 0 || isBoilerplate) ifs = 100;
  var density = totalItems ? Number((ifs / totalItems).toFixed(2)) : 100;
  return { totalItems: totalItems, ifs: ifs, ifsVersion:'IFS-v1-workload', ifsPerItem:density, isBoilerplate: isBoilerplate };
}

export function parseSourceEvidence_(sourceEvidenceJson) {
  if (!sourceEvidenceJson) return { schemaVersion: 8, manifestOnly: true, resources: {} };
  try {
    var parsed = typeof sourceEvidenceJson === 'string' ? JSON.parse(sourceEvidenceJson) : sourceEvidenceJson;
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid source evidence object.');
    if (!parsed.resources || typeof parsed.resources !== 'object') parsed.resources = {};
    Object.keys(parsed.resources).forEach(function(id) {
      var ev = parsed.resources[id];
      if (!ev || typeof ev !== 'object') return;
      if (!ev.schemaVersion) ev.schemaVersion = Number(parsed.schemaVersion || 0);
      if (!ev.evidenceExtractor && parsed.extractor) ev.evidenceExtractor = String(parsed.extractor);
      if (!ev.evidenceBuildId && parsed.buildId) ev.evidenceBuildId = String(parsed.buildId);
    });
    return parsed;
  } catch (e) {
    return { schemaVersion: 8, manifestOnly: true, resources: {}, warning: 'Source evidence could not be parsed: ' + e.message };
  }
}

export function basicSourceFileEvidence_(href) {
  href = String(href || '');
  var clean = href.split('#')[0].split('?')[0];
  var parts = clean.split('/');
  var name = parts.length ? parts[parts.length - 1] : clean;
  var dot = name.lastIndexOf('.');
  return {
    href: href,
    path: clean,
    name: name,
    extension: dot > -1 ? name.slice(dot + 1).toLowerCase() : '',
    presentInPackage: null,
    kind: 'manifest-reference'
  };
}

export function sourcePayloadForResource_(idref, resourceMap) {
  if (!idref || !resourceMap[idref]) return null;
  var res = resourceMap[idref];
  var evidence = res.evidence && typeof res.evidence === 'object' ? res.evidence : {};
  var evidenceFiles = Array.isArray(evidence.files) ? evidence.files : [];
  var files = evidenceFiles.length ? evidenceFiles : (res.files || []).map(basicSourceFileEvidence_);
  return {
    schemaVersion: Number(evidence.schemaVersion || 8),
    evidenceExtractor: String(evidence.evidenceExtractor || ''),
    evidenceBuildId: String(evidence.evidenceBuildId || ''),
    resourceId: idref,
    resourceType: String(res.type || ''),
    files: files,
    dependencies: (res.deps || []).slice(),
    links: Array.isArray(evidence.links) ? evidence.links : [],
    images: Array.isArray(evidence.images) ? evidence.images : [],
    embeddedRefs: Array.isArray(evidence.embeddedRefs) ? evidence.embeddedRefs : [],
    textSample: String(evidence.textSample || ''),
    textFormat: String(evidence.textFormat || ''),
    textNormalizationStatus: String(evidence.textNormalizationStatus || ''),
    textLength: nonNegativeInteger_(evidence.textLength),
    textSha256: String(evidence.textSha256 || ''),
    structuredAssessment: (evidence.structuredAssessment && typeof evidence.structuredAssessment === 'object') ? evidence.structuredAssessment : null,
    behavior: (evidence.behavior && typeof evidence.behavior === 'object') ? evidence.behavior : null,
    interactiveSignals: (evidence.interactiveSignals && typeof evidence.interactiveSignals === 'object') ? evidence.interactiveSignals : null,
    evidenceTruncated: evidence.evidenceTruncated === true
  };
}

export function create_analyzeImsccCore_(services) {
const {XmlService} = services;
return function analyzeImsccCore_(xmlString, fileName, sourceEvidenceJson) {
  try {
    xmlString = String(xmlString || "");
    if (!xmlString.trim()) return { success: false, error: "The manifest is empty." };
    if (xmlString.length > 12000000) return { success: false, error: "The manifest exceeds the 12 MB safety limit." };
    var document = XmlService.parse(xmlString);
    var root = document.getRootElement();
    if (String(root.getName()).toLowerCase() !== 'manifest') return { success: false, error: "The XML root element is not an IMS manifest." };
    var ns = root.getNamespace();
    var sourceEvidence = parseSourceEvidence_(sourceEvidenceJson);

    var resourcesNode = root.getChild('resources', ns);
    var resourceList = resourcesNode ? resourcesNode.getChildren('resource', ns) : [];
    if (resourceList.length > 20000) return { success: false, error: "The manifest exceeds the 20,000-resource safety limit." };

    var stats = { quizzes: 0, assignments: 0, lti: 0, webcontent: 0, discussions: 0, weblinks: 0, unknown: 0, hiddenPlugins: 0, interactiveRuntimeCandidates: 0, scormLikeCandidates: 0, practiceJsonDependencies: 0, totalResources: resourceList.length };
    var unknownTypesLog = Object.create(null), fileExtensionsLog = Object.create(null), resourceMap = Object.create(null); 

    for (var r = 0; r < resourceList.length; r++) {
      var res = resourceList[r], idAttr = res.getAttribute('identifier'), typeAttr = res.getAttribute('type');
      var resId = idAttr ? idAttr.getValue() : null, type = typeAttr ? typeAttr.getValue() : 'missing_type';
      
      var files = res.getChildren('file', ns), fileUrls = [];
      for(var f=0; f<files.length; f++){
         var hrefAttr = files[f].getAttribute('href');
         if(hrefAttr) {
             var hrefVal = hrefAttr.getValue(); fileUrls.push(hrefVal);
             var ext = hrefVal.toLowerCase().split('.').pop();
             if (ext && ext.length <= 4 && ext.indexOf('/') === -1) fileExtensionsLog[ext] = (fileExtensionsLog[ext] || 0) + 1;
             if (hrefVal.toLowerCase().indexOf('.json') > -1 || hrefVal.toLowerCase().indexOf('practice') > -1) stats.hiddenPlugins++;
         }
      }
      var deps = res.getChildren('dependency', ns), depIds = [];
      for(var d=0; d<deps.length; d++){ var dRef = deps[d].getAttribute('identifierref'); if(dRef) depIds.push(dRef.getValue()); }

      var resEvidence = (sourceEvidence.resources && sourceEvidence.resources[resId]) ? sourceEvidence.resources[resId] : null;
      if (resId) resourceMap[resId] = { type: type, files: fileUrls, deps: depIds, evidence: resEvidence };
      var runtimeSignals = resEvidence && resEvidence.interactiveSignals && typeof resEvidence.interactiveSignals === 'object' ? resEvidence.interactiveSignals : null;
      if (runtimeSignals && runtimeSignals.detected === true) {
        stats.interactiveRuntimeCandidates++;
        var families = Array.isArray(runtimeSignals.runtimeFamilies) ? runtimeSignals.runtimeFamilies : [];
        if (families.some(function(family){ return /SCORM|RISE|STORYLINE|AICC|TINCAN|XAPI/i.test(String(family || '')); })) stats.scormLikeCandidates++;
      }
      if (fileUrls.some(function(url){ return /\.practice\.json(?:$|[?#])/i.test(String(url || '')); })) stats.practiceJsonDependencies++;

      if (type.indexOf('imsqti') > -1) stats.quizzes++;
      else if (type.indexOf('assignment') > -1) stats.assignments++;
      else if (type.indexOf('imsbasiclti') > -1) stats.lti++;
      else if (type === 'webcontent' || type.indexOf('learning-application-resource') > -1) stats.webcontent++;
      else if (type.indexOf('imsdt') > -1) stats.discussions++;
      else if (type.indexOf('imswl') > -1) stats.weblinks++;
      else { stats.unknown++; unknownTypesLog[type] = (unknownTypesLog[type] || 0) + 1; }
    }

    var orgsNode = root.getChild('organizations', ns), defaultOrg = orgsNode ? orgsNode.getChild('organization', ns) : null;
    var rootItems = defaultOrg ? defaultOrg.getChildren('item', ns) : [];
    var startingItems = rootItems;
    if (rootItems.length === 1 && rootItems[0].getChildren('item', ns).length > 0) startingItems = rootItems[0].getChildren('item', ns);
    validateManifestItems_(startingItems, ns, 1, { count: 0 });
    
    var globalVisited = Object.create(null);
    var rawTree = buildCourseTree_(startingItems, ns, resourceMap, globalVisited);
    var courseTree = sanitizeAndFlattenTree_(rawTree);
    var orphans = 0; for (var k in resourceMap) { if (!globalVisited[k]) orphans++; }

    var allWords = [], allTitleKeys = [];
    function collectWords(nodes) {
      for(var i=0; i<nodes.length; i++) {
         if(nodes[i].title) { var titleText=String(nodes[i].title); var words = titleText.toLowerCase().match(/\b[a-z]+\b/g) || []; allWords = allWords.concat(words); var tk=titleText.toLowerCase().replace(/\d+/g,'#').replace(/[^a-z#]+/g,' ').replace(/\s+/g,' ').trim(); if(tk) allTitleKeys.push(tk); }
         if(nodes[i].children) collectWords(nodes[i].children);
      }
    }
    collectWords(rawTree);
    var uniqueWords = Object.create(null);
    for(var w=0; w<allWords.length; w++) uniqueWords[allWords[w]] = true;
    var lexicalTTR = allWords.length > 0 ? Number((Object.keys(uniqueWords).length / allWords.length).toFixed(2)) : 0;
    var titleFreq = Object.create(null), repeatedTitles = 0;
    allTitleKeys.forEach(function(key){ titleFreq[key]=(titleFreq[key]||0)+1; });
    Object.keys(titleFreq).forEach(function(key){ if(titleFreq[key] > 1) repeatedTitles += titleFreq[key]; });
    var repeatedTitleRatio = allTitleKeys.length ? Number((repeatedTitles / allTitleKeys.length).toFixed(2)) : 0;
    var lexicalContextReliable = allWords.length >= 20 && allTitleKeys.length >= 8;

    var l1Counts = [];
    for(var i=0; i<courseTree.length; i++) {
       var node = courseTree[i];
       if(node.type === 'folder' && !node.autoDeleted) {
           function countDesc(n) {
              var c = (n.children && n.children.length) ? n.children.length : 0;
              if(n.children) for(var j=0; j<n.children.length; j++) c += countDesc(n.children[j]);
              return c;
           }
           l1Counts.push({ title: node.title, count: countDesc(node) });
       }
    }
    var zScoreImbalances = [];
    if(l1Counts.length >= 4) {
        var sum = 0; for(var i=0; i<l1Counts.length; i++) sum += l1Counts[i].count;
        var mean = sum / l1Counts.length, varianceSum = 0;
        for(var i=0; i<l1Counts.length; i++) varianceSum += Math.pow(l1Counts[i].count - mean, 2);
        var stdDev = Math.sqrt(varianceSum / l1Counts.length) || 1;
        for(var i=0; i<l1Counts.length; i++) {
            var z = (l1Counts[i].count - mean) / stdDev;
            if(z > 1.75 && l1Counts[i].count >= mean + 3) zScoreImbalances.push({ title: l1Counts[i].title, count: l1Counts[i].count, zScore: z.toFixed(2), mean: mean.toFixed(1) });
        }
    }

    var emptyFolders = countEmptyFolders_(courseTree), coreEmptyCount = countCoreEmptyFolders_(courseTree, false);
    var combinedAssessments = stats.quizzes + stats.assignments;
    var riskMetrics = computeRiskMetrics_(stats.webcontent, combinedAssessments, stats.discussions, stats.weblinks, stats.lti, stats.unknown, emptyFolders);
    stats.emptyFolders = emptyFolders; stats.coreEmptyCount = coreEmptyCount; stats.totalItems = riskMetrics.totalItems; stats.ifs = riskMetrics.ifs; stats.ifsPerItem = riskMetrics.ifsPerItem; stats.ifsVersion = riskMetrics.ifsVersion; stats.isBoilerplate = riskMetrics.isBoilerplate; stats.orphans = orphans; stats.lexicalTTR = lexicalTTR; stats.lexicalTokenCount = allWords.length; stats.lexicalUniqueCount = Object.keys(uniqueWords).length; stats.lexicalContextReliable = lexicalContextReliable; stats.repeatedTitleRatio = repeatedTitleRatio; stats.zScoreImbalances = zScoreImbalances;

    var qtiNames = [];
    function extractQtis(nodes) {
       for (var i=0; i<nodes.length; i++) {
         if (nodes[i].type && nodes[i].type.indexOf('imsqti') > -1) qtiNames.push(nodes[i].title);
         if (nodes[i].children && nodes[i].children.length > 0) extractQtis(nodes[i].children);
       }
    }
    extractQtis(courseTree);

    var fingerprintedResources = sourceEvidence.resources ? Object.keys(sourceEvidence.resources).length : 0;
    var fingerprintedFiles = 0;
    if (sourceEvidence.resources) {
      Object.keys(sourceEvidence.resources).forEach(function(resourceId) {
        var resourceEvidence = sourceEvidence.resources[resourceId];
        if (resourceEvidence && Array.isArray(resourceEvidence.files)) fingerprintedFiles += resourceEvidence.files.length;
      });
    }
    stats.fingerprintedResources = fingerprintedResources;
    stats.fingerprintedFiles = fingerprintedFiles;
    stats.sourceEvidenceMode = sourceEvidence.manifestOnly ? 'manifest-only' : 'zip-fingerprint';

    return { success: true, fileName: String(fileName || 'package.imscc').trim(), moduleCount: courseTree.length, courseTree: courseTree, qtiNames: qtiNames, stats: stats, unknownTypesLog: unknownTypesLog, fileExtensionsLog: fileExtensionsLog };
  } catch (e) { return { success: false, error: "XML Parsing Error: " + e.toString() }; }
};
}

export function validateManifestItems_(items, ns, depth, state) {
  if (depth > 100) throw new Error("Manifest nesting exceeds the 100-level safety limit.");
  state.count += items.length;
  if (state.count > 50000) throw new Error("Manifest hierarchy exceeds the 50,000-item safety limit.");
  for (var i = 0; i < items.length; i++) { var children = items[i].getChildren('item', ns); if (children.length) validateManifestItems_(children, ns, depth + 1, state); }
}

export function resolveHiddenPlugins_(idref, resourceMap, visited, depth, globalVisited) {
    depth = depth || 0;
    if (depth > 200 || !idref || !resourceMap[idref] || visited[idref]) return [];
    visited[idref] = true; if (globalVisited) globalVisited[idref] = true; 
    var plugins = [], res = resourceMap[idref];
    for(var i=0; i<res.files.length; i++) {
       var f = res.files[i].toLowerCase();
       if (f.indexOf('.json') > -1 || f.indexOf('practice') > -1) plugins.push({ title: "Hidden Plugin (" + f.split('/').pop() + ")", type: "plugin", idref: null, children: [] });
    }
    for(var i=0; i<res.deps.length; i++) {
       if (globalVisited && res.deps[i]) globalVisited[res.deps[i]] = true; 
       plugins = plugins.concat(resolveHiddenPlugins_(res.deps[i], resourceMap, visited, depth + 1, globalVisited));
    }
    return plugins;
}

export function buildCourseTree_(items, ns, resourceMap, globalVisited) {
  var result = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i], titleNode = item.getChild('title', ns);
    var rawTitle = titleNode ? titleNode.getText() : "", cleanTitle = rawTitle.replace(/&nbsp;/g, ' ').replace(/\u00A0/g, ' ').trim();
    var idrefAttr = item.getAttribute('identifierref'), idref = idrefAttr ? idrefAttr.getValue() : null;
    if (idref) globalVisited[idref] = true;
    var metadataNode = item.getChild('metadata', ns), hasMetadata = metadataNode ? true : false;
    var children = item.getChildren('item', ns), childNodes = children.length > 0 ? buildCourseTree_(children, ns, resourceMap, globalVisited) : [];
    var nodeType = "folder", hiddenPlugins = [];
    if (idref && resourceMap[idref]) {
        nodeType = resourceMap[idref].type;
        hiddenPlugins = resolveHiddenPlugins_(idref, resourceMap, Object.create(null), 0, globalVisited);
    }
    var uniquePlugins = [], seen = Object.create(null);
    for(var p=0; p<hiddenPlugins.length; p++){
        if(!seen[hiddenPlugins[p].title]){ seen[hiddenPlugins[p].title] = true; uniquePlugins.push(hiddenPlugins[p]); }
    }
    childNodes = childNodes.concat(uniquePlugins);
    result.push({ title: cleanTitle, type: nodeType, idref: idref, sourcePayload: sourcePayloadForResource_(idref, resourceMap), children: childNodes, hasMetadata: hasMetadata });
  }
  return result;
}

export function processNode_(node, depth) {
  var flatChildren = [];
  for (var i = 0; i < node.children.length; i++) {
    var child = node.children[i];
    if (child.type === "folder" && !child.idref) flatChildren = flatChildren.concat(processNode_(child, depth + 1));
    else { child.children = processNode_(child, depth + 1); flatChildren.push(child); }
  }
  return flatChildren;
}

export function sanitizeAndFlattenTree_(nodes) {
  var cleaned = [];
  for (var i = 0; i < nodes.length; i++) {
    var moduleNode = nodes[i];
    moduleNode.children = processNode_(moduleNode, 1);
    if (moduleNode.type === 'folder' && moduleNode.children.length === 0 && !moduleNode.hasMetadata) moduleNode.autoDeleted = true;
    else if (!moduleNode.title && moduleNode.idref) moduleNode.title = "Untitled Resource";
    cleaned.push(moduleNode);
  }
  return cleaned;
}
