
function ctiWorkflowIo_() {
  return {
    openWorkbook:function(id){return SpreadsheetApp.openById(id);},
    importWorkbook:ctiImportXlsxAsSheet_,
    validateWorkbook:validateWorkflowFileId_,
    registerWorkbook:registerWorkflowFileId_,
    getTemporaryFile:function(id){return DriveApp.getFileById(id);},
    loadPackage:fetchPackageStructureDb,
    loadGeneration:qaLoadGenerationEvidenceContext_,
    externalRuntime:qaExternalRuntimeEvidenceForPackage_,
    persistRun:persistQaRun_
  };
}
