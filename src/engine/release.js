// Maintained source: explicit dependencies; no ordered concatenation.


export const CTI_ARCHITECTURE_VERSION_ = 'evidence-integrity-modular-monolith-v1.4';

export const CTI_RELEASE_REGISTRY_ = Object.freeze({
  gateway:'v8.0.0',
  qaEngine:'v8.0.0',
  architecture:CTI_ARCHITECTURE_VERSION_,
  courseraExtractor:{version:'v6.14.7',schema:34,build:'v6.14.7-plugin-readiness-20260929',delivery:'CODE_GS_CANONICAL'},
  brightspaceExtractor:{version:'v1.0.8',schema:2,build:'v1.0.8-described-counts-20260930',delivery:'CODE_GS_CANONICAL'},
  evidenceEnvelopeSchema:1,
  qaRunSchema:5,
  macmillanTimeModel:'m2-leaf-evidence-20260911'
});

// Historical engine contract retained for old result/fixture compatibility.
// These flags are NOT a Cloudflare product-availability manifest. Several old
// operational workflows are missing; see docs/audits/code-gs-audit.md and its
// exhaustive parity ledger before reporting feature availability.
export const CTI_FEATURE_MANIFEST_ = Object.freeze({
  sourcePackage:{imscc:true,zip:true,xml:true,fingerprint:true,qti:true,pdfEvidence:true,preflight:true,ifs:true,advancedMetrics:true,googleSheetExport:true},
  operations:{workQueue:true,campaignFilters:true,catalogSync:true,ownerResolution:true,auditExistingShellFirst:true,stateMachine:true},
  directory:{courseLibrary:true,search:true,explore:true,deepAudit:true,aiTriage:true,rescan:true,bulkRescan:true,editDetails:true,delete:true,duplicateReview:true,duplicateArchive:true,systemHealth:true},
  qa:{singleSnapshot:true,lifecycle:true,excelStructuralAuthority:true,courseraExtractor:true,brightspaceLiveSource:true,assessmentFidelity:true,assignmentBehavior:true,runtimeEvidence:true,hiddenDependencies:true,extraItems:true,keepReviewReingest:true,smartIngestionProvenance:true,oneToManyTransformations:true,destinationReadiness:true,generationProvenanceMemory:true,manualChangeAttribution:true,currentStateResolution:true,historicalFindingResolution:true,fieldScopedSemanticComparison:true,policyAwareOperatorGuidance:true,ingestionActionability:true,assignmentOwnerPlainLanguage:true,qaGlossary:true,repackagedSemanticReconciliation:true,discussionIdentityReconciliation:true},
  evidenceMemory:{savedReports:true,generationLineage:true,snapshotStages:true,humanLabels:true,reviewerNotes:true,futureMlDataset:true,generationSmartIngestionProvenance:true,manualChangeAttribution:true,currentStateResolutionLedger:true},
  macmillan:{stage1:true,stage2:true,stage3:true,stage4:true,stage5:true,timePolicy:true,exclusionTriage:true,gptContracts:true,contractQa:true,timeConservation:true,partnerArtifact:true},
  platform:{authorization:true,editorRole:true,optimisticVersioning:true,scriptLocks:true,caching:true,telemetry:true,featureManifest:true,releaseRegistry:true}
});
