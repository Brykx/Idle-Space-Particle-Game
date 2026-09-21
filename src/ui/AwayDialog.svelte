<script lang="ts">
  import type { View } from '../game.svelte';

  interface Props {
    view: View;
    ondismiss: () => void;
  }

  const { view, ondismiss }: Props = $props();

  let element: HTMLDialogElement | undefined = $state();

  // A native <dialog> gets focus trapping, Escape-to-close and a backdrop for free, which is
  // a lot of accessibility to reimplement on a div.
  $effect(() => {
    if (!element) return;
    if (view.away && !element.open) element.showModal();
    if (!view.away && element.open) element.close();
  });
</script>

<dialog bind:this={element} onclose={ondismiss} aria-labelledby="away-title">
  {#if view.away}
    <h2 id="away-title">While you were away</h2>

    <p class="duration">{view.awayDuration} of drift</p>

    <p class="gained num">+{view.awayGained}</p>
    <p class="unit">mass accreted</p>

    {#if view.away.capped}
      <p class="capped">
        Offline accretion is credited for up to 12 hours. The rest of the cloud drifted past.
      </p>
    {/if}

    <button autofocus onclick={() => element?.close()}>Continue</button>
  {/if}
</dialog>

<style>
  dialog {
    width: min(26rem, calc(100vw - 2rem));
    border: 1px solid var(--line-strong);
    border-radius: 14px;
    background: var(--panel-solid);
    color: var(--text);
    padding: 1.6rem 1.4rem 1.3rem;
    text-align: center;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  }

  dialog::backdrop {
    background: rgba(2, 3, 10, 0.78);
    backdrop-filter: blur(3px);
  }

  h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .duration {
    margin: 0.3rem 0 1.1rem;
    font-size: 0.8rem;
    color: var(--dimmer);
  }

  .gained {
    margin: 0;
    font-size: 2rem;
    color: var(--warm);
  }

  .unit {
    margin: 0.1rem 0 0;
    font-size: 0.75rem;
    color: var(--dimmer);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .capped {
    margin: 1rem 0 0;
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--dim);
  }

  button {
    margin-top: 1.3rem;
    width: 100%;
    padding: 0.55rem;
    border-radius: 8px;
    border: 1px solid var(--line-strong);
    background: rgba(48, 70, 122, 0.6);
  }

  button:hover {
    background: rgba(64, 92, 158, 0.75);
  }
</style>
