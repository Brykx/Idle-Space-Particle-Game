import { format, formatDuration, type Notation } from './sim/numbers';
import {
  buy,
  deriveRates,
  isUnlocked,
  nextCost,
  pulse as pulseEconomy,
  tick,
} from './sim/economy';
import { initialState, type GameState } from './sim/state';
import { UPGRADE_LIST, maxAffordable, type UpgradeId } from './sim/upgrades';
import { applyOffline, type AwayReport } from './sim/offline';
import { STAGES, stageAt, stageIndexFor, stageProgress } from './sim/stages';
import { deserialize, exportSave as exportSaveString, importSave, serialize } from './sim/save';
import { clearSave, readSave, writeSave } from './storage';
import { createField, type FieldHandle } from './render/Field';

/**
 * The loop, and the view the UI reads.
 *
 * Three clocks, deliberately separate:
 *   - the economy advances in fixed 20 Hz steps, so a 144 Hz monitor cannot out-earn a 60 Hz one
 *   - the UI refreshes at 12 Hz, because nobody reads digits faster than that
 *   - the renderer runs on its own ticker at whatever the display gives it
 *
 * Elapsed time comes from `Date.now()`, never from frame deltas. Background tabs throttle
 * `requestAnimationFrame` to a crawl or stop it altogether, and the wall clock is the only
 * thing that keeps telling the truth through that.
 */

const TICK = 1 / 20;
const UI_INTERVAL = 1 / 12;
const FIELD_INTERVAL = 1 / 4;
const AUTOSAVE_INTERVAL = 10;
/** How long a stage announcement stays on screen. */
const ANNOUNCE_SECONDS = 7;
/** A gap larger than this is treated as an absence and credited through the offline path. */
const OFFLINE_THRESHOLD = 2;

export interface UpgradeView {
  id: UpgradeId;
  name: string;
  blurb: string;
  term: string;
  perLevel: string;
  level: number;
  cost: string;
  affordable: boolean;
  maxLevels: number;
  maxCost: string;
  /** Seconds until affordable, already formatted. Empty when affordable now. */
  eta: string;
}

export interface StageRowView {
  id: string;
  name: string;
  analogue: string;
  /** Formatted threshold, or an em dash for the stages a collapse brings. */
  threshold: string;
  viaCollapse: boolean;
  reached: boolean;
  current: boolean;
}

export interface View {
  mass: string;
  massPerSecond: string;

  stageName: string;
  stageAnalogue: string;
  /** 0..1 towards the next stage, measured in orders of magnitude. */
  stageFraction: number;
  nextStageName: string;
  nextStageThreshold: string;
  stages: StageRowView[];

  /** Set when a stage is reached; clears itself after a few seconds. */
  announceTitle: string;
  announceBody: string;

  spawnRate: string;
  captureFraction: string;
  massPerParticle: string;
  globalMultiplier: string;

  upgrades: UpgradeView[];

  pulseReady: boolean;
  pulseCooldown: number;
  pulseYield: string;

  playTime: string;
  purchases: number;
  pulses: number;

  notation: Notation;
  particleBudget: number;
  reducedMotion: boolean;

  away: AwayReport | null;
  awayGained: string;
  awayDuration: string;
  /** Set when the absence promoted you, e.g. "Planet". */
  awayStage: string;

  message: string;
  saved: boolean;
}

function emptyView(): View {
  return {
    mass: '0',
    massPerSecond: '0',
    stageName: '',
    stageAnalogue: '',
    stageFraction: 0,
    nextStageName: '',
    nextStageThreshold: '',
    stages: [],
    announceTitle: '',
    announceBody: '',
    spawnRate: '0',
    captureFraction: '0%',
    massPerParticle: '0',
    globalMultiplier: 'x1',
    upgrades: [],
    pulseReady: true,
    pulseCooldown: 0,
    pulseYield: '0',
    playTime: '0s',
    purchases: 0,
    pulses: 0,
    notation: 'letters',
    particleBudget: 1200,
    reducedMotion: false,
    away: null,
    awayGained: '0',
    awayDuration: '',
    awayStage: '',
    message: '',
    saved: false,
  };
}

