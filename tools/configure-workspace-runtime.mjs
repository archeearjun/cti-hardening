import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Keep the maintained configuration deployable by dry-run without embedding a
 * production database identity. Deployment reads the already configured Pages
 * binding; it neither provisions a database nor changes any plan. */
export function bindWorkspaceDatabase(config, project) {
  const binding = project?.deployment_configs?.production?.d1_databases?.CTI_DB;
  const id = binding?.id || binding?.database_id;
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id))
    throw Error('The production Pages CTI_DB binding is missing or invalid. No runtime was deployed.');
  if (!Array.isArray(config.d1_databases) || config.d1_databases.filter(value => value.binding === 'CTI_DB').length !== 1)
    throw Error('The maintained runtime must contain exactly one CTI_DB binding.');
  return { ...config, d1_databases: config.d1_databases.map(value => value.binding === 'CTI_DB' ? { ...value, database_id: id } : value) };
}

export function assertWorkspaceRuntimeBindings(config, settings) {
  const databaseId = config.d1_databases?.find(value => value.binding === 'CTI_DB')?.database_id;
  const bindings = Array.isArray(settings?.bindings) ? settings.bindings : [];
  if (!databaseId || !bindings.some(value => value.type === 'd1' && value.name === 'CTI_DB' && value.id === databaseId))
    throw Error('The deployed private runtime does not use the configured Pages database.');
  if (!bindings.some(value => value.type === 'durable_object_namespace' && value.name === 'WORKSPACE_RUNTIME' && value.class_name === 'WorkspaceRuntime' && typeof value.namespace_id === 'string' && value.namespace_id.length > 0))
    throw Error('The deployed private runtime Durable Object binding is missing.');
  if (!Array.isArray(settings?.compatibility_flags) || !config.compatibility_flags?.every(flag => settings.compatibility_flags.includes(flag)))
    throw Error('The deployed private runtime compatibility flags do not preserve request cancellation.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const projectName = process.env.CF_PAGES_PROJECT;
  const configPath = process.env.WORKER_CONFIG;
  if (!token || !account || projectName !== 'cti-hardening' || configPath !== 'workers/coursera-extractor/wrangler.jsonc')
    throw Error('Workspace runtime deployment configuration is incomplete.');
  if (process.argv.includes('--verify')) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/cti-coursera-extractor/settings`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error(`Reading deployed runtime bindings failed: HTTP ${response.status}.`);
    const data = await response.json();
    if (data?.success !== true) throw Error('Reading deployed runtime bindings did not succeed.');
    assertWorkspaceRuntimeBindings(JSON.parse(fs.readFileSync(configPath, 'utf8')), data.result);
    console.log('Verified deployed WorkspaceRuntime and the unchanged Pages CTI_DB identity.');
    console.log('Verified deployed private runtime request-signal compatibility flags.');
    process.exit(0);
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${projectName}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Reading the configured Pages database failed: HTTP ${response.status}.`);
  const data = await response.json();
  if (data?.success !== true) throw Error('Reading the configured Pages database did not succeed.');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  fs.writeFileSync(configPath, JSON.stringify(bindWorkspaceDatabase(config, data.result), null, 2) + '\n');
  console.log('Workspace runtime uses the existing Pages CTI_DB binding. No database or plan was created.');
}
