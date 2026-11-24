<script>
  import {_} from '../locales';
  import Section from './Section.svelte';
  import Button from './Button.svelte';
  import {getJSZip} from '../packager/packager';
  import {
    getStoredToken,
    clearToken,
    setStoredToken,
    startDeviceFlow,
    pollForToken,
    getUser,
    listRepos,
    getFileSha,
    putFile,
    ensureBranch,
    ensureGhPages,
    getPagesInfo,
    getPagesUrl,
    getMapping,
    storeMapping
  } from './github';

  export let uniqueId;
  export let projectName;
  export let filename;
  export let blob;
  export let targetType; // 'html' | 'zip'

  const savedMapping = getMapping(uniqueId);
  const defaultPath = projectName.replace(/\.[^/.]+$/, '') || 'packaged-project';

  let token = getStoredToken();
  let user = null;
  let repos = [];
  let loadingRepos = false;
  let deviceCode = null;
  let userCode = null;
  let verificationUri = null;
  let polling = false;
  let error = '';
  let selectedRepo = savedMapping ? `${savedMapping.owner}/${savedMapping.repo}` : '';
  let path = savedMapping && savedMapping.path != null ? savedMapping.path : defaultPath;
  let outputName = savedMapping && savedMapping.outputName ? savedMapping.outputName : 'index.html';
  let branch = savedMapping && savedMapping.branch ? savedMapping.branch : 'main';
  let customDomain = savedMapping && savedMapping.customDomain ? savedMapping.customDomain : '';
  let uploadProgress = 0;
  let uploadMsg = '';
  let uploading = false;
  let uploaded = false;
  let usePat = false;
  let pat = '';
  let showPatHelp = false;
  let pagesUrl = '';

  $: previewUrl = (() => {
    if (!selectedRepo) return '';
    const [owner, repo] = selectedRepo.split('/');
    if (!owner || !repo) return '';
    const p = path.replace(/^\/+/, '').replace(/\/+$/, '');
    let url = getPagesUrl(owner, repo, p, customDomain);
    if (targetType === 'html') {
      const out = (outputName || 'index.html').replace(/^\/+/, '').replace(/\/+$/, '');
      if (out && out !== 'index.html') url += out;
    }
    return url;
  })();

  const loginWithPat = async () => {
    error = '';
    if (!pat.trim()) return;
    token = pat.trim();
    setStoredToken(token);
    try {
      user = await getUser(token);
      await loadRepos();
      usePat = false;
      pat = '';
    } catch (e) {
      setStoredToken(null);
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

  const onRepoChange = async () => {
    customDomain = '';
    if (!selectedRepo || !token) return;
    const [owner, repo] = selectedRepo.split('/');
    if (!owner || !repo) return;
    const info = await getPagesInfo(token, owner, repo);
    if (info && info.cname) customDomain = info.cname;
  };

  const doExport = async () => {
    error = '';
    uploading = true;
    uploaded = false;
    pagesUrl = '';
    uploadProgress = 0;
    uploadMsg = 'Подготовка...';
    try {
      if (!selectedRepo) throw new Error('Select repo');
      const [owner, repo] = selectedRepo.split('/');
      if (!owner || !repo) throw new Error('Invalid repo');
      const p = path.replace(/^\/+/, '').replace(/\/+$/, '');
      const basePath = p ? p : '';
      const normalizedPath = basePath ? basePath + '/' : '';
      const outName = (outputName || 'index.html').replace(/^\/+/, '').replace(/\/+$/, '') || 'index.html';
      const br = (branch || 'main').trim() || 'main';

      uploadMsg = `Проверяю ветку ${br}...`;
      uploadProgress = 5;
      await ensureBranch(token, owner, repo, br);

      if (targetType === 'html') {
        uploadMsg = 'Кодирую HTML...';
        uploadProgress = 10;
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const base64 = dataUrl.split(',')[1];
        uploadMsg = 'Проверяю существующий файл...';
        uploadProgress = 40;
        const sha = await getFileSha(token, owner, repo, normalizedPath + outName, br);
        uploadMsg = `Загружаю ${outName}...`;
        uploadProgress = 70;
        await putFile(token, owner, repo, normalizedPath + outName, base64, `Publish ${filename} to GitHub Pages`, sha, br);
        uploadProgress = 90;
      } else {
        const JSZip = await getJSZip();
        uploadMsg = 'Распаковываю ZIP...';
        uploadProgress = 10;
        const zip = await JSZip.loadAsync(blob);
        const entries = Object.keys(zip.files).filter(f => !zip.files[f].dir);
        const total = entries.length;
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          uploadMsg = `Загружаю ${entry} (${i+1}/${total})...`;
          const content = await zip.file(entry).async('uint8array');
          let binary = '';
          const bytes = new Uint8Array(content);
          const chunkSize = 0x8000;
          for (let i2 = 0; i2 < bytes.length; i2 += chunkSize) {
            const chunk = bytes.subarray(i2, i2 + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
          }
          const base64 = btoa(binary);
          const filePath = normalizedPath + entry.replace(/^\/+/, '');
          const sha = await getFileSha(token, owner, repo, filePath, br);
          await putFile(token, owner, repo, filePath, base64, `Publish ${filename} to GitHub Pages`, sha, br);
          uploadProgress = 10 + Math.round(((i + 1) / total) * 70);
        }
      }
      uploadMsg = 'Включаю GitHub Pages...';
      uploadProgress = 95;
      await ensureGhPages(token, owner, repo, br);
      const info = await getPagesInfo(token, owner, repo);
      customDomain = (info && info.cname) ? info.cname : '';
      let finalUrl = getPagesUrl(owner, repo, p, customDomain);
      if (targetType === 'html' && outName && outName !== 'index.html') finalUrl += outName;
      storeMapping(uniqueId, { owner, repo, path: p, outputName: outName, branch: br, customDomain, baseUrl: finalUrl });
      pagesUrl = finalUrl;
      uploadMsg = 'Готово';
      uploadProgress = 100;
      uploaded = true;
    } catch (e) {
      error = e.message || 'Upload failed';
    }
    uploading = false;
    uploadMsg = '';
    uploadProgress = 0;
  };

  if (token && !user) loadUser();
</script>

<Section>
  <h3>Экспорт в GitHub Pages</h3>
  {#if !token}
    <p>Вставь GitHub Personal Access Token (PAT) с правами <code>repo</code>.</p>
    {#if !usePat}
      <div>
        <Button on:click={() => { usePat = true; error=''; }} text="Войти по токену" />
      </div>
    {:else}
      <div>
        <input type="password" bind:value={pat} placeholder="ghp_..." style="width:260px" />
        <Button on:click={loginWithPat} text="Войти" />
        <Button on:click={() => { usePat = false; error=''; }} secondary text="Отмена" />
        <button type="button" on:click={() => showPatHelp = !showPatHelp} style="margin-left:4px">?</button>
        {#if showPatHelp}
          <p style="font-size:0.9em">Создай токен на <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">github.com/settings/tokens</a> (Classic), выбери scope <code>repo</code>.</p>
        {/if}
      </div>
    {/if}
  {:else}
    <div>
      <p>Вошёл как: <strong>{user && user.login || ''}</strong> <button on:click={logout}>Выйти</button></p>
      <label>
        Репозиторий:
        <select bind:value={selectedRepo} on:change={onRepoChange} disabled={loadingRepos}>
          <option value="">— выбрать репозиторий —</option>
          {#if selectedRepo && !repos.some(r => `${r.owner.login}/${r.name}` === selectedRepo)}
            <option value={selectedRepo}>{selectedRepo} (сохранённый)</option>
          {/if}
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
      <br />
      <label>
        Ветка:
        <input type="text" bind:value={branch} placeholder="main" style="width:140px" />
      </label>
      <br />
      {#if targetType === 'html'}
        <label>
          Имя файла:
          <input type="text" bind:value={outputName} placeholder="index.html" />
        </label>
        <br />
      {/if}
      <p>Будет залито: <code>{branch || 'main'}:{path ? path + '/' : ''}{targetType === 'html' ? (outputName || 'index.html') : filename}</code></p>
      {#if previewUrl}
        <p>Ссылка: <a href={previewUrl} target="_blank" rel="noopener">{previewUrl}</a></p>
      {/if}
      <Button on:click={doExport} disabled={uploading || !selectedRepo} text={uploading ? 'Заливаю...' : 'Залить на GitHub Pages'} />
      <p style="font-size:0.9em;color:#666">После загрузки сайт обновляется примерно в течение минуты.</p>
      {#if uploading}
        <p style="margin-top:6px;font-size:0.9em">{uploadMsg} {uploadProgress}%</p>
        <div style="height:6px;background:#eee;border-radius:3px;overflow:hidden;max-width:300px">
          <div style="height:100%;background:#4c9aff;width:{uploadProgress}%"></div>
        </div>
      {/if}
      {#if uploaded && pagesUrl}
        <p style="margin-top:6px">Готово: <a href={pagesUrl} target="_blank" rel="noopener">{pagesUrl}</a></p>
      {/if}
    </div>
  {/if}
  {#if error}
    <p style="color:red">{error}</p>
  {/if}
</Section>