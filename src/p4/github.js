const CLIENT_ID = 'Ov23liJPmM8L67MMnq4C';
const TOKEN_KEY = 'ulip.github.token';
const MAPPING_KEY_PREFIX = 'ulip.github.map.';

export const getStoredToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return null;
  }
};

export const setStoredToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
};

export const clearToken = () => setStoredToken(null);
const storeToken = setStoredToken;

export const getMapping = (uniqueId) => {
  try {
    const raw = localStorage.getItem(MAPPING_KEY_PREFIX + uniqueId);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
};

export const storeMapping = (uniqueId, mapping) => {
  try {
    localStorage.setItem(MAPPING_KEY_PREFIX + uniqueId, JSON.stringify(mapping));
  } catch (e) {}
};

export const startDeviceFlow = async () => {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `client_id=${encodeURIComponent(CLIENT_ID)}&scope=repo`
  });
  if (!res.ok) throw new Error('Failed to start device flow');
  return await res.json();
};

export const pollForToken = async (deviceCode, interval = 5, expiresIn = 900) => {
  const deadline = Date.now() + expiresIn * 1000;
  let wait = interval;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, wait * 1000));
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `client_id=${encodeURIComponent(CLIENT_ID)}&device_code=${encodeURIComponent(deviceCode)}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
    });
    if (!res.ok) throw new Error('Polling failed');
    const data = await res.json();
    if (data.access_token) {
      storeToken(data.access_token);
      return data.access_token;
    }
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      wait += 5;
      continue;
    }
    if (data.error === 'expired_token') throw new Error('Device code expired');
    if (data.error === 'access_denied') throw new Error('Access denied');
    throw new Error(data.error_description || data.error || 'Unknown error');
  }
  throw new Error('Device code expired');
};

const api = async (token, path, init = {}) => {
  const res = await fetch('https://api.github.com' + path, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'uli-packager',
      ...(init.headers || {})
    }
  });
  if (res.status === 401) {
    clearToken();
    throw new Error('Token invalid/expired');
  }
  return res;
};

export const getUser = async (token) => {
  const res = await api(token, '/user');
  if (!res.ok) throw new Error('Failed to get user');
  return res.json();
};

export const listRepos = async (token, perPage = 100) => {
  const res = await api(token, `/user/repos?per_page=${perPage}&sort=updated`);
  if (!res.ok) throw new Error('Failed to list repos');
  return res.json();
};

export const getFileSha = async (token, owner, repo, path) => {
  try {
    const res = await api(token, `/repos/${owner}/${repo}/contents/${path}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data)) return null;
    return data.sha || null;
  } catch (e) {
    return null;
  }
};

export const getRepo = async (token, owner, repo) => {
  const res = await api(token, `/repos/${owner}/${repo}`);
  if (!res.ok) throw new Error('Failed to get repo info');
  return res.json();
};

const getRef = async (token, owner, repo, branch) => {
  const res = await api(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data = await res.json();
  return data.object ? data.object.sha : null;
};

export const ensureBranch = async (token, owner, repo, branch = 'gh-pages') => {
  const existing = await getRef(token, owner, repo, branch);
  if (existing) return existing;
  const info = await getRepo(token, owner, repo);
  const base = info.default_branch || 'main';
  let baseSha = await getRef(token, owner, repo, base);
  if (!baseSha) {
    const commits = await api(token, `/repos/${owner}/${repo}/commits?per_page=1`);
    if (commits.ok) {
      const list = await commits.json();
      if (Array.isArray(list) && list.length) baseSha = list[0].sha;
    }
  }
  if (!baseSha) throw new Error(`Не удалось найти базовый коммит для ветки ${branch}`);
  const create = await api(token, `/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha })
  });
  if (!create.ok) {
    const text = await create.text();
    throw new Error(`Не удалось создать ветку ${branch}: ${create.status} ${text}`);
  }
  const created = await create.json();
  return created.object ? created.object.sha : baseSha;
};

export const putFile = async (token, owner, repo, path, contentBase64, message, sha = null, branch = 'gh-pages') => {
  const body = {
    message: message || `Update ${path}`,
    content: contentBase64,
    branch
  };
  if (sha) body.sha = sha;
  const res = await api(token, `/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upload ${path}: ${res.status} ${text}`);
  }
  return res.json();
};

export const ensureGhPages = async (token, owner, repo) => {
  try {
    const res = await api(token, `/repos/${owner}/${repo}/pages`);
    if (res.status === 404) {
      const create = await api(token, `/repos/${owner}/${repo}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: { branch: 'gh-pages', path: '/' } })
      });
      if (!create.ok) return false;
      return true;
    }
    if (res.ok) return true;
    return false;
  } catch (e) {
    return false;
  }
};

export const getPagesUrl = (owner, repo, subpath = '') => {
  let p = subpath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (p && !p.endsWith('/')) p = p + '/';
  return `https://${owner}.github.io/${repo}/${p}`;
};