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
  let usePat = false;
  let pat = '';
  let showPatHelp = false;

  const loginWithPat = async () => {
    error = '';
    if (!pat.trim()) return;
    token = pat.trim();
    try {
      user = await getUser(token);
      await loadRepos();
    } catch (e) {
      token = null;
      error = e.message || 'Invalid token';
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
    <p>Войди через GitHub Device Flow или вставь Personal Access Token (PAT) с правами <code>repo</code>.</p>
    {#if !deviceCode && !usePat}
      <div>
        <Button on:click={login} text="Войти через GitHub (Device Flow)" />
        <Button on:click={() => { usePat = true; error=''; }} secondary text="Войти по токену PAT" />
      </div>
    {:else if usePat}
      <div>
        <input type="password" bind:value={pat} placeholder="ghp_..." style="width:260px" />
        <Button on:click={loginWithPat} text="Войти" />
        <Button on:click={() => { usePat = false; error=''; }} secondary text="Назад" />
        <button type="button" on:click={() => showPatHelp = !showPatHelp} style="margin-left:4px">?</button>
        {#if showPatHelp}
          <p style="font-size:0.9em">Создай PAT на <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">github.com/settings/tokens</a> (Classic) с scope <code>repo</code>.</p>
        {/if}
      </div>
    {:else}
      <p>Код устройства: <strong>{userCode}</strong></p>
      <p><a href={verificationUri} target="_blank" rel="noopener">Открыть {verificationUri}</a> и введи код</p>
      <p>{polling ? 'Ожидание авторизации...' : ''}</p>
      <Button on:click={() => { deviceCode=null; polling=false; error=''; }} secondary text="Назад" />
    {/if}
  {:else}
    <div>
      <p>Вошёл как: <strong>{user && user.login || ''}</strong> <button on:click={logout}>Выйти</button></p>
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