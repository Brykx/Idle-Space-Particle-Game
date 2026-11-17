<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { View } from '../game.svelte';

  const { view }: { view: View } = $props();

  // Slow in, slower out. A line that arrives gently can be read without being looked for, and
  // one that leaves gently does not pull the eye as it goes.
  const quiet = $derived(view.reducedMotion);
</script>

<!--
  Announcements are a line of text that fades, not a box that arrives. Keyed on the title so
  a second line replaces the first with its own fade rather than swapping words in place.
-->
{#key view.announceTitle}
  {#if view.announceTitle}
    <p
      class="whisper"
      role="status"
      in:fade={{ duration: quiet ? 0 : 1400 }}
      out:fade={{ duration: quiet ? 0 : 1800 }}
    >
      <span class="eyebrow">{view.announceEyebrow}</span>
      <span class="title">{view.announceTitle}</span>
      {#if view.announceBody}<span class="body">{view.announceBody}</span>{/if}
    </p>
  {/if}
{/key}

<style>
  .whisper {
    position: absolute;
    top: max(2.4rem, env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    width: min(34rem, calc(100vw - 3rem));
    margin: 0;
    text-align: center;
    pointer-events: none;
    line-height: 1.6;
    text-shadow: 0 0 20px rgba(2, 3, 10, 0.95);
  }

  .eyebrow {
    display: block;
    font-size: 0.64rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--dimmer);
  }

  .title {
    display: block;
    font-size: 1.15rem;
    letter-spacing: 0.02em;
    color: var(--accent);
  }

  .body {
    display: block;
    font-size: 0.8rem;
    color: var(--dim);
  }

  /* Below the menu button on a narrow screen, rather than under it. */
  @media (max-width: 720px) {
    .whisper {
      top: max(4.6rem, calc(env(safe-area-inset-top) + 3.6rem));
    }
  }
</style>
