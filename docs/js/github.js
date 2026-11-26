// GitHub REST client for the private data repository.
// Reads the library from the vidledger-state branch, saves your records to the
// vidledger-user branch, and starts the agent workflow. Every call has a
// timeout and retries transient failures, and errors say how to fix them.

export const STATE_BRANCH = 'vidledger-state';
export const USER_BRANCH = 'vidledger-user';
export const AGENT_WORKFLOW = 'agent.yml';
export const RECORDS_FILE = 'records.json';
export const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
export const TOKEN_RE = /^(?:github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{36})$/;
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export function validateConnection(repo, token) {
  const errors = {};
  const r = String(repo || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '');
  if (!REPO_RE.test(r)) errors.repo = 'Enter the private repository as owner/name, for example Sathyanarayanan-2001/vidledger-data.';
  const t = String(token || '').trim();
  if (!TOKEN_RE.test(t)) errors.token = 'Paste a fine-grained token. It starts with github_pat_ (see Guide, step 6).';
  return { repo: r, token: t, errors };
}

function friendly(status, body, what) {
  const msg = (body && body.message) || '';
  if (status === 401) return 'GitHub rejected the token. It may have expired or been revoked. Create a new fine-grained token and paste it in Settings.';
  if (status === 403 && /rate limit/i.test(msg)) return 'GitHub rate limit reached. Wait a few minutes, then try again.';
  if (status === 403) return `The token is not allowed to ${what}. Give it access to this repository with Contents: read and write, and Actions: read and write.`;
  if (status === 404) return `Not found while trying to ${what}. Check the repository name, and that the token can see that repository.`;
  if (status === 409) return `GitHub reported a conflict while trying to ${what}. Another device saved at the same moment; trying again fixes it.`;
  if (status === 422) return `GitHub refused the request to ${what}: ${msg || 'invalid input'}.`;
  if (status >= 500) return `GitHub had a server problem (${status}) while trying to ${what}. Try again in a minute.`;
  return `Could not ${what} (HTTP ${status}${msg ? ': ' + msg : ''}).`;
}

