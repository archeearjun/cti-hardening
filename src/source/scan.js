import { manifestResourceRecords_ } from "./xml.js";
import { normalizeZipPath_, resolveZipHref_, resolveZipEntryV8_, uniqueStrings_ } from "./zip.js";
import { sha256Bytes_, perceptualHashBlob_, sha256Text_ } from "./hashes.js";
import { extractTextEvidence_, sourceBehaviorEvidence_, sourceInteractiveSignals_ } from "./content.js";
import { parseQtiAssessmentStructure_, qtiMediaPresence_, mergeStructuredAssessment_ } from "./qti.js";
import { extractPdfTextEvidence_ } from "./pdf.js";

export function notifyPackageProgress_(callback, update) {
   if (typeof callback === 'function') { try { callback(update); } catch (_) {} }
 }

export async function buildSourceEvidenceFromZip_(pdfServices, zip, xmlString, manifestPath, onProgress) {
    var evidence = {
      // v6.6.1 source-evidence schema 6 makes PDF semantic capability explicit.
      // Schema 4 existed both before and after the first PDF-text patch, which made
      // an old stored scan indistinguishable from a fresh extraction failure.
      schemaVersion: 8,
      extractor: 'CTI Source Evidence v6.8.7',
      buildId: 'v6.8.7-declared-assignment-attachments-20260926',
      capabilities: { declaredAssignmentAttachments: true, pdfText: true, dependencyPdfEvidence: true, pdfPageSemanticSamples: true, sourcePresenceState: true, qtiStructure: true, assignmentBehavior: true, interactivePackageSignals: true, sourceRuntimeSemantics: true },
      manifestOnly: false,
      manifestPath: manifestPath,
      resources: {},
      limits: { maxTextSample: 16000, maxFiles: 1800, maxTotalTextPayload: 900000, maxHashedFileBytes: 12000000, maxTotalHashBytes: 60000000, maxPdfTextBytes: 12000000, maxPdfPagesPerFile: 80, maxTotalPdfPages: 240 }
    };

    var manifestRecords = manifestResourceRecords_(xmlString);
    if (!manifestRecords.records.length) {
      var detail = manifestRecords.strictError || manifestRecords.repairedError || 'No resource records could be recovered.';
      throw new Error('imsmanifest.xml could not be read for source fingerprinting even after the compatibility pass. ' + detail);
    }
    evidence.manifestParse = {
      mode: manifestRecords.mode,
      repaired: manifestRecords.repaired === true,
      strictError: String(manifestRecords.strictError || '').slice(0, 500)
    };

    var zipLookup = Object.create(null);
    var zipPaths = Object.keys(zip.files).filter(function(path){return !zip.files[path].dir;});
    zipPaths.forEach(function(path) {
      zipLookup[normalizeZipPath_(path).toLowerCase()] = path;
    });

    var resources = manifestRecords.records;
    var inspectedCount = 0;
    var remainingTextBudget = evidence.limits.maxTotalTextPayload;
    var remainingHashBudget = evidence.limits.maxTotalHashBytes;
    var remainingPdfPageBudget = evidence.limits.maxTotalPdfPages;

    var lastProgressPaint = 0;
    for (var r = 0; r < resources.length; r++) {
      notifyPackageProgress_(onProgress, {phase:"Read content", completed:r, total:resources.length});
      if (onProgress && Date.now() - lastProgressPaint >= 100) { await new Promise(function(resolve) { setTimeout(resolve, 0); }); lastProgressPaint = Date.now(); }
      var res = resources[r];
      var resId = String(res.identifier || '');
      if (!resId) continue;

      var resourceEvidence = {
        schemaVersion: 8,
        evidenceExtractor: 'CTI Source Evidence v6.8.7',
        evidenceBuildId: 'v6.8.7-declared-assignment-attachments-20260926',
        files: [],
        links: [],
        images: [],
        embeddedRefs: [],
        textSample: '',
        textFormat: 'learner-text',
        textNormalizationStatus: 'NO_TEXT',
        textLength: 0,
        textSha256: '',
        structuredAssessment: null,
        behavior: null,
        interactiveSignals: null,
        evidenceTruncated: false
      };

      var resourceType = String(res.type || '').toLowerCase();
      var isQtiResource = resourceType.indexOf('imsqti') > -1 || resourceType.indexOf('qti') > -1;
      var textFragments = [];
      var behaviorFragments = [];
      var totalNormalizedLength = 0;
      var fileNodes = Array.isArray(res.files) ? res.files.slice() : [];
      var resourceHref = String(res.href || '');
      if (resourceHref && fileNodes.indexOf(resourceHref) === -1) fileNodes.unshift(resourceHref);
      resourceEvidence.dependencies = Array.isArray(res.dependencies) ? res.dependencies.slice() : [];
      resourceEvidence.resourceHref = resourceHref;
      var fileQueue=fileNodes.map(function(href){return {href:href,relativeTo:manifestPath};});
      var seenResourceFiles=Object.create(null);

      for (var f = 0; f < fileQueue.length; f++) {
        if (inspectedCount >= evidence.limits.maxFiles) {
          resourceEvidence.evidenceTruncated = true;
          break;
        }

        var queuedFile=fileQueue[f];
        var href = String(queuedFile.href || '');
        if (!href) continue;
        var fileIdentity=resolveZipHref_(queuedFile.relativeTo,href)||href;
        if(seenResourceFiles[fileIdentity])continue;
        seenResourceFiles[fileIdentity]=true;
        inspectedCount++;
        notifyPackageProgress_(onProgress, {phase:"Read content", completed:r, total:resources.length, file:href});
        if (onProgress && Date.now() - lastProgressPaint >= 100) { await new Promise(function(resolve) { setTimeout(resolve, 0); }); lastProgressPaint = Date.now(); }

        var resolved = resolveZipHref_(queuedFile.relativeTo, href);
        var zipResolution = resolveZipEntryV8_(zipLookup, zipPaths, queuedFile.relativeTo, href);
        var exactPath = zipResolution.path;
        var cleanHref = href.replace(/\\/g,'/').split('#')[0].split('?')[0];
        var name = (exactPath || resolved || cleanHref).replace(/\\/g,'/').split('/').pop() || cleanHref;
        var dot = name.lastIndexOf('.');
        var extension = dot > -1 ? name.slice(dot + 1).toLowerCase() : '';

        var fileEvidence = {
          href: href,
          path: exactPath || resolved || cleanHref,
          name: name,
          extension: extension,
          presentInPackage: !!exactPath,
          kind: 'asset',
          pathResolutionMethod: zipResolution.method,
          pathResolutionAmbiguous: zipResolution.ambiguous === true,
          pathResolutionCandidates: zipResolution.candidates || []
        };
        if(queuedFile.declaredBy){
          fileEvidence.evidenceSource='assignment-xml-attachment';
          fileEvidence.declaredBy=queuedFile.declaredBy;
          fileEvidence.attachmentRole=queuedFile.role||'';
        }

        if (exactPath && !zip.files[exactPath].dir) {
          var entry = zip.files[exactPath];
          var approxSize = entry._data && Number(entry._data.uncompressedSize)
            ? Number(entry._data.uncompressedSize)
            : null;
          fileEvidence.size = approxSize;

          // Cryptographic source-asset fingerprint. This lets the QA engine prove
          // a Coursera file is identical even when the filename changes.
          if ((!approxSize || approxSize <= evidence.limits.maxHashedFileBytes) && remainingHashBudget > 0) {
            try {
              var rawBytes = await entry.async('arraybuffer');
              if (rawBytes && rawBytes.byteLength <= evidence.limits.maxHashedFileBytes && rawBytes.byteLength <= remainingHashBudget) {
                fileEvidence.sha256 = await sha256Bytes_(rawBytes);
                fileEvidence.hashStatus = fileEvidence.sha256 ? 'SHA256' : 'UNAVAILABLE';
                if (/^(png|jpe?g|gif|webp)$/i.test(extension) && rawBytes.byteLength <= 6000000) {
                  var imageMime = extension === 'png' ? 'image/png' : (extension === 'gif' ? 'image/gif' : (extension === 'webp' ? 'image/webp' : 'image/jpeg'));
                  fileEvidence.perceptualHash = await perceptualHashBlob_(new Blob([rawBytes], { type: imageMime }));
                }
                remainingHashBudget -= rawBytes.byteLength;
              } else {
                fileEvidence.hashStatus = 'SKIPPED_SIZE';
              }
            } catch (hashError) {
              fileEvidence.hashStatus = 'ERROR';
            }
          } else {
            fileEvidence.hashStatus = 'SKIPPED_BUDGET';
          }

          var textLike = /^(html?|xhtml|xml|json|txt|md|csv|css|js)$/i.test(extension);
          if (textLike && (!approxSize || approxSize <= 2500000)) {
            try {
              var rawText = await entry.async('string');
              if (resourceType.indexOf('assignment') > -1 && /(?:file[ _-]+(?:upload|submission)|text[ _-]+submission|submission[ _-]+type|grade[ _-]+out[ _-]+of|attempts?)/i.test(rawText)) behaviorFragments.push(rawText.slice(0,16000));
              var parsedText = extractTextEvidence_(rawText, extension);
              (parsedText.declaredAttachments||[]).forEach(function(a){
                fileQueue.push({href:a.href,relativeTo:exactPath,declaredBy:exactPath,role:a.role});
              });
              var normalized = parsedText.normalizedText || '';
              if((parsedText.assignmentFormats||[]).indexOf('file')>=0)behaviorFragments.push('file submission');
              if((parsedText.assignmentFormats||[]).indexOf('text')>=0)behaviorFragments.push('text submission');
              if (normalized && (resourceType.indexOf('assignment') > -1 || /(?:file\s+(?:upload|submission)|text\s+submission|grade\s+out\s+of|attempts?)/i.test(normalized))) behaviorFragments.push(normalized.slice(0,12000));

              if (extension === 'xml' && (isQtiResource || /<(?:\w+:)?(?:assessmentItem|item)\b/i.test(rawText) && /<(?:\w+:)?(?:response_lid|responseDeclaration|choiceInteraction|response_str|textEntryInteraction)\b/i.test(rawText))) {
                var parsedAssessment = parseQtiAssessmentStructure_(rawText, exactPath || href);
                if(parsedAssessment)(parsedAssessment.questions||[]).forEach(function(q){q.mediaPresence=qtiMediaPresence_(q.mediaRefs,q.sourceFile||exactPath||href,zipLookup);});
                if (parsedAssessment) resourceEvidence.structuredAssessment = mergeStructuredAssessment_(resourceEvidence.structuredAssessment, parsedAssessment);
              }

              fileEvidence.textFormat = 'learner-text';
              fileEvidence.textLength = normalized.length;
              fileEvidence.textSha256 = await sha256Text_(normalized);
              fileEvidence.links = parsedText.links;
              fileEvidence.images = parsedText.images;
              fileEvidence.embeddedRefs = parsedText.refs;

              resourceEvidence.links = resourceEvidence.links.concat(parsedText.links || []);
              resourceEvidence.images = resourceEvidence.images.concat(parsedText.images || []);
              resourceEvidence.embeddedRefs = resourceEvidence.embeddedRefs.concat(parsedText.refs || []);

              totalNormalizedLength += normalized.length;

              if (normalized && remainingTextBudget > 0) {
                var fragmentLimit = Math.min(evidence.limits.maxTextSample, remainingTextBudget);
                var fragment = normalized.slice(0, fragmentLimit);
                if (fragment) {
                  textFragments.push(fragment);
                  fileEvidence.textSample = fragment;
                  remainingTextBudget -= fragment.length;
                }
              } else {
                fileEvidence.textSample = '';
                if (normalized) resourceEvidence.evidenceTruncated = true;
              }
            } catch (readError) {
              fileEvidence.readError = String(readError && readError.message || readError);
              fileEvidence.textNormalizationStatus = 'SOURCE_REFRESH_REQUIRED';
              resourceEvidence.textNormalizationStatus = 'SOURCE_REFRESH_REQUIRED';
              resourceEvidence.textFormat = 'unavailable';
            }
          }

          // v6.6.1: every transformation-relevant PDF gets an explicit parser/status
          // marker. This distinguishes an old source scan from a size/budget/library
          // limitation and prevents the QA report from repeatedly asking for a refresh
          // when the current scanner already attempted the document.
          var pdfRoleCandidate = extension === 'pdf' &&
            (resourceType.indexOf('assignment') > -1 || /(?:rubric|assessment|assignment|grading|instruction|direction)/i.test(name));
          if (pdfRoleCandidate) {
            if (approxSize && approxSize > evidence.limits.maxPdfTextBytes) {
              fileEvidence.pdfParser = 'skipped-size';
              fileEvidence.pdfReadError = 'PDF exceeds bounded text-extraction limit (' + evidence.limits.maxPdfTextBytes + ' bytes).';
            } else if (remainingPdfPageBudget <= 0) {
              fileEvidence.pdfParser = 'skipped-budget';
              fileEvidence.pdfReadError = 'Global source PDF page budget was exhausted before this document.';
            } else {
              try {
                var pdfBytes = await entry.async('arraybuffer');
                var pdfRole = /(?:rubric|grading)/i.test(name) ? 'rubric' : 'assignment';
                var pdfInfo = await extractPdfTextEvidence_(pdfServices, pdfBytes, Math.min(evidence.limits.maxPdfPagesPerFile, remainingPdfPageBudget), evidence.limits.maxTextSample, { fileName:name, role:pdfRole });
                remainingPdfPageBudget = Math.max(0, remainingPdfPageBudget - Number(pdfInfo.pagesRead || 0));
                fileEvidence.pdfParser = pdfInfo.parser || 'error';
                fileEvidence.pdfPageCount = Number(pdfInfo.pageCount || 0);
                fileEvidence.pdfPagesRead = Number(pdfInfo.pagesRead || 0);
                fileEvidence.pdfSampleStrategy = String(pdfInfo.sampleStrategy || '');
                fileEvidence.pdfPageSamples = Array.isArray(pdfInfo.pageSamples) ? pdfInfo.pageSamples.slice(0, 12) : [];
                if (pdfInfo.error) fileEvidence.pdfReadError = pdfInfo.error;
                var pdfText = String(pdfInfo.text || '').replace(/\s+/g, ' ').trim();
                if (pdfText) {
                  fileEvidence.textLength = pdfText.length;
                  fileEvidence.textSha256 = await sha256Text_(pdfText);
                  fileEvidence.textSample = pdfText.slice(0, evidence.limits.maxTextSample);
                  totalNormalizedLength += pdfText.length;
                  if (remainingTextBudget > 0) {
                    var pdfFragment = pdfText.slice(0, Math.min(evidence.limits.maxTextSample, remainingTextBudget));
                    if (pdfFragment) { textFragments.push(pdfFragment); remainingTextBudget -= pdfFragment.length; }
                  } else resourceEvidence.evidenceTruncated = true;
                }
              } catch (pdfError) {
                fileEvidence.pdfParser = 'error';
                fileEvidence.pdfReadError = String(pdfError && pdfError.message || pdfError || '').slice(0, 300);
              }
            }
          }
        }

        resourceEvidence.files.push(fileEvidence);
      }

      resourceEvidence.links = uniqueStrings_(resourceEvidence.links, 400);
      resourceEvidence.images = uniqueStrings_(resourceEvidence.images, 400);
      resourceEvidence.embeddedRefs = uniqueStrings_(resourceEvidence.embeddedRefs, 500);
      resourceEvidence.textLength = totalNormalizedLength;

      var combinedText = textFragments.join(' ').replace(/\s+/g, ' ').trim();
      resourceEvidence.textSample = combinedText.slice(0, evidence.limits.maxTextSample);
      if (resourceEvidence.textNormalizationStatus !== 'SOURCE_REFRESH_REQUIRED') resourceEvidence.textNormalizationStatus = combinedText ? 'NORMALIZED' : 'NO_TEXT';
      resourceEvidence.textSha256 = combinedText ? await sha256Text_(combinedText) : '';
      resourceEvidence.behavior = sourceBehaviorEvidence_(resourceType, behaviorFragments.join(' '), fileNodes);
      resourceEvidence.interactiveSignals = sourceInteractiveSignals_(resourceType, fileNodes, resourceHref);

      evidence.resources[resId] = resourceEvidence;
      notifyPackageProgress_(onProgress, {phase:"Read content", completed:r + 1, total:resources.length});
    }

    notifyPackageProgress_(onProgress, {phase:"Read content", detail:"Resolving dependencies and assessment associations.", completed:resources.length, total:resources.length});

    // v6.6.1: an Assignment may reference its Assessment/Rubric PDFs through
    // explicit manifest dependency resources. The previous source fingerprint kept
    // those concrete descriptors on the dependency node only, while the parent item
    // fell back to filename-only manifest references. Propagate PDF evidence across
    // explicit dependency edges for Assignment resources only. This is deterministic
    // manifest evidence, not title inference, and preserves the specific parser/hash.
    var recordById = Object.create(null);
    resources.forEach(function(rec) { if (rec && rec.identifier) recordById[String(rec.identifier)] = rec; });

    function sourcePdfIdentity_(file) {
      if (!file) return '';
      var hash = String(file.sha256 || '').toLowerCase();
      if (/^[0-9a-f]{64}$/.test(hash)) return 'sha:' + hash;
      var p = String(file.path || file.href || file.name || '').replace(/\\/g, '/').toLowerCase();
      return p ? 'path:' + p : '';
    }
    function propagateAssignmentDependencyPdfs_(resId, visiting) {
      var rec = recordById[resId], ev = evidence.resources[resId];
      if (!rec || !ev) return;
      visiting = visiting || Object.create(null);
      if (visiting[resId]) return;
      visiting[resId] = true;
      var isAssignmentParent = String(rec.type || '').toLowerCase().indexOf('assignment') > -1;
      (rec.dependencies || []).forEach(function(depIdRaw) {
        var depId = String(depIdRaw || '');
        if (!depId) return;
        propagateAssignmentDependencyPdfs_(depId, visiting);
        if (!isAssignmentParent) return;
        var depEv = evidence.resources[depId];
        if (!depEv || !Array.isArray(depEv.files)) return;
        var seen = Object.create(null);
        (ev.files || []).forEach(function(f) { var k = sourcePdfIdentity_(f); if (k) seen[k] = true; });
        depEv.files.forEach(function(f) {
          var ext = String(f && f.extension || '').toLowerCase();
          if (ext !== 'pdf') return;
          var k = sourcePdfIdentity_(f);
          if (!k || seen[k]) return;
          seen[k] = true;
          var clone = Object.assign({}, f);
          clone.evidenceSource = clone.evidenceSource || ('manifest-dependency:' + depId);
          clone.dependencyResourceId = depId;
          ev.files.push(clone);
        });
      });
      delete visiting[resId];
    }
    Object.keys(recordById).forEach(function(id) {
      if (String(recordById[id].type || '').toLowerCase().indexOf('assignment') > -1) propagateAssignmentDependencyPdfs_(id);
    });

    // v6.5.3+: Brightspace/Common Cartridge packages often place QTI XML on a
    // dependency resource or only in the resource href. Propagate structured
    // assessment evidence across explicit manifest dependency edges. This avoids
    // title-based guessing while preserving the item's true question model.
    var resolving = Object.create(null), resolved = Object.create(null);
    function resolveStructuredForResource_(resId) {
      if (!resId || resolved[resId]) return evidence.resources[resId] ? evidence.resources[resId].structuredAssessment : null;
      if (resolving[resId]) return null;
      resolving[resId] = true;
      var ev = evidence.resources[resId];
      var rec = recordById[resId];
      if (ev && rec) {
        (rec.dependencies || []).forEach(function(depId) {
          var depAssessment = resolveStructuredForResource_(String(depId || ''));
          if (depAssessment) ev.structuredAssessment = mergeStructuredAssessment_(ev.structuredAssessment, depAssessment);
        });
      }
      resolving[resId] = false;
      resolved[resId] = true;
      return ev ? ev.structuredAssessment : null;
    }
    Object.keys(recordById).forEach(resolveStructuredForResource_);

    // Conservative orphan-QTI rescue: only when there is exactly one unresolved
    // QTI resource and exactly one otherwise-unreferenced QTI XML in the package.
    // This handles vendor packages that omit <file>/<dependency> edges without
    // ever assigning one ambiguous assessment to another.
    var qtiResourceIds = resources.filter(function(rec) {
      var t = String(rec && rec.type || '').toLowerCase();
      return t.indexOf('imsqti') > -1 || t.indexOf('qti') > -1;
    }).map(function(rec) { return String(rec.identifier || ''); }).filter(Boolean);
    var unresolvedQtiIds = qtiResourceIds.filter(function(id) {
      return !(evidence.resources[id] && evidence.resources[id].structuredAssessment);
    });
    if (unresolvedQtiIds.length === 1) {
      var referencedPaths = Object.create(null);
      resources.forEach(function(rec) {
        var refs = (rec.files || []).slice();
        if (rec.href) refs.push(rec.href);
        refs.forEach(function(href) {
          var rp = resolveZipHref_(manifestPath, href);
          if (rp) referencedPaths[String(rp).toLowerCase()] = true;
        });
      });
      var orphanAssessments = [];
      var zipPaths = Object.keys(zip.files).filter(function(path){return !zip.files[path].dir;});
      for (var zi = 0; zi < zipPaths.length && orphanAssessments.length < 3; zi++) {
        var zp = zipPaths[zi], ze = zip.files[zp];
        if (!ze || ze.dir || !/\.xml$/i.test(zp) || referencedPaths[String(normalizeZipPath_(zp)).toLowerCase()]) continue;
        try {
          var ztxt = await ze.async('string');
          if (!/(<(?:\w+:)?(?:assessmentItem|item)\b)/i.test(ztxt)) continue;
          if (!/(<(?:\w+:)?(?:response_lid|responseDeclaration|choiceInteraction|response_str|textEntryInteraction)\b)/i.test(ztxt)) continue;
          var zassess = parseQtiAssessmentStructure_(ztxt, zp);
          if (zassess && zassess.questions && zassess.questions.length) orphanAssessments.push(zassess);
        } catch (orphanErr) {}
      }
      if (orphanAssessments.length === 1) {
        evidence.resources[unresolvedQtiIds[0]].structuredAssessment = orphanAssessments[0];
        evidence.resources[unresolvedQtiIds[0]].structuredAssessmentAssociation = 'single-unresolved-qti-single-orphan-xml';
      }
    }

    evidence.qtiDiagnostics = {
      qtiResources: qtiResourceIds.length,
      qtiWithStructure: qtiResourceIds.filter(function(id) {
        return evidence.resources[id] && evidence.resources[id].structuredAssessment;
      }).length,
      unresolvedQtiResources: qtiResourceIds.filter(function(id) {
        return !(evidence.resources[id] && evidence.resources[id].structuredAssessment);
      })
    };
    evidence.inspectedFiles = inspectedCount;
    evidence.resourceCount = Object.keys(evidence.resources).length;
    evidence.remainingTextBudget = remainingTextBudget;
    evidence.remainingHashBudget = remainingHashBudget;
    evidence.remainingPdfPageBudget = remainingPdfPageBudget;
    return evidence;
  }
