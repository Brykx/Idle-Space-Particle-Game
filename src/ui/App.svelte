<script lang="ts">
  import { onMount } from 'svelte';
  import { game } from '../game.svelte';
  import Caption from './Caption.svelte';
  import Whisper from './Whisper.svelte';
  import Current from './Current.svelte';
  import Breakdown from './Breakdown.svelte';
  import Sky from './Sky.svelte';
  import Journal from './Journal.svelte';
  import Elements from './Elements.svelte';
  import Settings from './Settings.svelte';
  import AwayDialog from './AwayDialog.svelte';

  const view = game.view;

  let stage: HTMLDivElement;

  type Tab = 'system' | 'energy' | 'sky' | 'journal' | 'settings';
  let tab = $state<Tab>('system');
  let sheetOpen = $state(false);

  // Pages appear as they start to mean something. Energy once there is a disk; the sky once
  // the core is a star that could be let go, and from then on for good, because after the
  // first star it holds the sky and the tree. Before that, a page offering an ending to a run
  // you have not finished is only a spoiler.
  const tabs = $derived(
    [
      { id: 'system' as const, label: 'System' },
      ...(view.energyUnlocked ? [{ id: 'energy' as const, label: 'Energy' }] : []),
      ...(view.canRelease || view.choosing || view.sky.length > 0 ? [{ id: 'sky' as const, label: 'Sky' }] : []),
      { id: 'journal' as const, label: 'Journal' },
      { id: 'settings' as const, label: 'Settings' },
    ],
  );

  function openSheet(at?: Tab): void {
    if (at) tab = at;
    sheetOpen = true;
  }

  // The interface dims when you stop moving, and comes back the moment you do. The field is
  // the thing to look at; the words are there when you want them.
  let idle = $state(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const IDLE_AFTER_MS = 9000;

  function wake(): void {
    // Browsers only start audio from a gesture, and any movement here may be one.
    game.unlockAudio();
    idle = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => (idle = true), IDLE_AFTER_MS);
  }

  function onKey(event: KeyboardEvent): void {
    wake();
    if (event.key === 'Escape' && sheetOpen) sheetOpen = false;
  }

  onMount(() => {
    void game.start(stage);
    wake();
    return () => {
      clearTimeout(idleTimer);
      game.stop();
    };
  });
</script>

<svelte:window onpointermove={wake} onpointerdown={wake} onkeydown={onKey} />

<main
  class="app"
  class:idle={idle && !sheetOpen}
  class:still={view.reducedMotion}
  style="--accent: {view.accent}"
