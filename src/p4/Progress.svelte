<script>
  export let progress = 0;
  export let text = '';
</script>

<style>
  .progress {
    display: flex;
    align-items: center;
    flex-direction: column;
    width: 100%;
  }
  .progress-bar {
    width: 100%;
    height: 10px;
    background: #1b331b;
    border-radius: 10px;
    overflow: hidden;
    margin: 0.5rem 0;
  }
  :global([theme="dark"]) .progress-bar {
    background: #1b331b;
  }
  .progress-fill {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #7eaf7a, #c7f0b1);
    border-radius: 10px;
    transition: width 0.3s ease;
  }
  .text {
    text-align: center;
    font-size: 0.95rem;
    color: #dcedc4;
    min-height: 1.5rem;
    word-wrap: break-word;
  }
</style>

<div class="progress">
  <div class="progress-bar">
    <div
      class="progress-fill"
      style:width={`${progress * 100}%`}
    ></div>
  </div>
  <div class="text">
    {text}
  </div>
</div>
