<script lang="ts">
  import type { Game, View } from '../game.svelte';

  interface Props {
    view: View;
    game: Game;
    /** Open the sheet, at a particular page if given. */
    onopen: (tab?: 'sky') => void;
  }

  const { view, game, onopen }: Props = $props();
</script>

<!--
  The margin is one caption, the way a picture on a wall has one: what it is, how much of it,
  and roughly what comes next. Everything else is in the sheet, which you summon.
-->
<section class="caption" data-testid="caption">
  <button class="what" onclick={() => onopen()} title="Open the sheet">
    <span class="stage-name">{view.choosing ? 'Between stars' : view.stageName}</span>
    {#if !view.choosing}
      <span class="mass num">{view.mass}</span>
    {/if}
  </button>

  <div class="hairline" aria-hidden="true">
    <div class="drawn" style="width: {(view.hairline * 100).toFixed(2)}%"></div>
  </div>

  <p class="next">{view.captionNext}</p>

  {#if view.choosing}
    <button class="pill" data-testid="caption-choose" onclick={() => onopen('sky')}>Choose a cloud</button>
  {:else if view.complete}
    <button class="pill" data-testid="caption-release" onclick={() => onopen('sky')}>Let it go…</button>
  {:else if view.beginnable}
    {@const current = view.beginnable}
    <button class="pill" data-testid="begin" onclick={() => game.buy(current.id, 1)}>
      Begin {current.name} <span class="num cost">{current.cost}</span>
    </button>
  {/if}
</section>

<style>
  .caption {
    position: absolute;
    left: max(2rem, env(safe-area-inset-left));
    bottom: max(2rem, env(safe-area-inset-bottom));
    width: min(19rem, calc(100vw - 4rem));
    pointer-events: none;
    text-shadow: 0 0 18px rgba(2, 3, 10, 0.95);
    transition: opacity 2.4s ease;
  }

  .caption > * {
    pointer-events: auto;
  }

  .what {
    display: grid;
    gap: 0.15rem;
    padding: 0;
    border: none;
    background: none;
    text-align: left;
    color: var(--text);
  }

  .stage-name {
    font-size: 1.2rem;
    font-weight: 400;
    letter-spacing: 0.02em;
    color: var(--accent);
    transition: color 6s ease;
  }

  .mass {
    font-size: 0.86rem;
    color: var(--dim);
  }

  .hairline {
    margin: 0.55rem 0 0.4rem;
    height: 1px;
    background: rgba(200, 215, 255, 0.14);
  }

  .drawn {
    height: 100%;
    background: var(--accent);
    opacity: 0.8;
    transition: width 1.2s ease, background 6s ease;
  }

  .next {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--dimmer);
  }

  .pill {
    margin-top: 0.65rem;
    padding: 0.32rem 0.75rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    background: rgba(8, 11, 22, 0.55);
    backdrop-filter: blur(6px);
    font-size: 0.78rem;
    color: var(--text);
    transition: border-color 200ms ease, background 200ms ease;
  }

  .pill:hover {
    border-color: var(--accent);
    background: rgba(18, 24, 44, 0.75);
  }

  .cost {
    margin-left: 0.35rem;
    color: var(--dim);
  }

  @media (max-width: 720px) {
    .caption {
      left: max(1.1rem, env(safe-area-inset-left));
      bottom: max(1.3rem, env(safe-area-inset-bottom));
      width: calc(100vw - 2.2rem);
    }
  }
</style>
