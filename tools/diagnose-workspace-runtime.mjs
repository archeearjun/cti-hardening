// Read-only production diagnostics. Never print credentials, record metadata,
// response bodies, signed media URLs or individual document/upload identities.
// D1 POSTs execute only the constant aggregate SELECT statements below.
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.log(JSON.stringify({ configured: false }));
  process.exit(0);
}
const origin = 'https://api.cloudflare.com/client/v4';
const report = { checkedAt: new Date().toISOString(), readOnly: true };
async function request(path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  if (raw.length > 2 * 1024 * 1024) throw new Error('DIAGNOSTIC_RESPONSE_TOO_LARGE');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`NON_JSON_HTTP_${response.status}`); }
  if (!response.ok || parsed.success === false || parsed.errors?.length) {
    // Cloudflare error codes are safe; do not print arbitrary upstream messages.
    throw new Error(`HTTP_${response.status}_CODES_${(parsed.errors || []).map(e => Number(e.code) || 'GRAPHQL').slice(0, 5).join('_')}`);
  }
  return parsed;
}
async function inspect(key, fn) {
  try { report[key] = await fn(); }
  catch (error) { report[key] = { available: false, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'DIAGNOSTIC_REQUEST_FAILED' }; }
}
let database;
await inspect('pagesRuntime', async () => {
  const { result } = await request(`/accounts/${account}/pages/projects/cti-hardening`);
  const config = result?.deployment_configs?.production || {};
  const binding = config.d1_databases?.CTI_DB;
  database = binding?.id || binding?.database_id;
  if (database && !/^[a-f0-9-]{36}$/i.test(database)) database = undefined;
  return {
    d1Bound: Boolean(database), usageModel: config.usage_model || null,
    cpuMs: config.limits?.cpu_ms ?? null,
    compatibilityDate: config.compatibility_date || null,
  };
});
if (database) {
  await inspect('d1Size', async () => {
    const { result } = await request(`/accounts/${account}/d1/database/${database}`);
    return { fileSize: result?.file_size ?? null, version: result?.version ?? null };
  });
  const queries = {
    uploads: 'SELECT committed, COUNT(*) AS upload_count, SUM(bytes) AS declared_bytes, MIN(created_at) AS oldest, MAX(created_at) AS newest FROM uploads GROUP BY committed',
    chunks: 'SELECT u.committed, COUNT(c.part) AS chunk_count, COALESCE(SUM(c.bytes),0) AS retained_bytes FROM uploads u LEFT JOIN chunks c ON c.upload_id=u.id GROUP BY u.committed',
    documents: 'SELECT kind, COUNT(*) AS document_count FROM documents GROUP BY kind',
  };
  for (const [name, sql] of Object.entries(queries)) {
    await inspect(name, async () => {
      const { result } = await request(`/accounts/${account}/d1/database/${database}/query`, { sql });
      return (result || []).map(r => ({ results: r.results, rowsRead: r.meta?.rows_read, rowsWritten: r.meta?.rows_written }));
    });
  }
}
const end = new Date();
const start = new Date(end.getTime() - 6 * 3600000);
const variables = { accountTag: account, start: start.toISOString(), end: end.toISOString() };
report.window = { start: variables.start, end: variables.end };
await inspect('workerOutcomes', async () => {
  const query = 'query($accountTag:string,$start:string,$end:string,$scriptName:string){viewer{accounts(filter:{accountTag:$accountTag}){workersInvocationsAdaptive(limit:100,filter:{scriptName:$scriptName,datetime_geq:$start,datetime_leq:$end}){dimensions{scriptName status}sum{requests errors subrequests}quantiles{cpuTimeP50 cpuTimeP99}}}}}';
  const data = await request('/graphql', { query, variables: { ...variables, scriptName: 'cti-coursera-extractor' } });
  return data.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? null;
});
await inspect('pagesOutcomes', async () => {
  // Pages has a separate dataset. Discover only these three bounded type shapes
  // instead of dumping the schema or assuming a Worker/project identity.
  const names = ['Dimensions', 'Sum', 'Quantiles'];
  const types = {};
  for (const name of names) {
    const typeName = `AccountPagesFunctionsInvocationsAdaptiveGroups${name}`;
    const data = await request('/graphql', { query: 'query($name:String!){__type(name:$name){fields{name}}}', variables: { name: typeName } });
    types[name] = new Set((data.data?.__type?.fields || []).map(f => f.name));
  }
  const dimensions = ['scriptName', 'projectName', 'status'].filter(f => types.Dimensions.has(f));
  const sum = ['requests', 'errors', 'subrequests'].filter(f => types.Sum.has(f));
  const quantiles = ['cpuTimeP50', 'cpuTimeP99'].filter(f => types.Quantiles.has(f));
  if (!dimensions.includes('status') || !sum.includes('requests')) return { available: false, code: 'PAGES_DATASET_SHAPE_UNCONFIRMED', fields: { dimensions, sum, quantiles } };
  const projection = `dimensions{${dimensions.join(' ')}} sum{${sum.join(' ')}}${quantiles.length ? ` quantiles{${quantiles.join(' ')}}` : ''}`;
  const query = `query($accountTag:string,$start:string,$end:string){viewer{accounts(filter:{accountTag:$accountTag}){pagesFunctionsInvocationsAdaptiveGroups(limit:100,filter:{datetime_geq:$start,datetime_leq:$end}){${projection}}}}}`;
  const data = await request('/graphql', { query, variables });
  return data.data?.viewer?.accounts?.[0]?.pagesFunctionsInvocationsAdaptiveGroups ?? null;
});
console.log(JSON.stringify(report, null, 2));
