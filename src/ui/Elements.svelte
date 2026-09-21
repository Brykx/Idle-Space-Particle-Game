<script lang="ts">
  import type { View } from '../game.svelte';

  const { view }: { view: View } = $props();
</script>

<section class="chain">
  <header>
    <span class="symbol">{view.elementSymbol}</span>
    <div class="who">
      <p class="name">{view.elementName}</p>
      <p class="mult num">{view.elementMultiplier} mass per particle</p>
    </div>
  </header>

  <p class="blurb">{view.elementBlurb}</p>

  {#if view.nextElementName}
    <div class="progress" title="Towards {view.nextElementName}">
      <div class="bar" style="width: {(view.elementProgress * 100).toFixed(2)}%"></div>
    </div>
    <p class="goal">next: {view.nextElementName}</p>
  {:else}
    <p class="goal">Nothing the disk can reach burns hotter.</p>
  {/if}

  <ol>
    {#each view.elements as element (element.id)}
      <li class:reached={element.reached} class:current={element.current} class:unreachable={element.unreachable}>
        <span class="tier-symbol num">{element.symbol}</span>
        <span class="tier-name">{element.name}</span>
        <span class="tier-mult num">{element.multiplier}</span>
        <span class="tier-req num">{element.requires}</span>
      </li>
    {/each}
  </ol>

  <p class="note">
    A tier is not a cost you pay down — it is a standard the disk has to meet, measured as the
    fraction of infall it converts. Iron asks for nothing because nothing reaches it: fusing
    iron consumes energy rather than releasing it. That is where a star runs out of options.
  </p>
</section>

<style>
  .chain {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(9, 13, 26, 0.5);
    padding: 0.8rem 0.7rem 0.7rem;
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }

  .symbol {
    display: grid;
    place-items: center;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    border: 1px solid var(--line-strong);
    background: rgba(48, 70, 122, 0.35);
    font-family: var(--mono);
    font-size: 0.95rem;
    color: var(--warm);
  }

  .who {
    flex: 1;
  }

  .name {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .mult {
    margin: 0.1rem 0 0;
    font-size: 0.75rem;
    color: var(--accent);
  }

  .blurb {
    margin: 0.6rem 0 0.7rem;
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--dimmer);
  }

  .progress {
    height: 3px;
    border-radius: 2px;
    background: rgba(140, 175, 255, 0.12);
    overflow: hidden;
  }

  .bar {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--warm));
    transition: width 220ms ease;
  }

  .goal {
    margin: 0.35rem 0 0.8rem;
    font-size: 0.7rem;
    color: var(--dimmer);
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.1rem;
  }

  li {
    display: grid;
    grid-template-columns: 1.5rem 1fr auto auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.25rem 0;
    font-size: 0.75rem;
    opacity: 0.4;
  }

  li.reached {
    opacity: 1;
  }

  li.unreachable {
    opacity: 0.3;
  }

  .tier-symbol {
    color: var(--dimmer);
    text-align: center;
  }

  li.current .tier-symbol,
  li.current .tier-name {
    color: var(--warm);
    font-weight: 600;
  }

  .tier-name {
    color: var(--dim);
  }

  .tier-mult {
    color: var(--dimmer);
    font-size: 0.7rem;
  }

  .tier-req {
    min-width: 3.6rem;
    text-align: right;
    color: var(--dimmer);
    font-size: 0.7rem;
  }

  .note {
    margin: 0.8rem 0 0;
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
    font-size: 0.68rem;
    line-height: 1.5;
    color: var(--dimmer);
  }
</style>
