# Set up the shared CTI workspace

Keep the existing Apps Script app available while you configure and verify the
new workspace. The migrated workflows can already run in **local mode**. Local
mode saves only in that browser; it is not shared with colleagues.

This setup uses the existing Cloudflare Pages project, Cloudflare D1 and
Cloudflare Access. Use **Free** plans only. No installation is required on a
work laptop. Free services have request, storage and user limits; this is not
an unlimited-storage promise. Do not select a paid subscription to continue.

## 1. Create the database in the dashboard

1. In Cloudflare, open **Storage & databases → D1 SQL database → Create**.
2. Name it `cti-workspace`.
3. Open its **Console**. Copy and run the complete contents of
   [server/schema.sql](../server/schema.sql). It creates the tables and indexes;
   it does not delete existing data.
4. Open **Workers & Pages → cti-hardening → Settings → Bindings → Add → D1**.
   Set the variable name to **`CTI_DB`** and choose `cti-workspace`.

## 2. Configure team sign-in

1. Open **Zero Trust** and choose its **Free** plan. Choose your team name.
2. In the Pages project, open **Settings → General → Enable access policy**.
   Use **Manage** to open the generated preview Access application. Under its
   public hostname, remove the wildcard subdomain so it protects
   **`cti-hardening.pages.dev`**, then save. Re-enable the Pages access policy to
   create a separate preview policy. Verify that both production and preview
   hostnames are covered. No custom domain purchase is required. Cloudflare's
   [Pages Access instructions](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain)
   describe this production-versus-preview distinction.
3. Create an **Allow** policy containing the specific coworkers' email addresses
   who should use CTI. Use email one-time PIN or your organisation's existing
   identity provider. Do not use a public Bypass policy.
4. Copy the application **Audience (AUD)** and team domain
   (`https://YOUR-TEAM.cloudflareaccess.com`).
5. In the Pages project's **Settings → Variables and Secrets**, add these
   **production** values:

| Variable | Value |
| --- | --- |
| `CTI_ACCESS_ISSUER` | Your complete `https://…cloudflareaccess.com` team URL |
| `CTI_ACCESS_AUD` | The Access application's audience tag |
| `CTI_ADMINS` | Your email; comma-separated if more than one administrator |
| `CTI_EDITORS` | Coworkers who may change records, comma-separated |
| `NODE_VERSION` | `24` |

Everyone admitted by the Access policy who is not an admin or editor has
**read-only** access to the team catalogue, reports and downloads. Admins and
editors can edit all team course records; the Owner field is an assignment,
not a private access boundary. Admins additionally import legacy backup records.
The API verifies the signed Access token itself. Missing configuration or an
invalid token is rejected even if someone knows a preview URL.

Cloudflare currently advertises Access Free for teams under 50 users. Its
signup flow may require account/billing verification; do not choose a paid plan
or assume that a credit card is required by CTI. If your work policy blocks
that signup, keep using the existing Apps Script app for shared work.

## 3. Redeploy and verify the connection

Keep the existing Pages build settings: branch `codex/typescript-pages-migration`,
build `npm run build`, output **`dist`**, repository root blank. Save the binding
and variables, then create a new deployment of the latest commit.

Open the site, sign in and choose **Full CTI workspace → Setup → Connect shared
workspace**. The banner must say **Shared team workspace**, your email and your
role. A local-mode banner is not confirmation of shared storage. The selected
mode is remembered for this browser.

If setup is incomplete, CTI displays an error and does not pretend that local
records are shared. Do not remove authentication to make the error disappear.

## Optional: background Coursera extraction

The shared catalogue, D1 and Access setup above can remain on the current free
configuration. Background Coursera extraction is an optional additional service
with Browser Run/Workflows/R2 requirements and different usage limits. Do not
enable it by weakening Access or making the extractor Worker public.

If your organisation approves that capability, follow
[background Coursera extraction](background-coursera-extraction.md). Long
Coursera shell runs exceed Browser Run's Free-plan 10 browser minutes/day, so
treat the Browser Run plan/cost as a separate deployment decision from the
shared workspace.

## 4. Bring over existing Apps Script records

You do not need to replace the entire old app just to export its data:

1. Open your existing Apps Script project. Add a script file named
   **`MigrationExport.gs`**.
2. Paste the small helper from
   [migration-export.js](../archive/apps-script/migration-export.js).
   If that function is already installed, do not add a second definition.
3. Run **`exportCtiWorkspaceForMigration`**. The existing editor authorization
   still applies. The log shows elapsed minutes and part progress, then a
   **COMPLETE** message linking a new private Drive folder. The helper does not
   delete or change old records. It writes bounded JSON parts instead of one
   oversized file; changing only the old `createFile` overload is insufficient.
   Download **all** JSON files in that folder. If Drive downloads a ZIP, extract
   it on your computer. `00_manifest.json` is written last: without it, the
   export is incomplete and must not be imported. A failed run can be rerun;
   each run uses a different folder and never mixes parts with a previous run.
4. Wait for the updated site deployment, open **Setup**, and connect the shared
   workspace as an admin. In **Workspace migration or backup JSON**, select
   **00_manifest.json and every part file together**, from one completed export
   folder. CTI checks the part count, export identity, UTF-8 byte counts and
   SHA-256 digests before preparing records. Review counts and warnings, then
   click **Import prepared records**. Existing single-file migrations and
   browser workspace backups still work. Missing or corrupt parts stop the
   import before any records are saved.
