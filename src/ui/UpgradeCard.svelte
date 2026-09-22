<script lang="ts">
  import type { UpgradeView } from '../game.svelte';
  import type { UpgradeId } from '../sim/upgrades';

  interface Props {
    upgrade: UpgradeView;
    onbuy: (id: UpgradeId, amount: number | 'max') => void;
    onautobuy: (id: UpgradeId) => void;
  }

  const { upgrade, onbuy, onautobuy }: Props = $props();

  const TERM_LABEL: Record<string, string> = {
    spawn: 'particles/s',
    capture: 'capture',
    value: 'mass each',
    global: 'everything',
  };
</script>

<article class="card" class:ready={upgrade.affordable}>
  <header>
    <h3>{upgrade.name}</h3>
    <!-- Said on the card, not buried in a patch note. A card that empties itself at every
         promotion has to warn you before it does it, or it reads as a bug. -->
    {#if upgrade.rebased}
      <span class="rebased" title="Resets to Lv 0 at every promotion, and its price rebases to the new stage. The ladder pays you back for it.">
        resets
      </span>
    {/if}
    <span class="level num">Lv {upgrade.level}</span>
  </header>

  <p class="blurb">{upgrade.blurb}</p>

  <div class="meta">
    <span class="term">{TERM_LABEL[upgrade.term] ?? upgrade.term}</span>
    <span class="per">{upgrade.perLevel}</span>
  </div>

  <!-- What a level is actually worth right now. Capture upgrades saturate, and automation
       cannot tell; this is how the player sees it and switches one off. -->
  <div class="meta">
    <span class="term">next level</span>
    <span class="gain num">{upgrade.gain}</span>
  </div>

  <div class="actions">
    <button
      class="buy"
      disabled={!upgrade.affordable}
      onclick={() => onbuy(upgrade.id, 1)}
    >
      <span>Buy</span>
      <span class="num cost">{upgrade.cost}</span>
    </button>

    <button
      class="buy max"
      disabled={upgrade.maxLevels < 2}
      onclick={() => onbuy(upgrade.id, 'max')}
      title={upgrade.maxLevels > 1 ? `${upgrade.maxLevels} levels for ${upgrade.maxCost}` : 'Not enough for a batch yet'}
    >
      <span>Max</span>
      <span class="num cost">{upgrade.maxLevels > 1 ? `+${upgrade.maxLevels}` : '—'}</span>
    </button>
  </div>

  <div class="footer">
    {#if !upgrade.affordable}
      <span class="eta num">affordable in {upgrade.eta}</span>
    {:else}
      <span class="eta">&nbsp;</span>
    {/if}

    {#if upgrade.autoBuyUnlocked}
      <label class="auto">
        <input
          type="checkbox"
          checked={upgrade.autoBuy}
          onchange={() => onautobuy(upgrade.id)}
        />
        auto
      </label>
    {:else}
      <span class="auto locked" title="Auto-buy unlocks at level {upgrade.autoBuyAt}">
        auto at Lv {upgrade.autoBuyAt}
      </span>
    {/if}
  </div>
</article>

<style>
  .rebased {
    color: var(--accent, #9fc6ff);
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 0 0.35rem;
    font-size: 0.62rem;
    opacity: 0.75;
    white-space: nowrap;
  }

  .card {
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 0.7rem 0.8rem 0.75rem;
    background: rgba(9, 13, 26, 0.6);
    transition: border-color 140ms ease, background 140ms ease;
  }

  .card.ready {
    border-color: var(--line-strong);
    background: rgba(18, 26, 48, 0.72);
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  /* Pushes the level to the far right, so the badge sits with the name it describes. */
  header h3 {
    margin-right: auto;
  }

  h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .level {
    font-size: 0.78rem;
    color: var(--dim);
  }

  .blurb {
    margin: 0.3rem 0 0.45rem;
    font-size: 0.78rem;
    line-height: 1.35;
    color: var(--dimmer);
  }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.72rem;
    margin-bottom: 0.55rem;
  }

  .term {
    color: var(--dimmer);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .per {
    color: var(--accent);
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.4rem;
  }

  .buy {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.42rem 0.6rem;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: rgba(30, 44, 78, 0.5);
    transition: background 120ms ease, border-color 120ms ease;
  }

  .buy.max {
    min-width: 5.2rem;
  }

  .buy:hover:not(:disabled) {
    background: rgba(48, 70, 122, 0.7);
    border-color: var(--line-strong);
  }

  .buy:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .cost {
    font-size: 0.8rem;
    color: var(--warm);
  }

  .gain {
    color: var(--good);
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    margin-top: 0.5rem;
  }

  .eta {
    font-size: 0.72rem;
    color: var(--dimmer);
  }

  .auto {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--dim);
    cursor: pointer;
    user-select: none;
  }

  .auto.locked {
    color: var(--dimmer);
    cursor: default;
  }

  .auto input {
    accent-color: var(--accent);
    width: 0.85rem;
    height: 0.85rem;
    margin: 0;
  }
</style>
