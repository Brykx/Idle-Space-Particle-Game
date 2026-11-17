<script lang="ts">
  import type { UpgradeView } from '../game.svelte';
  import type { UpgradeId } from '../sim/upgrades';

  interface Props {
    upgrade: UpgradeView;
    onbuy: (id: UpgradeId, amount: number | 'max') => void;
    onautobuy: (id: UpgradeId) => void;
  }

  const { upgrade, onbuy, onautobuy }: Props = $props();

  const STATUS: Record<UpgradeView['state'], string> = {
    closed: '',
    flowing: 'flowing',
    settled: 'settled: a level would not repay itself yet',
    held: 'held, for you to tend',
  };
</script>

<!--
  A current, not a card. It is begun once, by hand, and after that it grows by itself: the
  row says which of those it is, what a level does, and lets you hold it if you would rather
  tend it yourself.
-->
<article class="current" data-testid="current-row" data-state={upgrade.state}>
  <header>
    <h3>{upgrade.name}</h3>
    {#if upgrade.rebased}
      <!-- Said on the row, not buried in a patch note: a current that empties at every
           promotion has to say so, or it reads as a bug. -->
      <span class="rebased" title="Resets at every promotion, and its price rebases to the new stage. The ladder pays you back for it.">resets</span>
    {/if}
    <span class="level num">Lv {upgrade.level}</span>
  </header>

  <p class="blurb">{upgrade.blurb}</p>

  <p class="meta">
    <span>{upgrade.perLevel}</span>
    <span class="gain num">{upgrade.gain}</span>
  </p>

  <div class="actions">
    {#if upgrade.state === 'closed'}
      <button class="begin" disabled={!upgrade.affordable} onclick={() => onbuy(upgrade.id, 1)}>
        <span>Begin</span>
        <span class="num cost">{upgrade.cost}</span>
      </button>
      {#if !upgrade.affordable}
        <span class="status num">in {upgrade.eta}</span>
      {/if}
    {:else}
      <span class="status">{STATUS[upgrade.state]}</span>
      {#if upgrade.state === 'held'}
        <button class="buy" disabled={!upgrade.affordable} onclick={() => onbuy(upgrade.id, 1)}>
          +1 <span class="num cost">{upgrade.cost}</span>
        </button>
        <button class="buy" disabled={upgrade.maxLevels < 2} onclick={() => onbuy(upgrade.id, 'max')}>
          +{Math.max(upgrade.maxLevels, 0)}
        </button>
      {/if}
      <label class="flow">
        <input type="checkbox" checked={upgrade.autoBuy} onchange={() => onautobuy(upgrade.id)} />
        flow
      </label>
    {/if}
  </div>
</article>

<style>
  .current {
    padding: 0.65rem 0.1rem 0.75rem;
    border-bottom: 1px solid var(--line);
  }

  .current[data-state='settled'] {
    opacity: 0.72;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  h3 {
    margin: 0;
    flex: 1;
    font-size: 0.88rem;
    font-weight: 500;
  }

  .rebased {
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dimmer);
  }

  .level {
    font-size: 0.78rem;
    color: var(--dim);
  }

  .blurb {
    margin: 0.2rem 0 0.3rem;
    font-size: 0.72rem;
    line-height: 1.45;
    color: var(--dimmer);
  }

  .meta {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    margin: 0;
    font-size: 0.7rem;
    color: var(--dim);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.45rem;
    min-height: 1.8rem;
  }

  .status {
    flex: 1;
    font-size: 0.7rem;
    color: var(--dimmer);
  }

  button {
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.03);
    padding: 0.22rem 0.7rem;
    font-size: 0.74rem;
  }

  button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .begin {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }

  .cost {
    margin-left: 0.3rem;
    color: var(--dim);
  }

  .flow {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.72rem;
    color: var(--dim);
    cursor: pointer;
  }

  .flow input {
    accent-color: var(--accent);
  }
</style>
