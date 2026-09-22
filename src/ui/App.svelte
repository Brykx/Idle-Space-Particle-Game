<script lang="ts">
  import { onMount } from 'svelte';
  import { game } from '../game.svelte';
  import UpgradeCard from './UpgradeCard.svelte';
  import Breakdown from './Breakdown.svelte';
  import Collapse from './Collapse.svelte';
  import Stages from './Stages.svelte';
  import Achievements from './Achievements.svelte';
  import Elements from './Elements.svelte';
  import Settings from './Settings.svelte';
  import AwayDialog from './AwayDialog.svelte';

  const view = game.view;

  let stage: HTMLDivElement;

  type Tab = 'core' | 'energy' | 'collapse' | 'progress' | 'settings';
  let tab = $state<Tab>('core');

  // The Energy tab only exists once there is a disk. Keeping it out of the bar until then is
  // the difference between a game that unfolds and one that starts with four empty rooms.
  // The Collapse tab appears the first time a collapse is possible and never leaves again,
  // because after the first supernova it holds the tree you are spending in. Before that, a
  // tab offering an ending to a game you have not finished is only a spoiler.
  const tabs = $derived(
    [
      { id: 'core' as const, label: 'Core' },
      ...(view.energyUnlocked ? [{ id: 'energy' as const, label: 'Energy' }] : []),
      ...(view.canCollapse || view.collapses !== '0' ? [{ id: 'collapse' as const, label: 'Collapse' }] : []),
      { id: 'progress' as const, label: 'Progress' },
      { id: 'settings' as const, label: 'Settings' },
    ],
  );

  onMount(() => {
    void game.start(stage);
    return () => game.stop();
  });
</script>

<svelte:window
  onkeydown={(event) => {
    // Space fires a pulse, unless the player is typing into the save box.
    const target = event.target as HTMLElement | null;
    const typing = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT';
    if (event.code === 'Space' && !typing) {
      event.preventDefault();
      game.pulse();
    }
  }}
/>