function createGame() {
  const view = $state<View>(emptyView());

  let state: GameState = initialState();
  let field: FieldHandle | null = null;

  let running = false;
  let frameHandle = 0;
  let accumulator = 0;
  let uiTimer = 0;
  let fieldTimer = 0;
  let saveTimer = 0;
  let messageTimer = 0;
  let announceTimer = 0;

  // ---------------------------------------------------------------- loading and saving

  function load(): void {
    const raw = readSave();
    if (raw === null) {
      state = initialState();
      return;
    }
    try {
      state = deserialize(raw);
      const stageBefore = stageIndexFor(state.totalMassEver);
      const report = applyOffline(state);
      if (report) showAway(report, stageBefore);
    } catch (error) {
      // A save we cannot read is not a save we should overwrite silently.
      state = initialState();
      flash(`Could not load your save (${(error as Error).message}). Started fresh.`);
    }
  }

  function save(): void {
    state.lastSeen = Date.now();
    view.saved = writeSave(serialize(state));
    if (!view.saved) flash('Could not write to local storage — progress is not being saved.');
  }

  function showAway(report: AwayReport, stageBefore: number): void {
    view.away = report;
    view.awayGained = format(report.gained, state.settings.notation);
    view.awayDuration = formatDuration(report.awaySeconds);

    const stageAfter = stageIndexFor(state.totalMassEver);
    view.awayStage = stageAfter > stageBefore ? stageAt(stageAfter).name : '';
    // The dialog says it, so the banner does not need to as well.
    state.stageSeen = Math.max(state.stageSeen, stageAfter);
  }

  function flash(message: string): void {
    view.message = message;
    messageTimer = 6;
  }

  function announce(title: string, body: string): void {
    view.announceTitle = title;
    view.announceBody = body;
    announceTimer = ANNOUNCE_SECONDS;
  }

  // ---------------------------------------------------------------- the view

  function refreshView(): void {
    const rates = deriveRates(state);
    const notation = state.settings.notation;

    view.mass = format(state.mass, notation);
    view.massPerSecond = format(rates.massPerSecond, notation);

    const progress = stageProgress(state.totalMassEver);
    view.stageName = progress.stage.name;
    view.stageAnalogue = progress.stage.analogue;
    view.stageFraction = progress.fraction;
    view.nextStageName = progress.next?.name ?? '';
    view.nextStageThreshold = progress.next?.threshold
      ? format(progress.next.threshold, notation)
      : '';

    view.stages = STAGES.map((stage, index) => ({
      id: stage.id,
      name: stage.name,
      analogue: stage.analogue,
      threshold: stage.threshold ? format(stage.threshold, notation) : '—',
      viaCollapse: stage.threshold === null,
      reached: stage.threshold !== null && index <= progress.index,
      current: index === progress.index,
    }));

    // Announce a promotion once. If several were crossed at once — a big pulse, a long
    // absence — only the highest is worth saying.
    if (progress.index > state.stageSeen) {
      state.stageSeen = progress.index;
      announce(progress.stage.name, progress.stage.blurb);
    }

    view.spawnRate = rates.spawnRate.toFixed(1);
    view.captureFraction = `${(rates.captureFraction * 100).toFixed(1)}%`;
    view.massPerParticle = format(rates.massPerParticle, notation);
    view.globalMultiplier = `x${rates.globalMultiplier.toFixed(2)}`;

    view.upgrades = UPGRADE_LIST.filter((def) => isUnlocked(state, def)).map((def) => {
      const cost = nextCost(state, def.id);
      const affordable = state.mass.gte(cost);
      const best = maxAffordable(def, state.levels[def.id], state.mass);
      const seconds = affordable
        ? 0
        : rates.massPerSecond.lte(0)
          ? Infinity
          : cost.sub(state.mass).div(rates.massPerSecond).toNumber();

      return {
        id: def.id,
        name: def.name,
        blurb: def.blurb,
        term: def.term,
        perLevel: def.perLevel,
        level: state.levels[def.id],
        cost: format(cost, notation),
        affordable,
        maxLevels: best.levels,
        maxCost: format(best.cost, notation),
        eta: affordable ? '' : formatDuration(seconds),
      };
    });

    view.pulseReady = state.playTime >= state.pulseReadyAt;
    view.pulseCooldown = Math.max(0, state.pulseReadyAt - state.playTime);
    view.pulseYield = format(rates.pulseYield, notation);

    view.playTime = formatDuration(state.playTime);
    view.purchases = state.stats.purchases;
    view.pulses = state.stats.pulses;

    view.notation = notation;
    view.particleBudget = state.settings.particleBudget;
    view.reducedMotion = state.settings.reducedMotion;
  }

  function refreshField(): void {
    if (!field) return;
    const rates = deriveRates(state);
    const { look } = stageAt(stageIndexFor(state.totalMassEver));
    field.setRates({
      // Emission tracks the real spawn rate until it outgrows the screen, then grows
      // logarithmically so the field keeps thickening without ever flooding.
      spawnRate: rates.spawnRate <= 60 ? rates.spawnRate : 60 + Math.log10(rates.spawnRate / 60) * 80,
      captureFraction: rates.captureFraction,
      coreScale: look.scale,
      coreColour: look.core,
      particleColour: look.particle,
      budget: state.settings.particleBudget,
      reducedMotion: state.settings.reducedMotion,
    });
  }

  // ---------------------------------------------------------------- the loop

  function step(): void {
    const now = Date.now();
    const gap = (now - state.lastSeen) / 1000;

    if (gap > OFFLINE_THRESHOLD) {
      // Throttled to a standstill, asleep, or the tab was hidden. Credit it properly.
      applyOffline(state, now);
      accumulator = 0;
    } else if (gap > 0) {
      state.lastSeen = now;
      accumulator += gap;
      // Bound the catch-up so a hitch cannot spiral into a long synchronous burst.
      if (accumulator > 1) accumulator = 1;
      while (accumulator >= TICK) {
        tick(state, TICK);
        accumulator -= TICK;
      }
    } else {
      state.lastSeen = now;
    }

    const dt = Math.max(0, Math.min(gap, 1));

    uiTimer -= dt;
    if (uiTimer <= 0) {
      uiTimer = UI_INTERVAL;
      refreshView();
    }

    fieldTimer -= dt;
    if (fieldTimer <= 0) {
      fieldTimer = FIELD_INTERVAL;
      refreshField();
    }

    saveTimer -= dt;
    if (saveTimer <= 0) {
      saveTimer = AUTOSAVE_INTERVAL;
      save();
    }

    if (messageTimer > 0) {
      messageTimer -= dt;
      if (messageTimer <= 0) view.message = '';
    }

    if (announceTimer > 0) {
      announceTimer -= dt;
      if (announceTimer <= 0) {
        view.announceTitle = '';
        view.announceBody = '';
      }
    }

    if (running) frameHandle = requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- lifecycle

  async function start(fieldParent: HTMLElement): Promise<void> {
    load();
    refreshView();

    try {
      field = await createField(fieldParent, { onPulse: () => actions.pulse() });
      refreshField();
    } catch (error) {
      // No WebGL, or a context that refused to start. The game is entirely playable without
      // the canvas — that is the whole point of keeping it cosmetic.
      flash('Could not start the particle field. The game still works.');
      console.warn('Particle field unavailable:', error);
    }

    running = true;
    // The loop derives elapsed time from `lastSeen`; stamp it so the first frame is not
    // credited with the whole load time.
    state.lastSeen = Date.now();
    frameHandle = requestAnimationFrame(step);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', save);
  }

  function onVisibilityChange(): void {
    // `beforeunload` does not fire reliably on mobile; this and `pagehide` do.
    if (document.visibilityState === 'hidden') save();
  }

  function stop(): void {
    running = false;
    cancelAnimationFrame(frameHandle);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', save);
    field?.destroy();
    field = null;
    save();
  }

  // ---------------------------------------------------------------- actions

  const actions = {
    buy(id: UpgradeId, amount: number | 'max'): void {
      if (buy(state, id, amount) > 0) {
        refreshView();
        refreshField();
      }
    },

    pulse(): void {
      if (pulseEconomy(state) === null) return;
      field?.pulse();
      refreshView();
    },

    setNotation(notation: Notation): void {
      state.settings.notation = notation;
      refreshView();
    },

    setParticleBudget(budget: number): void {
      state.settings.particleBudget = Math.max(0, Math.min(20000, Math.round(budget)));
      refreshView();
      refreshField();
    },

    setReducedMotion(on: boolean): void {
      state.settings.reducedMotion = on;
      refreshView();
      refreshField();
    },

    dismissAway(): void {
      view.away = null;
    },

    exportSave(): string {
      save();
      return exportSaveString(state);
    },

    importSave(text: string): boolean {
      try {
        state = importSave(text);
        applyOffline(state);
        save();
        refreshView();
        refreshField();
        flash('Save imported.');
        return true;
      } catch (error) {
        flash(`Import failed: ${(error as Error).message}`);
        return false;
      }
    },

    hardReset(): void {
      const settings = { ...state.settings };
      clearSave();
      state = initialState();
      state.settings = settings;
      accumulator = 0;
      save();
      refreshView();
      refreshField();
      flash('Everything reset.');
    },
  };

  return { view, start, stop, ...actions };
}

export const game = createGame();