/** UTF-8 text to base64 without the btoa Latin-1 trap (Tamil and Hindi text are safe). */
export function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function b64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GitHub {
  constructor(repo, token, { fetchImpl = (...a) => fetch(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 20000 } = {}) {
    this.repo = repo;
    this.token = token;
    this.fetch = fetchImpl;
    this.sleep = sleep;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body, accept = 'application/vnd.github+json', what = 'reach GitHub', retries = 3, etag } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const headers = { Accept: accept, Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28' };
        if (body) headers['Content-Type'] = 'application/json';
        if (etag) headers['If-None-Match'] = etag;
        const res = await this.fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal, cache: 'no-store' });
        if (res.status === 304) return { status: 304, etag };
        if (res.ok) {
          const text = res.status === 204 ? '' : await res.text();
          return { status: res.status, text, etag: res.headers.get('ETag') };
        }
        let data = null;
        try {
          data = await res.json();
        } catch { /* not JSON */ }
        lastErr = new GitHubError(friendly(res.status, data, what), res.status);
        lastErr.detail = (data && data.message) || '';
        const retryable = res.status >= 500 || res.status === 429;
        if (!retryable || attempt === retries) throw lastErr;
      } catch (err) {
        if (err instanceof GitHubError) throw err;
        lastErr = new GitHubError(err && err.name === 'AbortError'
          ? `GitHub did not answer within ${this.timeoutMs / 1000} seconds while trying to ${what}. Check your connection.`
          : `No connection to GitHub while trying to ${what}. You can keep working; changes save when you are back online.`, 0);
        if (attempt === retries) throw lastErr;
      } finally {
        clearTimeout(timer);
      }
      await this.sleep(Math.min(8000, 500 * 2 ** attempt + Math.random() * 250));
    }
    throw lastErr;
  }

  async json(path, opts) {
    const r = await this.request(path, opts);
    return r.text ? JSON.parse(r.text) : null;
  }

  /** Confirms the token can read the repository, and that it is private. */
  async verifyRepo() {
    const info = await this.json(`/repos/${this.repo}`, { what: 'open the repository' });
    if (!info.private) {
      throw new GitHubError('This repository is public, so anyone could read your library and notes. Connect the private data repository (vidledger-data), or make this one private.', 0);
    }
    return info;
  }

  /** Raw file from the state branch; {status:304} when unchanged since etag. */
  getStateFile(path, etag) {
    return this.request(`/repos/${this.repo}/contents/${path}?ref=${STATE_BRANCH}`, {
      accept: 'application/vnd.github.raw+json', what: `read ${path}`, etag,
    });
  }

  /** Your records and the blob sha needed to save them; {exists:false} before the first save. */
  async getUserRecords() {
    try {
      const meta = await this.json(`/repos/${this.repo}/contents/${RECORDS_FILE}?ref=${USER_BRANCH}`, { what: 'read your saved records' });
      let text = meta.content && meta.encoding === 'base64' ? b64ToUtf8(meta.content) : null;
      if (text === null) {
        const raw = await this.request(`/repos/${this.repo}/contents/${RECORDS_FILE}?ref=${USER_BRANCH}`, { accept: 'application/vnd.github.raw+json', what: 'read your saved records' });
        text = raw.text;
      }
      return { exists: true, sha: meta.sha, text };
    } catch (err) {
      if (err.status === 404) return { exists: false, sha: null, text: '' };
      throw err;
    }
  }

  /** Save records.json; throws status 409 when another device saved first (caller merges and retries). */
  async putUserRecords(text, sha, message) {
    const body = { message, content: utf8ToB64(text), branch: USER_BRANCH };
    if (sha) body.sha = sha;
    try {
      const res = await this.json(`/repos/${this.repo}/contents/${RECORDS_FILE}`, { method: 'PUT', body, what: 'save your records', retries: 1 });
      return res && res.content ? res.content.sha : null;
    } catch (err) {
      if (err.status === 422 && /sha/i.test(err.detail || '')) throw new GitHubError(err.message, 409);
      if ((err.status === 404 || err.status === 422) && /branch/i.test(err.detail || '') && !sha) return this.createUserBranch(text, message);
      throw err;
    }
  }

  /** First save: an orphan branch holding only records.json (no code). */
  async createUserBranch(text, message) {
    const base = `/repos/${this.repo}/git`;
    const blob = await this.json(`${base}/blobs`, { method: 'POST', body: { content: text, encoding: 'utf-8' }, what: 'create your records branch', retries: 1 });
    const tree = await this.json(`${base}/trees`, { method: 'POST', body: { tree: [{ path: RECORDS_FILE, mode: '100644', type: 'blob', sha: blob.sha }] }, what: 'create your records branch', retries: 1 });
    const commit = await this.json(`${base}/commits`, { method: 'POST', body: { message, tree: tree.sha, parents: [] }, what: 'create your records branch', retries: 1 });
    try {
      await this.json(`${base}/refs`, { method: 'POST', body: { ref: `refs/heads/${USER_BRANCH}`, sha: commit.sha }, what: 'create your records branch', retries: 1 });
    } catch (err) {
      if (err.status === 422) throw new GitHubError('Another device created the records branch first; trying again.', 409);
      throw err;
    }
    return blob.sha;
  }

  async dispatchAgent(runId) {
    await this.request(`/repos/${this.repo}/actions/workflows/${AGENT_WORKFLOW}/dispatches`, {
      method: 'POST', what: 'start the agent', retries: 1,
      body: { ref: 'main', inputs: { run_id: runId } },
    });
  }

  /** The run whose title carries our run id (run-name in agent.yml). */
  async findRun(runId, sinceIso) {
    const q = `?event=workflow_dispatch&per_page=20&created=%3E%3D${encodeURIComponent(sinceIso)}`;
    const data = await this.json(`/repos/${this.repo}/actions/workflows/${AGENT_WORKFLOW}/runs${q}`, { what: 'check the agent workflow' });
    return (data.workflow_runs || []).find((r) => String(r.display_title || r.name || '').includes(runId)) || null;
  }

  getRun(id) {
    return this.json(`/repos/${this.repo}/actions/runs/${Number(id)}`, { what: 'check the agent run' });
  }

  async recentRuns(n = 5) {
    const data = await this.json(`/repos/${this.repo}/actions/workflows/${AGENT_WORKFLOW}/runs?per_page=${Number(n)}`, { what: 'check recent agent runs' });
    return data.workflow_runs || [];
  }
}
