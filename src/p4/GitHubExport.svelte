<script>
  import {_} from '../locales';
  import Section from './Section.svelte';
  import Button from './Button.svelte';
  import {getJSZip} from '../packager/packager';
  import {
    getStoredToken,
    clearToken,
    startDeviceFlow,
    pollForToken,
    getUser,
    listRepos,
    getFileSha,
    putFile,
    ensureGhPages,
    getPagesUrl,
    getMapping,
    storeMapping
  } from './github';

  export let uniqueId;
  export let projectName;
  export let filename;
  export let blob;
  export let targetType; // 'html' | 'zip'

  let token = getStoredToken();
  let user = null;
  let repos = [];
  let loadingRepos = false;
  let deviceCode = null;
  let userCode = null;
  let verificationUri = null;
  let polling = false;
  let error = '';
  let selectedRepo = '';
  let path = projectName.replace(/\.[^/.]+$/, '') || 'packaged-project';
  let uploading = false;
  let uploaded = false;
  let pagesUrl = '';

  const mapping = getMapping(uniqueId);
  if (mapping) {
    selectedRepo = `${mapping.owner}/${mapping.repo}`;
    path = mapping.path || path;
  }

  const login = async () => {
    error = '';
    try {
      const flow = await startDeviceFlow();
      deviceCode = flow.device_code;
      userCode = flow.user_code;
      verificationUri = flow.verification_uri;
      polling = true;
      await pollForToken(deviceCode, flow.interval || 5, flow.expires_in || 900);
      polling = false;
      deviceCode = null;
      token = getStoredToken();
      await loadUser();
    } catch (e) {
      polling = false;
      error = e.message || 'Login failed';
    }
  };

  const loadUser = async () => {
    if (!token) return;
    try {
      user = await getUser(token);
      await loadRepos();
    } catch (e) {
      error = e.message || 'Failed to load user';
      if (e.message === 'Token invalid/expired') token = null;
    }
  };

  const loadRepos = async () => {
    loadingRepos = true;
    try {
      repos = await listRepos(token);
    } catch (e) {
      error = e.message || 'Failed to load repos';
    }
    loadingRepos = false;
  };

  const logout = () => {
    clearToken();
    token = null;
    user = null;
    repos = [];
  };

  const doExport = async () => {
    error = '';
    uploading = true;
    uploaded = false;
    pagesUrl = '';
    try {
      if (!selectedRepo) throw new Error('Select repo');
      const [owner, repo] = selectedRepo.split('/');
      if (!owner || !repo) throw new Error('Invalid repo');
      const p = path.replace(/^\/+/, '').replace(/\/+$/, '');
      const basePath = p ? p : '';
      const normalizedPath = basePath ? basePath + '/' : '';

      if (targetType === 'html') {
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const base64 = dataUrl.split(',')[1];
        const sha = await getFileSha(token, owner, repo, normalizedPath + 'index.html');
        await putFile(token, owner, repo, normalizedPath + 'index.html', base64, `Publish ${filename} to GitHub Pages`, sha);
      } else {
        const JSZip = await getJSZip();
        const zip = await JSZip.loadAsync(blob);
        const entries = Object.keys(zip.files).filter(f => !zip.files[f].dir);
        for (const entry of entries) {
          const content = await zip.file(entry).async('uint8array');
          let binary = '';
          const bytes = new Uint8Array(content);
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
          }
          const base64 = btoa(binary);
          const filePath = normalizedPath + entry.replace(/^\/+/, '');
          const sha = await getFileSha(token, owner, repo, filePath);
          await putFile(token, owner, repo, filePath, base64, `Publish ${filename} to GitHub Pages`, sha);
        }
      }
      await ensureGhPages(token, owner, repo);
      storeMapping(uniqueId, { owner, repo, path: p, branch: 'gh-pages', baseUrl: getPagesUrl(owner, repo, p) });
      pagesUrl = getPagesUrl(owner, repo, p);
      uploaded = true;
    } catch (e) {
      error = e.message || 'Upload failed';
    }
    uploading = false;
  };

  if (token && !user) loadUser();
</script>

<Section>
  <h3>Экспорт в GitHub Pages</h3>
  {#if !token}
    <p>Войди через GitHub Device Flow чтобы загрузить файлы в репозиторий и опубликовать на GitHub Pages.</p>
    {#if !deviceCode}
      <Button on:click={login} text="Войти через GitHub" />
    {:else}
      <p>Код устройства: <strong>{userCode}</strong></p>
      <p><a href={verificationUri} target="_blank" rel="noopener">Открыть {verificationUri}</a> и введи код</p>
      <p>{polling ? 'Ожидание авторизации...' : ''}</p>
    {/if}
  {:else}
    <div>
      <p>Вошёл как: <strong>{user?.login || ''}</strong> <button on:click={logout}>Выйти</button></p>
      <label>
        Репозиторий:
        <select bind:value={selectedRepo} disabled={loadingRepos}>
          <option value="">— выбрать репозиторий —</option>
          {#each repos as r}
            <option value={`${r.owner.login}/${r.name}`}>{r.owner.login}/{r.name}</option>
          {/each}
        </select>
      </label>
      <br />
      <label>
        Путь в репо (папка):
        <input type="text" bind:value={path} placeholder="my-project" />
      </label>
      <p>Будет залито: <code>{path ? path + '/' : ''}{filename}</code></p>
      <Button on:click={doExport} disabled={uploading || !selectedRepo} text={uploading ? 'Заливаю...' : 'Залить на GitHub Pages'} />
      {#if uploaded && pagesUrl}
        <p>Готово. Ссылка: <a href={pagesUrl} target="_blank" rel="noopener">{pagesUrl}</a></p>
      {/if}
    </div>
  {/if}
  {#if error}
    <p style="color:red">{error}</p>
  {/if}
</Section>