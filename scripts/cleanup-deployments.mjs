import { pathToFileURL } from 'node:url';

// Deletes deployment records only. It never changes Pages settings, branches,
// environments, workflow logs, or the files served by the deployed site.
export async function cleanupDeployments({ repository, token, apply = false, request = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Expected owner/repository');
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const prefix = `https://api.github.com/repos/${repository}`;
  async function api(path, method = 'GET', body) {
    const response = await request(`${prefix}${path}`, {
      method, signal: AbortSignal.timeout(30000),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  const deployments = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/deployments?environment=github-pages&per_page=100&page=${page}`);
    deployments.push(...batch);
    if (batch.length < 100) break;
  }
  deployments.sort((a, b) => b.id - a.id);
  const statuses = new Map();
  for (const deployment of deployments) {
    const [latest] = await api(`/deployments/${deployment.id}/statuses?per_page=1`);
    statuses.set(deployment.id, latest?.state);
  }
  const current = deployments.find(item => statuses.get(item.id) === 'success');
  if (!current) throw new Error('No successful deployment found; nothing was deleted.');
  const completed = new Set(['success', 'inactive', 'error', 'failure']);
  const candidates = deployments.filter(item => item.id !== current.id && completed.has(statuses.get(item.id)));
  const deleted = [];
  if (apply) {
    for (const deployment of candidates) {
      // Recheck immediately before mutation in case a deployment was restarted.
      const [latest] = await api(`/deployments/${deployment.id}/statuses?per_page=1`);
      if (!completed.has(latest?.state)) continue;
      if (latest.state !== 'inactive') {
        await api(`/deployments/${deployment.id}/statuses`, 'POST', { state: 'inactive', auto_inactive: false, description: 'Remove superseded deployment history; keep the latest successful site.' });
      }
      await api(`/deployments/${deployment.id}`, 'DELETE');
      deleted.push(deployment.id);
    }
  }
  return { apply, found: deployments.length, preserved: current.id, candidates: candidates.map(item => item.id), deleted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await cleanupDeployments({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN, apply: process.argv.includes('--apply') });
  console.log(JSON.stringify(result, null, 2));
}
