// Paste this whole helper into MigrationExport.gs in the existing CTI project.
// It reads existing records and creates a new Drive folder; it changes no source data.
function exportCtiWorkspaceForMigration() {
  authorize_('editor');
  var started = Date.now();
  function progress(message) {
    Logger.log(((Date.now() - started) / 60000).toFixed(1) + ' min — ' + message);
  }
  progress('Reading CTI database sheets.');
  var ss = getDatabaseSheet_().getParent();
  var out = {
    kind: 'CTI_WORKSPACE_MIGRATION', schemaVersion: 1,
    exportedAt: new Date().toISOString(), sheets: {},
    externalRuntimeByPackage: {}, workbooks: [], warnings: [], accessPolicy: {}
  };
  ss.getSheets().forEach(function(sheet) {
    out.sheets[sheet.getName()] = sheet.getDataRange().getValues();
  });
  var rows = out.sheets[PACKAGES_SHEET_NAME] || [];
  rows.slice(1).forEach(function(row) {
    if (row[18]) {
      out.externalRuntimeByPackage[String(row[18])] =
        qaExternalRuntimeEvidenceForPackage_({partner: row[1], fileName: row[2]});
    }
  });
  var props = PropertiesService.getScriptProperties();
  ['AUTHORIZED_DOMAIN', 'AUTHORIZED_EMAILS', 'EDITOR_EMAILS'].forEach(function(key) {
    out.accessPolicy[key] = props.getProperty(key) || '';
  });
  var ids = [];
  try {
    ids = JSON.parse(PropertiesService.getUserProperties()
      .getProperty('ACTIVE_MASTER_FILE_IDS') || '[]');
    if (!Array.isArray(ids)) throw new Error('Expected a workbook list.');
  } catch (e) {
    ids = [];
    out.warnings.push('Registered master workbook list could not be read.');
  }
  ids.forEach(function(id) {
    try {
      progress('Reading registered master workbook ' + id + '.');
      var book = SpreadsheetApp.openById(id);
      var entry = {id: id, name: book.getName(), sheets: {}};
      book.getSheets().forEach(function(sheet) {
        var range = sheet.getDataRange();
        entry.sheets[sheet.getName()] = {
          values: range.getValues(), display: range.getDisplayValues()
        };
      });
      out.workbooks.push(entry);
    } catch (e) {
      out.warnings.push('Master workbook ' + id + ' could not be exported: ' + e.message);
    }
  });
  out.warnings.push('Only this account’s registered master workbooks were exported. Other owners can export their own registered workbooks, or download and import those XLSX files separately.');
  progress('Preparing migration parts.');
  var text = JSON.stringify(out);
  var exportId = Utilities.getUuid();
  var folder = DriveApp.createFolder('CTI_workspace_migration_' + exportId);
  var folderUrl = folder.getUrl();
  progress('Output folder: ' + folderUrl + ' — incomplete until 00_manifest.json exists.');
  var manifest = {
    kind: 'CTI_WORKSPACE_MIGRATION_MANIFEST', schemaVersion: 1,
    exportId: exportId, exportedAt: out.exportedAt,
    packageCount: Math.max(0, rows.length - 1),
    charCount: text.length, utf8Bytes: 0, partCount: 0, parts: []
  };
  // At most 1 million UTF-16 units per fragment. Even JSON escaping stays below 6.1 MB.
  var maxChars = 1000000;
  for (var start = 0; start < text.length;) {
    var end = Math.min(start + maxChars, text.length);
    var last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xD800 && last <= 0xDBFF) end--;
    var fragment = text.slice(start, end);
    var bytes = Utilities.newBlob(fragment, 'application/json').getBytes();
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
      .map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); })
      .join('');
    var index = manifest.parts.length;
    var fileName = 'part_' + ('000000' + (index + 1)).slice(-6) + '_' + exportId + '.json';
    folder.createFile(Utilities.newBlob(JSON.stringify({
      kind: 'CTI_WORKSPACE_MIGRATION_PART', schemaVersion: 1,
      exportId: exportId, index: index, data: fragment
    }), 'application/json', fileName));
    manifest.parts.push({
      index: index, fileName: fileName, sha256: digest,
      charCount: fragment.length, utf8Bytes: bytes.length
    });
    manifest.utf8Bytes += bytes.length;
    start = end;
    progress('Saved part ' + (index + 1) + ' — ' + Math.floor(start / text.length * 100) + '% of export written.');
  }
  manifest.partCount = manifest.parts.length;
  // Write the completion manifest LAST. A failed run must never look complete.
  folder.createFile(Utilities.newBlob(JSON.stringify(manifest, null, 2),
    'application/json', '00_manifest.json'));
  progress('COMPLETE: ' + manifest.partCount + ' parts plus 00_manifest.json. ' + folderUrl);
  return {
    success: true, url: folderUrl, folderUrl: folderUrl,
    packageCount: manifest.packageCount, partCount: manifest.partCount,
    note: 'Download every JSON in this folder. In CTI Setup, select 00_manifest.json and ALL part files together. Existing records were not changed.'
  };
}