<main>
  <section class="stage">
    <!-- The field is decorative: it renders the numbers, it never produces them. -->
    <div class="field" bind:this={stage} aria-hidden="true"></div>

    <div class="readout">
      <p class="mass num">{view.mass}</p>
      <p class="rate num">+{view.massPerSecond} <span>mass/s</span></p>
    </div>

    <div class="controls">
      <button class="pulse" disabled={!view.pulseReady} onclick={() => game.pulse()}>
        {#if view.pulseReady}
          <strong>Gravity Pulse</strong>
          <span class="num">+{view.pulseYield}</span>
        {:else}
          <strong>Recharging</strong>
          <span class="num">{view.pulseCooldown.toFixed(1)}s</span>
        {/if}
      </button>
      <p class="hint">Click the field or press space</p>
    </div>

    {#if view.announceTitle}
      <div class="announce" role="status">
        <p class="eyebrow">{view.announceEyebrow}</p>
        <p class="title">{view.announceTitle}</p>
        <p class="body">{view.announceBody}</p>
      </div>
    {/if}

    {#if view.message}
      <p class="message" role="status">{view.message}</p>
    {/if}
  </section>

  <aside>
    <header>
      <h1>Idle Space Particle Game</h1>

      <p class="stage">
        <span class="stage-name">{view.stageName}</span>
        <span class="stage-analogue">≈ {view.stageAnalogue}</span>
      </p>

      <div
        class="progress"
        title={view.nextStageName ? `Towards ${view.nextStageName}` : 'Top of the accretion ladder'}
      >
        <div class="bar" style="width: {(view.stageFraction * 100).toFixed(2)}%"></div>
      </div>

      <p class="goal">
        {#if view.nextStageName}
          next: {view.nextStageName} at {view.nextStageThreshold}
          <!-- What the climb is worth, stated before you make it. -->
          {#if view.nextPromotion}<span class="pays">pays {view.nextPromotion}</span>{/if}
        {:else}
          As heavy as accretion alone can make you
        {/if}
      </p>
    </header>

    <nav class="tabs" aria-label="Sections">
      {#each tabs as entry (entry.id)}
        <button class:active={tab === entry.id} onclick={() => (tab = entry.id)}>
          {entry.label}
          {#if entry.id === 'energy' && view.nextElementName}
            <span class="pip" aria-hidden="true"></span>
          {/if}
          {#if entry.id === 'collapse' && view.canCollapse}
            <span class="pip" aria-hidden="true"></span>
          {/if}
        </button>
      {/each}
    </nav>

    {#if tab === 'core'}
      <div class="upgrades">
        {#each view.upgrades as upgrade (upgrade.id)}
          <UpgradeCard {upgrade} onbuy={game.buy} onautobuy={game.toggleAutoBuy} />
        {/each}
      </div>

      <Breakdown {view} />
    {:else if tab === 'energy'}
      <div class="readouts">
        <div>
          <p class="label">Energy</p>
          <p class="value num">{view.energy}</p>
        </div>
        <div>
          <p class="label">Per second</p>
          <p class="value num">+{view.energyPerSecond}</p>
        </div>
        <div>
          <p class="label">Throughput</p>
          <p class="value num">{view.throughput}</p>
        </div>
      </div>

      <Elements {view} />

      <div class="upgrades">
        {#each view.energyUpgrades as upgrade (upgrade.id)}
          <UpgradeCard {upgrade} onbuy={game.buy} onautobuy={game.toggleAutoBuy} />
        {/each}
      </div>
    {:else if tab === 'collapse'}
      <Collapse {view} {game} />
    {:else if tab === 'progress'}
      <Stages {view} />
      <Achievements {view} />
    {:else}
      <Settings
        {view}
        onnotation={game.setNotation}
        onbudget={game.setParticleBudget}
        onreserve={game.setAutoBuyReserve}
        onreducedmotion={game.setReducedMotion}
        onexport={game.exportSave}
        onimport={game.importSave}
        onreset={game.hardReset}
      />
    {/if}
  </aside>
</main>

<AwayDialog {view} ondismiss={game.dismissAway} />

<style>
  main {
    display: grid;
    grid-template-columns: 1fr minmax(19rem, 23rem);
    height: 100%;
    background: radial-gradient(ellipse at center, #0a1024 0%, #04050d 62%, #02030a 100%);
  }

  .stage {
    position: relative;
    overflow: hidden;
    min-height: 0;
  }

  .field {
    position: absolute;
    inset: 0;
  }

  .readout {
    position: absolute;
    top: 1.4rem;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    pointer-events: none;
    text-shadow: 0 0 24px rgba(4, 8, 20, 0.9);
  }

  .mass {
    margin: 0;
    font-size: clamp(1.8rem, 4.2vw, 2.9rem);
    font-weight: 300;
    letter-spacing: -0.02em;
  }

  .rate {
    margin: 0.15rem 0 0;
    font-size: 0.9rem;
    color: var(--accent);
  }

  .rate span {
    color: var(--dimmer);
    font-size: 0.75rem;
  }

  .controls {
    position: absolute;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    width: min(16rem, 80%);
  }

  .pulse {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.6rem 0.9rem;
    border-radius: 9px;
    border: 1px solid var(--line-strong);
    background: rgba(18, 30, 58, 0.72);
    backdrop-filter: blur(6px);
    transition: background 120ms ease, transform 80ms ease;
  }

  .pulse strong {
    font-size: 0.85rem;
    font-weight: 600;
  }

  .pulse .num {
    font-size: 0.8rem;
    color: var(--warm);
  }

  .pulse:hover:not(:disabled) {
    background: rgba(34, 54, 100, 0.85);
  }

  .pulse:active:not(:disabled) {
    transform: scale(0.98);
  }

  .pulse:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .hint {
    margin: 0.45rem 0 0;
    font-size: 0.7rem;
    color: var(--dimmer);
  }

  .announce {
    position: absolute;
    top: 7.5rem;
    left: 50%;
    transform: translateX(-50%);
    width: min(22rem, 80%);
    text-align: center;
    padding: 0.75rem 1rem 0.85rem;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    background: rgba(8, 12, 24, 0.82);
    backdrop-filter: blur(6px);
    animation: rise 420ms ease-out;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, 0.5rem);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .announce {
      animation: none;
    }
  }

  .announce .eyebrow {
    margin: 0;
    font-size: 0.65rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--dimmer);
  }

  .announce .title {
    margin: 0.15rem 0 0.35rem;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--warm);
  }

  .announce .body {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--dim);
  }

  .message {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    max-width: 22rem;
    text-align: center;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--bad);
    background: rgba(4, 6, 14, 0.88);
    border: 1px solid rgba(255, 138, 138, 0.3);
    border-radius: 9px;
    padding: 0.7rem 0.9rem;
  }

  aside {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 1rem 0.9rem 1.2rem;
    overflow-y: auto;
    border-left: 1px solid var(--line);
    background: var(--panel);
    backdrop-filter: blur(10px);
  }

  /* The stage is the thing you check most; it should not scroll away. */
  aside header {
    position: sticky;
    top: -1rem;
    z-index: 1;
    margin: -1rem -0.9rem 0.2rem;
    padding: 1rem 0.9rem 0.6rem;
    background: rgba(11, 16, 32, 0.97);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
    box-shadow: 0 10px 14px -12px rgba(0, 0, 0, 0.8);
  }

  h1 {
    margin: 0 0 0.5rem;
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--dim);
  }

  .stage {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    margin: 0 0 0.45rem;
  }

  .stage-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--warm);
  }

  .stage-analogue {
    font-size: 0.68rem;
    color: var(--dimmer);
    text-align: right;
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

  .pays {
    margin-left: 0.4rem;
    padding: 0 0.3rem;
    border: 1px solid currentColor;
    border-radius: 999px;
    font-size: 0.68rem;
    opacity: 0.8;
  }

  .goal {
    margin: 0.35rem 0 0;
    font-size: 0.7rem;
    color: var(--dimmer);
  }

  .upgrades {
    display: grid;
    gap: 0.5rem;
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.2rem;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: rgba(6, 9, 20, 0.6);
  }

  .tabs button {
    position: relative;
    flex: 1;
    padding: 0.35rem 0.4rem;
    border: none;
    border-radius: 7px;
    background: transparent;
    font-size: 0.78rem;
    color: var(--dimmer);
    transition: background 120ms ease, color 120ms ease;
  }

  .tabs button:hover {
    color: var(--dim);
  }

  .tabs button.active {
    background: rgba(48, 70, 122, 0.55);
    color: var(--text);
  }

  .pip {
    position: absolute;
    top: 0.3rem;
    right: 0.35rem;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--warm);
  }

  .readouts {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .readouts div {
    border: 1px solid var(--line);
    border-radius: 9px;
    background: rgba(9, 13, 26, 0.5);
    padding: 0.5rem 0.55rem;
  }

  .readouts .label {
    margin: 0;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dimmer);
  }

  .readouts .value {
    margin: 0.2rem 0 0;
    font-size: 0.85rem;
    color: var(--warm);
  }

  @media (max-width: 760px) {
    main {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(15rem, 45vh) 1fr;
    }

    aside {
      border-left: none;
      border-top: 1px solid var(--line);
    }
  }
</style>