>
  <!-- The field is the whole screen. It renders the numbers; it never produces them. Touching
       it stirs it, which pays nothing, and closes the sheet if one is open. -->
  <div
    class="field"
    bind:this={stage}
    aria-hidden="true"
    onpointerdown={() => {
      if (sheetOpen) sheetOpen = false;
    }}
  ></div>

  <Whisper {view} />

  {#if view.message}
    <p class="message" role="status">{view.message}</p>
  {/if}

  <Caption {view} {game} onopen={openSheet} />

  {#if !sheetOpen}
    <button class="summon" aria-label="Open the sheet" aria-expanded="false" onclick={() => openSheet()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h9" /></svg>
    </button>
  {/if}

  <div class="sheet" class:open={sheetOpen} data-testid="sheet" inert={!sheetOpen} aria-hidden={!sheetOpen}>
    <header>
      <nav class="tabs" aria-label="Sections">
        {#each tabs as entry (entry.id)}
          <button class:active={tab === entry.id} aria-current={tab === entry.id ? 'page' : undefined} onclick={() => (tab = entry.id)}>
            {entry.label}
          </button>
        {/each}
      </nav>
      <button class="close" aria-label="Close the sheet" onclick={() => (sheetOpen = false)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
      </button>
    </header>

    <div class="page">
      {#if tab === 'system'}
        <section class="where">
          <p class="where-stage">
            <span class="sheet-stage">{view.choosing ? 'Between stars' : view.stageName}</span>
            {#if !view.choosing}<span class="stage-analogue">≈ {view.stageAnalogue}</span>{/if}
          </p>
          <div class="progress" aria-hidden="true">
            <div class="bar" style="width: {(view.stageFraction * 100).toFixed(2)}%"></div>
          </div>
          <p class="goal">
            {#if view.nextStageName}
              next: {view.nextStageName} at {view.nextStageThreshold}
              <!-- What the climb is worth, stated before you make it. -->
              {#if view.nextPromotion}<span class="pays">pays {view.nextPromotion}</span>{/if}
            {:else if view.choosing}
              Choose the next cloud on the Sky page.
            {:else}
              As large as this cloud can make you
            {/if}
          </p>
        </section>

        <h2>Currents</h2>
        <div class="currents">
          {#each view.upgrades as upgrade (upgrade.id)}
            <Current {upgrade} onbuy={game.buy} onautobuy={game.toggleAutoBuy} />
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

        <h2>Currents</h2>
        <div class="currents">
          {#each view.energyUpgrades as upgrade (upgrade.id)}
            <Current {upgrade} onbuy={game.buy} onautobuy={game.toggleAutoBuy} />
          {/each}
        </div>
      {:else if tab === 'sky'}
        <Sky {view} {game} />
      {:else if tab === 'journal'}
        <Journal {view} />
      {:else}
        <Settings
          {view}
          onnotation={game.setNotation}
          onbudget={game.setParticleBudget}
          onreserve={game.setAutoBuyReserve}
          onreducedmotion={game.setReducedMotion}
          onsound={game.setSound}
          onvolume={game.setVolume}
          onexport={game.exportSave}
          onimport={game.importSave}
          onreset={game.hardReset}
        />
      {/if}
    </div>
  </div>
</main>

<AwayDialog {view} ondismiss={game.dismissAway} />

<style>
  .app {
    position: relative;
    height: 100%;
    overflow: hidden;
    background: radial-gradient(ellipse at center, #070b1a 0%, #03040b 64%, #02030a 100%);
  }

  .field {
    position: absolute;
    inset: 0;
  }

  /* Everything that is not the field recedes when you stop moving. */
  .app :global(.caption),
  .summon {
    transition: opacity 2.4s ease;
  }

  .app.idle :global(.caption),
  .app.idle .summon {
    opacity: 0.28;
  }

  .summon,
  .close {
    display: grid;
    place-items: center;
    width: 2.4rem;
    height: 2.4rem;
    padding: 0;
    border-radius: 50%;
    border: 1px solid rgba(200, 215, 255, 0.16);
    background: rgba(6, 9, 20, 0.45);
    backdrop-filter: blur(6px);
  }

  .summon {
    position: absolute;
    top: max(1.2rem, env(safe-area-inset-top));
    right: max(1.2rem, env(safe-area-inset-right));
  }

  .summon:hover,
  .close:hover {
    border-color: var(--accent);
  }

  svg {
    width: 1.1rem;
    height: 1.1rem;
    fill: none;
    stroke: var(--text);
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  .message {
    position: absolute;
    left: 50%;
    bottom: 50%;
    transform: translate(-50%, 50%);
    margin: 0;
    max-width: min(24rem, calc(100vw - 2rem));
    text-align: center;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--bad);
    background: rgba(4, 6, 14, 0.88);
    border: 1px solid rgba(255, 138, 138, 0.3);
    border-radius: 9px;
    padding: 0.7rem 0.9rem;
  }

  /* --- the sheet ------------------------------------------------------------------- */

  .sheet {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(25rem, 100vw);
    display: flex;
    flex-direction: column;
    background: rgba(9, 12, 25, 0.86);
    backdrop-filter: blur(14px);
    border-left: 1px solid var(--line);
    box-shadow: -20px 0 50px rgba(0, 0, 0, 0.35);
    transform: translateX(102%);
    visibility: hidden;
    transition:
      transform 520ms cubic-bezier(0.22, 0.8, 0.3, 1),
      visibility 0s linear 520ms;
  }

  .sheet.open {
    transform: none;
    visibility: visible;
    transition:
      transform 520ms cubic-bezier(0.22, 0.8, 0.3, 1),
      visibility 0s;
  }

  .app.still .sheet,
  .app.still .sheet.open {
    transition: none;
  }

  .sheet header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: max(0.9rem, env(safe-area-inset-top)) 0.9rem 0.6rem;
    border-bottom: 1px solid var(--line);
  }

  .tabs {
    flex: 1;
    display: flex;
    gap: 0.15rem;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tabs button {
    flex: 0 0 auto;
    padding: 0.35rem 0.55rem;
    border: none;
    border-radius: 999px;
    background: transparent;
    font-size: 0.8rem;
    color: var(--dimmer);
    transition: color 160ms ease, background 160ms ease;
  }

  .tabs button:hover {
    color: var(--dim);
  }

  .tabs button.active {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
    box-shadow: inset 0 -1px 0 var(--accent);
  }

  .close {
    flex: 0 0 auto;
    width: 2rem;
    height: 2rem;
  }

  .page {
    flex: 1;
    overflow-y: auto;
    padding: 0.9rem 1rem max(1.4rem, env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  h2 {
    margin: 0.3rem 0 -0.4rem;
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--dimmer);
  }

  .where-stage {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    margin: 0 0 0.45rem;
  }

  .sheet-stage {
    font-size: 1.05rem;
    color: var(--accent);
  }

  .stage-analogue {
    font-size: 0.7rem;
    color: var(--dimmer);
    text-align: right;
  }

  .progress {
    height: 2px;
    background: rgba(200, 215, 255, 0.12);
  }

  .bar {
    height: 100%;
    background: var(--accent);
    transition: width 600ms ease;
  }

  .goal {
    margin: 0.4rem 0 0;
    font-size: 0.72rem;
    color: var(--dimmer);
  }

  .pays {
    margin-left: 0.4rem;
    padding: 0 0.35rem;
    border: 1px solid currentColor;
    border-radius: 999px;
    font-size: 0.66rem;
  }

  .currents {
    display: grid;
  }

  .readouts {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .readouts .label {
    margin: 0;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--dimmer);
  }

  .readouts .value {
    margin: 0.15rem 0 0;
    font-size: 0.95rem;
  }

  /* --- a phone: the sheet comes up from the bottom ----------------------------------- */

  @media (max-width: 720px) {
    .sheet {
      top: auto;
      left: 0;
      width: 100%;
      height: min(78vh, 44rem);
      border-left: none;
      border-top: 1px solid var(--line);
      border-radius: 18px 18px 0 0;
      box-shadow: 0 -20px 50px rgba(0, 0, 0, 0.4);
      transform: translateY(102%);
    }

    .sheet header {
      padding-top: 0.8rem;
    }
  }
</style>
