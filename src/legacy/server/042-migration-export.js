
// Run once in the authorized existing Apps Script project. This exports records,
// not access tokens or API keys, and does not delete or modify existing data.
function exportCtiWorkspaceForMigration() {
  authorize_('editor');
  var ss = getDatabaseSheet_().getParent();
  var out = {kind:'CTI_WORKSPACE_MIGRATION',schemaVersion:1,exportedAt:new Date().toISOString(),sheets:{},externalRuntimeByPackage:{},workbooks:[],warnings:[],accessPolicy:{}};
  ss.getSheets().forEach(function(sheet){out.sheets[sheet.getName()]=sheet.getDataRange().getValues();});
  var rows = out.sheets[PACKAGES_SHEET_NAME] || [];
  rows.slice(1).forEach(function(row){if(row[18])out.externalRuntimeByPackage[String(row[18])]=qaExternalRuntimeEvidenceForPackage_({partner:row[1],fileName:row[2]});});
  var props=PropertiesService.getScriptProperties();
  ['AUTHORIZED_DOMAIN','AUTHORIZED_EMAILS','EDITOR_EMAILS'].forEach(function(key){out.accessPolicy[key]=props.getProperty(key)||'';});
  var ids=[];try{ids=JSON.parse(PropertiesService.getUserProperties().getProperty('ACTIVE_MASTER_FILE_IDS')||'[]');}catch(e){out.warnings.push('Registered master workbook list could not be read.');}
  ids.forEach(function(id){try{var book=SpreadsheetApp.openById(id),entry={id:id,name:book.getName(),sheets:{}};book.getSheets().forEach(function(sheet){entry.sheets[sheet.getName()]={values:sheet.getDataRange().getValues(),display:sheet.getDataRange().getDisplayValues()};});out.workbooks.push(entry);}catch(e){out.warnings.push('Master workbook '+id+' could not be exported: '+e.message);}});
  out.warnings.push('Only this account’s registered master workbooks were exported. Other owners can export their own registered workbooks, or download and import those XLSX files separately.');
  var file=DriveApp.createFile(Utilities.newBlob(JSON.stringify(out),'application/json','CTI_workspace_migration_'+new Date().getTime()+'.json'));
  Logger.log(file.getUrl());
  return {success:true,url:file.getUrl(),packageCount:Math.max(0,rows.length-1),note:'Download this private JSON, then import it into the new workspace. Existing records were not changed.'};
}
