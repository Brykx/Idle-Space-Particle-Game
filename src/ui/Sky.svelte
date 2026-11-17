<script lang="ts">
  import type { Game, View } from '../game.svelte';

  const { view, game }: { view: View; game: Game } = $props();

  // Two steps, and the second says what it will take rather than "Are you sure?". The point
  // of this screen is that the player understands the trade before making it.
  let armed = $state(false);

  /** "an Orange Dwarf", "a Blue Giant". */
  const a = (name: string): string => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
  let renaming = $state<number | null>(null);
  let draft = $state('');

  function startRename(id: number, name: string): void {
    renaming = id;
    draft = name;
  }

  function finishRename(event: SubmitEvent): void {
    event.preventDefault();
    if (renaming !== null) game.renameStar(renaming, draft);
    renaming = null;
  }
</script>

<section class="sky-panel" data-testid="sky">
  {#if view.choosing}
    <div class="choose" data-testid="choose">
      <h2>Choose the next cloud</h2>
      <p class="hint">Nothing happens until you do, and nothing is lost by waiting.</p>
      <ul class="offers">
        {#each view.offers as offer (offer.index)}
          <li>
            <button class="offer" data-testid="offer" style="--hue: {offer.hue}" onclick={() => game.chooseCloud(offer.index)}>
              <span class="cloud-name">{offer.name}</span>
              <span class="ceiling">
                <span class="dot" style="background: {offer.colour}" aria-hidden="true"></span>
                up to {a(offer.ceiling)}
              </span>
              <span class="trait"><strong>{offer.trait}.</strong> {offer.traitBlurb}</span>
              <span class="facts">
                <span>a star {offer.eta}</span>
                <span class="num">{offer.worth} stardust{offer.discovery ? ' — a first' : ''}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <div class="current" class:ready={view.canRelease} data-testid="current">
      <p class="cloud">
        {view.cloudName}
        <span class="dim">· {view.cloudTrait}, can make up to {a(view.cloudCeiling)}</span>
      </p>

      {#if view.canRelease}
        {#if view.complete}
          <p class="state">Its cloud is spent. The star is finished.</p>
        {:else}
          <p class="state">
            Its cloud still holds {Math.max(1, Math.round(view.remaining * 100))}%. Letting it go now
            keeps it {a(view.releaseAs)}.
          </p>
        {/if}
        <p class="payout">
          As {a(view.releaseAs).split(' ')[0]} <strong>{view.releaseAs}</strong> it leaves {view.releaseFate}, and pays
          <strong class="num">{view.releaseStardust}</strong> stardust{#if view.releaseDiscovery}, and
            <strong class="num">{view.releaseDiscovery}</strong> more for the first of its kind{/if}.
        </p>
        {#if armed}
          <p class="cost">
            This run ends: its mass, its energy, every level. The star goes into your sky, with
            its name and the day you made it.
          </p>
          <div class="actions">
            <button class="go" data-testid="release" onclick={() => { game.release(); armed = false; }}>Let it go</button>
            <button class="cancel" onclick={() => (armed = false)}>Not yet</button>
          </div>
        {:else}
          <button class="arm" data-testid="arm-release" onclick={() => (armed = true)}>Let it go…</button>
        {/if}
      {:else}
        <p class="state">Once this becomes a star you can let it go, and it will stay in your sky.</p>
      {/if}

      {#if view.eta && !view.complete}
        <p class="hint">Its cloud will be spent {view.eta}.</p>
      {/if}
    </div>
  {/if}

  {#if view.sky.length > 0 || view.stardust !== '0'}
    <div class="readouts">
      <div>
        <p class="label">Stardust</p>
        <p class="value num">{view.stardust}</p>
      </div>
      <div>
        <p class="label">Stars</p>
        <p class="value num">{view.sky.length}</p>
      </div>
      <div>
        <p class="label">The sky gives</p>
        <p class="value num">{view.skyBonus}</p>
      </div>
    </div>

    <h2>What the sky remembers</h2>
    <div class="tree">
      {#each view.stardustUpgrades as up (up.id)}
        <article class="card" class:maxed={up.maxed} data-testid="tree-card">
          <header>
            <h3>{up.name}</h3>
            <span class="level num">{up.level} / {up.maxLevel}</span>
          </header>
          <p class="blurb">{up.blurb}</p>
          <div class="meta">
            <span class="per">{up.perLevel}</span>
            <span class="effect">{up.effect}</span>
          </div>
          <button class="buy" disabled={!up.affordable || up.maxed} onclick={() => game.buyStardust(up.id)}>
            {#if up.maxed}Complete{:else}<span>Buy</span><span class="num">{up.cost}</span>{/if}
          </button>
        </article>
      {/each}
    </div>

    {#if view.sky.length > 0}
      <h2>Your stars</h2>
      <ul class="catalogue" data-testid="catalogue">
        {#each view.sky as star (star.id)}
          <li>
            <span class="dot" style="background: {star.colour}" aria-hidden="true"></span>
            <div class="entry">
              {#if renaming === star.id}
                <form onsubmit={finishRename}>
                  <!-- svelte-ignore a11y_autofocus -->
                  <input bind:value={draft} maxlength="24" aria-label="Name for this star" autofocus />
                  <button type="submit">Keep</button>
                </form>
              {:else}
                <button class="name" title="Rename" onclick={() => startRename(star.id, star.name)}>{star.name}</button>
              {/if}
              <span class="detail">
                {star.className}{star.completed ? '' : ', stopped short'} · {star.made} · {star.took}
              </span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .sky-panel {
    display: grid;
    gap: 0.7rem;
  }

  h2 {
    margin: 0.3rem 0 0;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.6;
  }

  .hint,
  .cost,
  .state {
    margin: 0.35rem 0 0;
    font-size: 0.74rem;
    line-height: 1.45;
    opacity: 0.75;
  }

  .cost {
    opacity: 0.95;
    color: #ffd9a8;
  }

  .current {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 0.6rem 0.7rem;
    background: rgba(9, 13, 26, 0.5);
  }

  .current.ready {
    border-color: rgba(255, 236, 200, 0.45);
  }

  .cloud {
    margin: 0;
    font-size: 0.9rem;
  }

  .dim {
    opacity: 0.6;
    font-size: 0.75rem;
  }

  .payout {
    margin: 0.45rem 0 0;
    font-size: 0.82rem;
    line-height: 1.45;
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
    border-color: rgba(255, 236, 200, 0.5);
  }

  .go {
    flex: 1;
  }

  .offers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }

  .offer {
    width: 100%;
    display: grid;
    gap: 0.2rem;
    text-align: left;
    padding: 0.6rem 0.7rem;
    border-radius: 10px;
    border-color: hsl(var(--hue) 40% 50% / 0.35);
    background: linear-gradient(120deg, hsl(var(--hue) 45% 30% / 0.28), rgba(9, 13, 26, 0.5) 70%);
  }

  .offer:hover {
    border-color: hsl(var(--hue) 50% 65% / 0.6);
  }

  .cloud-name {
    font-size: 0.92rem;
  }

  .ceiling,
  .trait,
  .facts {
    font-size: 0.74rem;
    opacity: 0.8;
  }

  .facts {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    opacity: 0.65;
  }

  .dot {
    display: inline-block;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    margin-right: 0.3rem;
    box-shadow: 0 0 6px currentColor;
    vertical-align: middle;
  }

  .readouts {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .label {
    margin: 0;
    font-size: 0.64rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.6;
  }

  .value {
    margin: 0.1rem 0 0;
    font-size: 1.1rem;
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

  .catalogue {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }

  .catalogue li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .entry {
    display: grid;
  }

  .name {
    border: none;
    background: none;
    padding: 0;
    font-size: 0.85rem;
    text-align: left;
  }

  .detail {
    font-size: 0.7rem;
    opacity: 0.6;
  }

  input {
    font: inherit;
    color: inherit;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.2rem 0.4rem;
    width: 11rem;
  }

  form {
    display: flex;
    gap: 0.3rem;
  }
</style>
