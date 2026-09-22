<script lang="ts">
  import type { Game, View } from '../game.svelte';

  const { view, game }: { view: View; game: Game } = $props();

  // Two clicks, and the second one says what it will take rather than "Are you sure?". The
  // whole point of this screen is that the player understands the trade before making it.
  let armed = $state(false);
</script>

<section class="collapse">
  <div class="readouts">
    <div>
      <p class="label">Stardust</p>
      <p class="value num">{view.stardust}</p>
    </div>
    <div>
      <p class="label">Supernovae</p>
      <p class="value num">{view.collapses}</p>
    </div>
  </div>

  <div class="offer" class:ready={view.canCollapse}>
    {#if view.canCollapse}
      <p class="payout">
        Collapsing now pays <strong class="num">{view.collapseYield}</strong> stardust
      </p>
      <p class="hint">
        Every order of magnitude you gain before pulling the trigger is worth more stardust,
        at a falling rate. There is no deadline.
      </p>
      {#if armed}
        <p class="cost">
          You will lose your mass, your energy, every upgrade level and your place on the
          ladder. You keep your achievements, your stardust, and the upgrades you have
          automated.
        </p>
        <div class="actions">
          <button class="go" onclick={() => { game.collapse(); armed = false; }}>Collapse the star</button>
          <button class="cancel" onclick={() => (armed = false)}>Not yet</button>
        </div>
      {:else}
        <button class="arm" onclick={() => (armed = true)}>Collapse…</button>
      {/if}
    {:else}
      <p class="payout locked">{view.collapseRequirement}</p>
      <p class="hint">
        Iron is where fusion stops: past it, burning costs more energy than it releases, and
        no amount of throughput reaches it. A star that runs out of fuel does not grow into
        the next thing — it collapses, and throws most of itself back into the cloud.
      </p>
    {/if}
  </div>

  <h2>What survives</h2>
  <div class="tree">
    {#each view.stardustUpgrades as up (up.id)}
      <article class="card" class:maxed={up.maxed}>
        <header>
          <h3>{up.name}</h3>
          <span class="level num">{up.maxed ? 'max' : `Lv ${up.level}`}</span>
        </header>
        <p class="blurb">{up.blurb}</p>
        <div class="meta">
          <span class="per">{up.perLevel}</span>
          <span class="effect num">{up.effect}</span>
        </div>
        <button
          class="buy"
          disabled={!up.affordable || up.maxed}
          onclick={() => game.buyStardust(up.id)}
        >
          {#if up.maxed}Complete{:else}<span>Buy</span><span class="num">{up.cost}</span>{/if}
        </button>
      </article>
    {/each}
  </div>
</section>

<style>
  .collapse {
    display: grid;
    gap: 0.7rem;
  }

  .readouts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .label {
    margin: 0;
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.6;
  }

  .value {
    margin: 0.1rem 0 0;
    font-size: 1.2rem;
  }

  .offer {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 0.6rem 0.7rem;
    background: rgba(9, 13, 26, 0.5);
  }

  .offer.ready {
    border-color: #ffb347;
    box-shadow: 0 0 24px rgba(255, 179, 71, 0.12);
  }

  .payout {
    margin: 0;
    font-size: 0.9rem;
  }

  .payout.locked {
    opacity: 0.75;
  }

  .hint,
  .cost {
    margin: 0.35rem 0 0;
    font-size: 0.72rem;
    line-height: 1.45;
    opacity: 0.7;
  }

  .cost {
    opacity: 0.95;
    color: #ffc98a;
  }

  .actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }

  button {
    font: inherit;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .arm,
  .go {
    margin-top: 0.5rem;
    border-color: #ffb347;
    color: #ffd7a0;
  }

  .go {
    flex: 1;
  }

  h2 {
    margin: 0.3rem 0 0;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.6;
  }

  .tree {
    display: grid;
    gap: 0.5rem;
  }

  .card {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 0.5rem 0.7rem;
    background: rgba(9, 13, 26, 0.5);
  }

  .card.maxed {
    opacity: 0.6;
  }

  .card header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  h3 {
    margin: 0;
    font-size: 0.85rem;
  }

  .blurb {
    margin: 0.2rem 0 0.35rem;
    font-size: 0.72rem;
    line-height: 1.4;
    opacity: 0.65;
  }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.7rem;
    opacity: 0.8;
  }

  .buy {
    display: flex;
    justify-content: space-between;
    width: 100%;
    margin-top: 0.45rem;
  }
</style>