5. Historical exports can contain duplicate package rows that were legitimate
   evidence in the old database. Admin migration import preserves those rows
   instead of dropping them. After import, open **Operations → Duplicate
   reconciliation**: CTI previews semantic duplicate groups, blocks metadata
   conflicts, preserves the stable survivor/newest scan and soft-archives
   duplicates without deleting evidence.
6. Check catalogue counts, course UUIDs, owners, source trees, several old
   reports, duplicate groups, and before/after history before relying on the
   new workspace.

If preparation reports **Some saved reports need recovery**, the export files
passed their checks but one or more historical QA payloads are incomplete or
invalid. Download **migration review** to identify each run and its chunk
diagnostics. The old app writes a history row before writing the report chunks;
a failed second write can leave a history entry without a complete report.
This is one possible cause, not proof of what happened to a particular run.

You can explicitly acknowledge these gaps and import valid records. Missing
reports are not treated as complete audits, do not contribute to comparisons,
and remain listed in Setup and the affected course's History. The import retains
their history metadata as recovery cases and all original sheets/chunks in the
backup. Keep the original export, especially if saving is interrupted. Recovering
a complete payload from the old workspace or a prior backup lets you import that
report later under its original Run ID; this clears its open recovery warning.
Damaged source trees and missing/corrupt export parts still stop preparation.
Confirm **Import destination: Shared workspace** before a shared migration;
**This browser only** stores records locally and is not shared storage.

The export includes all database sheets, chunked source trees and full reports,
work-state rows, external-runtime evidence, the three email/domain permission
settings, and this account's registered Macmillan master workbooks. Access
policies are not silently recreated from Google settings: use the exported
settings to configure the intended Access allowlist and editor roles.

Google's master-workbook registry is per account and retains up to five active
IDs. Other owners can run their own export, or upload their saved XLSX master
workbooks separately. Export warnings identify inaccessible workbooks. Existing
source packages and original evidence files remain in their original folders;
this is a records export, not a copy of all Drive files.

Import preserves course and audit IDs, skips existing IDs and never overwrites
stored audits. Unknown tables stay in the original backup. Large original exports are retained
as checksummed backup-part records plus an index, each below the existing
per-record limit; no evidence is dropped to fit. Workspace recovery backups
include those records. `restoreMigrationBackup` can reconstruct the original
export from its index and parts. Preparation rejects any oversized individual
course, report or workbook before saving any records, identifying the record
that needs a targeted migration fix. A failed or stopped import can be retried:
CTI refreshes saved IDs and skips the ones already imported. Unlinked old
checklists can be assigned to a course in **Work queue**. Generation `0` retains the old app’s original-import convention; it is not
silently converted to re-ingestion 1.

## 5. Verify collaboration before retiring the old app

- Have an editor save a course detail and a second user load the same record.
- Have a viewer confirm that viewing/download work and saving is unavailable.
- Open the same course in two editor tabs; a stale second save must report a
  conflict, not overwrite the first.
- Compare one retained complete source/XLSX/JSON set with its accepted old
  report. Then verify a saved raw/current pair and one Macmillan stage chain.
- Download a recovery backup. Keep original IMSCC/XLSX/capture files separately.

The backup button exports the current catalogue, full saved audit records,
workbooks and checklists. It does not flatten report payloads to visible fields.
It does not include superseded catalogue/workbook revisions; these remain in
D1. Use D1's database export for a complete revision-level backup.

## Limits and recovery

Each saved artifact has a **32 MiB** limit; chunks are 128 KiB. Audits are
immutable. Other edits create retained versions with optimistic concurrency.
Incomplete uploads never appear as saved records. Normal package writes use an
atomic semantic-identity claim so simultaneous creates/restores/renames cannot
silently create the same active partner+course identity. The admin-only migration
path is the explicit exception because it must preserve historical duplicates
for later lossless reconciliation. Monitor D1 storage and Pages Functions usage in Cloudflare. Stay on Free: reaching limits can make shared
operations unavailable; it does not make a comparison more complete.

To reclaim abandoned uploads older than seven days without touching saved
revisions, an administrator can run this in the D1 console:

```sql
DELETE FROM chunks WHERE upload_id IN (
  SELECT id FROM uploads WHERE committed=0
    AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')
);
DELETE FROM uploads WHERE committed=0
  AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days');
```

If an import stops halfway, reconnect, reload the catalogue and import the same
file again. Preserved IDs make completed records safe to skip. Keep the original
export until reconciliation is finished.

Uploads retry temporary network, timeout, HTTP 429 and server failures up to three
attempts for each evidence chunk. A repeated chunk is checked against its saved
digest. Upload creation and final commit are not automatically repeated. Import
progress identifies the record and chunk; failures show the HTTP status and a
Cloudflare Ray ID when available. If the service asks for a delay over 30 seconds,
the import stops and reports that delay instead of retrying early. Stop also
cancels active uploads and retry waits. A generic failure from an older deployment
does not establish whether the cause was connectivity, authentication or a service
limit; retry with the updated client to retain the diagnostic details.

Official references: [D1 dashboard setup](https://developers.cloudflare.com/d1/get-started/),
[Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/),
[Access token verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
[Access plans](https://www.cloudflare.com/plans/zero-trust-services/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/).
