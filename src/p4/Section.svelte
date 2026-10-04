<script>
  import ResetButton from './ResetButton.svelte';

  export let caption = false;
  export let center = false;
  export let modal = false;
  export let accent = '';
  export let reset;
</script>

<style>
  .card {
    max-width: 625px;
    margin: auto;

    background: rgba(30, 50, 30, 0.7);
    padding: 1em;
    margin-top: 1em;
    margin-bottom: 1em;
    box-shadow: 0 25px 40px -10px rgba(0, 0, 0, 0.6), 0 0 0 2px #6f8c5d inset, 0 0 0 4px #3f6140 inset;
    border: 3px solid #9bbc7b;
    border-radius: 30px;
  }
  :global([theme="dark"]) .card {
    background: #222;
  }
  .caption {
    font-style: italic;
  }
  .modal {
    width: 100%;
    max-width: 400px;
    margin: 0 8px;
  }
  .center {
    height: 40px;
    display: flex;
    justify-content: center;
    align-items: center;
    text-align: center;
  }
  .reset {
    float: right;
  }
</style>

<div
  class="card"
  class:caption
  class:modal
  class:center={caption || center}
  style:border-top={accent ? `6px solid ${accent}` : ''}
>
  {#if reset}
    <div class="reset">
      <ResetButton on:click={reset} />
    </div>
  {/if}
  <slot></slot>
</div>
