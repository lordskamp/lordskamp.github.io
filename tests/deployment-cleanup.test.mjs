import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDeployments } from '../scripts/cleanup-deployments.mjs';

function fixture(states, changed = {}) {
  const mutations = [];
  const reads = new Map();
  const request = async (url, options) => {
    const route = new URL(url).pathname;
    if (options.method !== 'GET') {
      mutations.push({ route, method: options.method, body: options.body && JSON.parse(options.body) });
      return new Response(options.method === 'DELETE' ? null : '{}', { status: options.method === 'DELETE' ? 204 : 201 });
    }
    const id = Number(route.match(/deployments\/(\d+)\/statuses/)?.[1]);
    if (id) {
      reads.set(id, (reads.get(id) || 0) + 1);
      return Response.json([{ state: reads.get(id) > 1 && changed[id] ? changed[id] : states[id] }]);
    }
    const page = Number(new URL(url).searchParams.get('page'));
    return Response.json(Object.keys(states).map(Number).sort((a, b) => b - a).slice((page - 1) * 100, page * 100).map(id => ({ id })));
  };
  return { request, mutations };
}

test('dry run preserves newest success and never mutates history', async () => {
  const env = fixture({ 1: 'inactive', 2: 'success', 3: 'success', 4: 'failure', 5: 'in_progress' });
  const result = await cleanupDeployments({ repository: 'owner/repo', token: 'test', ...env });
  assert.equal(result.preserved, 3);
  assert.deepEqual(result.candidates, [4, 2, 1]);
  assert.equal(env.mutations.length, 0);
});

test('apply paginates, keeps the live deployment, and skips restarted builds', async () => {
  const states = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [i + 1, 'success']));
  const env = fixture(states, { 100: 'in_progress' });
  const result = await cleanupDeployments({ repository: 'owner/repo', token: 'test', apply: true, ...env });
  assert.equal(result.found, 201);
  assert.equal(result.preserved, 201);
  assert.equal(result.deleted.length, 199);
  assert.ok(env.mutations.every(item => !/deployments\/(100|201)(\/|$)/.test(item.route)));
  assert.ok(env.mutations.filter(item => item.method === 'POST').every(item => item.body.state === 'inactive' && item.body.auto_inactive === false));
});

test('an empty/failed-only environment is left intact', async () => {
  const env = fixture({ 1: 'failure' });
  await assert.rejects(cleanupDeployments({ repository: 'owner/repo', token: 'test', apply: true, ...env }), /No successful deployment/);
  assert.equal(env.mutations.length, 0);
});
