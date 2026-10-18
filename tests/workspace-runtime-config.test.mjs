import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bindWorkspaceDatabase, assertWorkspaceRuntimeBindings } from '../tools/configure-workspace-runtime.mjs';

test('deployment binds exactly the existing production database without copying environment secrets', () => {
  const config = JSON.parse(fs.readFileSync('workers/coursera-extractor/wrangler.jsonc', 'utf8'));
  const before = JSON.stringify(config);
  const databaseId = '12345678-1234-1234-1234-123456789abc';
  const bound = bindWorkspaceDatabase(config, { deployment_configs: { production: {
    d1_databases: { CTI_DB: { id: databaseId } }, env_vars: { PRIVATE: { value: 'synthetic-never-copy' } },
  } } });
  assert.equal(bound.d1_databases.find(value => value.binding === 'CTI_DB').database_id, databaseId);
  assert.equal(JSON.stringify(config), before);
  assert(!JSON.stringify(bound).includes('synthetic-never-copy'));
  assert.deepEqual(bound.durable_objects, config.durable_objects);
  assert(config.migrations.some(value => value.new_sqlite_classes?.includes('WorkspaceRuntime')));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert(!config.routes?.length);
  for (const id of [undefined, '', 'not-a-database', '-'.repeat(36), '00000000-0000-0000-0000-000000000000'])
    assert.throws(() => bindWorkspaceDatabase(config, { deployment_configs: { production: { d1_databases: { CTI_DB: { id } } } } }));
  assert.throws(() => bindWorkspaceDatabase({ d1_databases: [] }, { deployment_configs: { production: { d1_databases: { CTI_DB: { id: databaseId } } } } }));
  const runtime = { type: 'durable_object_namespace', name: 'WORKSPACE_RUNTIME', class_name: 'WorkspaceRuntime', namespace_id: 'synthetic-private-namespace' };
  const settings = { bindings: [runtime, { type: 'd1', name: 'CTI_DB', id: databaseId }], compatibility_flags: [...config.compatibility_flags] };
  assert.doesNotThrow(() => assertWorkspaceRuntimeBindings(bound, settings));
  for (const flag of config.compatibility_flags)
    assert.throws(() => assertWorkspaceRuntimeBindings(bound, { ...settings, compatibility_flags: settings.compatibility_flags.filter(value => value !== flag) }), /compatibility flags/);
  assert.throws(() => assertWorkspaceRuntimeBindings(bound, { ...settings, compatibility_flags: undefined }), /compatibility flags/);
  assert.throws(() => assertWorkspaceRuntimeBindings(bound, { bindings: [runtime, { type: 'd1', name: 'CTI_DB', id: 'different-database' }] }));
  assert.throws(() => assertWorkspaceRuntimeBindings(bound, { bindings: [{ type: 'd1', name: 'CTI_DB', id: databaseId }] }));
});
