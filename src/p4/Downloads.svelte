<script>
  import Section from './Section.svelte';
  import {_} from '../locales';
  import {getJSZip} from '../packager/packager';
  import downloadURL from './download-url';
  import {isChromeOS} from './environment';
  import GitHubExport from './GitHubExport.svelte';

  export let name;
  export let url;
  export let blob;
  export let uniqueId;
  export let projectName;
  export let targetType;

  let workaroundInProgress;

  const useAlternativeDownloadToBypassChromeOSBugs = async () => {
    workaroundInProgress = true;
    try {
      const JSZip = await getJSZip();
      const zip = new JSZip();
      zip.file(name, blob);
      const zippedBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE'
      });
      const newFileName = name.replace(/\.html$/, '.zip');
      const blobURL = URL.createObjectURL(zippedBlob);
      downloadURL(newFileName, blobURL);
      URL.revokeObjectURL(blobURL);
    } catch (e) {
      console.error(e);
    }
    workaroundInProgress = false;
  };
</script>

<style>
  .alternative {
    font-size: smaller;
  }
</style>

<Section center>
  <div>
    <p>
      <a href={url} download={name}>
        {$_('downloads.link')
          .replace('{size}', `${(blob.size / 1000 / 1000).toFixed(2)}MB`)
          .replace('{filename}', name)}
      </a>
    </p>
    {#if isChromeOS && name.endsWith('.html')}
      <p class="alternative">
        <button
          on:click={useAlternativeDownloadToBypassChromeOSBugs}
          disabled={workaroundInProgress}
        >
          {$_('downloads.useWorkaround')}
        </button>
      </p>
    {/if}
  </div>
<GitHubExport
  uniqueId={uniqueId}
  projectName={projectName}
  filename={name}
  blob={blob}
  targetType={targetType}
/>
