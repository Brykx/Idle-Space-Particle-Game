import { format, formatDuration, type Notation } from './sim/numbers';
import {
  buy,
  canAfford,
  currentsOpen,
  deriveRates,
  isFlowing,
  isOpen,
  isUnlocked,
  nextCost,
  paybackHorizon,
  paybackSeconds,
  promotionMultiplier,
  tick,
} from './sim/economy';
import { ACHIEVEMENTS, multiplierFor } from './sim/achievements';
import { ELEMENTS, REACHABLE_ELEMENTS, elementAt } from './sim/elements';
import { initialState, type GameState } from './sim/state';
import { UPGRADE_LIST, maxAffordable, type UpgradeId } from './sim/upgrades';
import { applyOffline, type AwayReport } from './sim/offline';
import {
  STARDUST_LIST,
  buyStardust,
  canRelease,
  chooseCloud,
  discoveryFor,
  offersFor,
  release,
  releaseValue,
  renameStar,
  stardustCost,
  treeEffects,
  yieldFor,
  type StardustId,
} from './sim/sky';
import { TRAIT_DEFS, capOf, ceilingStageOf } from './sim/clouds';
import { forecastCloud, forecastRun, roughly } from './sim/forecast';
import { STAGES, stageAt, stageIndexById, stageIndexFor, stageOfClass, stageProgress, type Fate } from './sim/stages';
import { COMPLETE_AT } from './sim/clouds';

/** Blend two packed RGB colours. */
function mixRgb(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

/** Stardust is a counting number, so it is shown as one. */
function formatStardust(value: number): string {
  return Math.floor(value).toLocaleString('en-US');
}

/** What a star leaves, as a phrase that finishes "it leaves…". */
const FATE_WORDS: Record<Fate, string> = {
  ember: 'nothing: a red dwarf has never died',
  nebula: 'a white dwarf, in a shell of its own gas',
  supernova: 'a supernova, and a neutron star',
};

/** CSS colour for a packed RGB number. */
const css = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

/**
 * The interface's one colour, taken from whatever is in the middle of the screen.
 *
 * Lifted towards white until it reads against the dark: a boulder's grey-brown is the right
 * hue for the accent and much too dim to be one.
 */
function accentOf(rgb: number): string {
  let r = (rgb >> 16) & 255;
  let g = (rgb >> 8) & 255;
  let b = rgb & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const want = 0.72;
  if (luminance < want) {
    const t = (want - luminance) / (1 - luminance);
    r = Math.round(r + (255 - r) * t);
    g = Math.round(g + (255 - g) * t);
    b = Math.round(b + (255 - b) * t);
  }
  return `rgb(${r}, ${g}, ${b})`;
}
import { deserialize, exportSave as exportSaveString, importSave, serialize } from './sim/save';
import { clearSave, readSave, writeSave } from './storage';
import { createField, type FieldHandle, type SkyStar } from './render/Field';
import { createAmbience, type Ambience } from './audio/ambience';

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
/** How long an announcement stays on screen. */
const ANNOUNCE_SECONDS = 5;

/** How long letting a star go is a moment, for the parts of the view that wait on it. */
const RELEASE_SECONDS = 9;
/** More than this unlocking at once is summarised rather than queued one by one. */
const ANNOUNCE_BATCH_LIMIT = 2;
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
  /** What one more level does to income, e.g. "+4.2%". Shows when an upgrade has gone flat. */
  gain: string;
  autoBuy: boolean;
  /** Begun by hand at least once, so it can flow. */
  open: boolean;
  /**
   * Where the current stands:
   * - `closed`: never begun. One purchase by hand opens it.
   * - `flowing`: growing by itself.
   * - `settled`: flowing, but a level would not repay itself soon enough, so it is left alone.
   * - `held`: held back by the player, to be tended by hand.
   */
  state: 'closed' | 'flowing' | 'settled' | 'held';
  /** Closed, and the first level can be afforded now. */
  canBegin: boolean;
  /** Resets to zero at every promotion, and is repriced to the new stage. */
  rebased: boolean;
  currency: 'mass' | 'energy';
}

export interface StardustView {
  id: StardustId;
  name: string;
  blurb: string;
  perLevel: string;
  /** What the levels you own currently do, e.g. "x2.01 to all mass". */
  effect: string;
  level: number;
  cost: string;
  affordable: boolean;
  maxed: boolean;
  maxLevel: number;
}

export interface CloudView {
  index: number;
  name: string;
  /** The largest class it can make, e.g. "Blue Giant". */
  ceiling: string;
  letter: string;
  colour: string;
  trait: string;
  traitBlurb: string;
  /** Roughly how long a star from it would take, in words. */
  eta: string;
  /** Stardust the finished star would pay, discovery included. */
  worth: number;
  /** The first of its class: it would fill a place in the catalogue. */
  discovery: boolean;
  hue: number;
}

export interface StarView {
  id: number;
  name: string;
  className: string;
  letter: string;
  colour: string;
  /** The day you made it. */
  made: string;
  /** How long it took, from choosing its cloud. */
  took: string;
  completed: boolean;
  cloud: string;
  x: number;
  y: number;
}

export interface ElementRowView {
  id: string;
  name: string;
  symbol: string;
  multiplier: string;
  /** Throughput it asks for, formatted — or an em dash for iron. */
  requires: string;
  reached: boolean;
  current: boolean;
  unreachable: boolean;
}

export interface AchievementRowView {
  id: string;
  name: string;
  how: string;
  unlocked: boolean;
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
  /** Mass in words. Repainted once a second: a number that changes faster is a clock to watch. */
  mass: string;
  massPerSecond: string;

  /** The interface's one colour, taken from the body in the middle of the screen. */
  accent: string;
  /** 0..1 along the caption's hairline: towards the next stage, or towards the cloud's end. */
  hairline: number;
  /** The caption's second line: what comes next, and roughly when. */
  captionNext: string;
  /** A current that can be begun right now, offered in the caption. Null when there is none. */
  beginnable: { id: UpgradeId; name: string; cost: string } | null;

  stageName: string;
  stageAnalogue: string;
  /** 0..1 towards the next stage, measured in orders of magnitude. */
  stageFraction: number;
  nextStageName: string;
  nextStageThreshold: string;
  /** What the ladder is paying right now, e.g. "x24". Empty at the bottom, where it pays nothing. */
  ladderBonus: string;
  /** What the next promotion would multiply income by, e.g. "x2.9". Empty at the top. */
  nextPromotion: string;
  stages: StageRowView[];

  // --- the run -------------------------------------------------------------------------
  /** Between stars, choosing the next cloud. The field is empty. */
  choosing: boolean;
  cloudName: string;
  /** The largest class this cloud can make. */
  cloudCeiling: string;
  cloudTrait: string;
  cloudHue: number;
  /** 0..1 of the cloud still unspent. */
  remaining: number;
  /** The cloud is spent: the star is finished, and waiting to be let go. */
  complete: boolean;
  /** Roughly how long until it is, in words. Empty when it is, or between stars. */
  eta: string;
  offers: CloudView[];

  // --- letting go ----------------------------------------------------------------------
  canRelease: boolean;
  /** The class it would be let go as. */
  releaseAs: string;
  /** What it would leave behind, in words. */
  releaseFate: string;
  releaseStardust: number;
  releaseDiscovery: number;
  /** True while the field is showing what the star left, just after it was let go. */
  releasing: boolean;

  // --- the sky -------------------------------------------------------------------------
  stardust: string;
  stardustUpgrades: StardustView[];
  sky: StarView[];
  /** What the stars in your sky multiply all mass by, e.g. "x1.12". */
  skyBonus: string;

  /** Set when something is unlocked; clears itself after a few seconds. */
  announceEyebrow: string;
  announceTitle: string;
  announceBody: string;

  achievements: AchievementRowView[];
  achievementsUnlocked: number;
  achievementCount: number;
  achievementMultiplier: string;

  autoBuyReserve: number;
  autoBuyersUnlocked: number;

  spawnRate: string;
  captureFraction: string;
  massPerParticle: string;
  globalMultiplier: string;

  /** The five that feed the mass formula. */
  upgrades: UpgradeView[];
  /** The energy economy's own upgrades. */
  energyUpgrades: UpgradeView[];

  energyUnlocked: boolean;
  energy: string;
  energyPerSecond: string;
  throughput: string;
  elementName: string;
  elementSymbol: string;
  elementBlurb: string;
  elementMultiplier: string;
  /** 0..1 towards the next fusion tier, in orders of throughput. */
  elementProgress: number;
  nextElementName: string;
  elements: ElementRowView[];

  playTime: string;
  purchases: number;

  notation: Notation;
  particleBudget: number;
  reducedMotion: boolean;
  sound: boolean;
  volume: number;

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
    accent: 'rgb(200, 210, 230)',
    hairline: 0,
    captionNext: '',
    beginnable: null,
    stageName: '',
    stageAnalogue: '',
    stageFraction: 0,
    nextStageName: '',
    nextStageThreshold: '',
    ladderBonus: '',
    nextPromotion: '',
    choosing: false,
    cloudName: '',
    cloudCeiling: '',
    cloudTrait: '',
    cloudHue: 214,
    remaining: 1,
    complete: false,
    eta: '',
    offers: [],
    canRelease: false,
    releaseAs: '',
    releaseFate: '',
    releaseStardust: 0,
    releaseDiscovery: 0,
    releasing: false,
    stardust: '0',
    stardustUpgrades: [],
    sky: [],
    skyBonus: 'x1.00',
    stages: [],
    announceEyebrow: '',
    announceTitle: '',
    announceBody: '',
    achievements: [],
    achievementsUnlocked: 0,
    achievementCount: ACHIEVEMENTS.length,
    achievementMultiplier: 'x1.00',
    autoBuyReserve: 0,
    autoBuyersUnlocked: 0,
    spawnRate: '0',
    captureFraction: '0%',
    massPerParticle: '0',
    globalMultiplier: 'x1',
    upgrades: [],
    energyUpgrades: [],
    energyUnlocked: false,
    energy: '0',
    energyPerSecond: '0',
    throughput: '0%',
    elementName: '',
    elementSymbol: '',
    elementBlurb: '',
    elementMultiplier: 'x1.00',
    elementProgress: 0,
    nextElementName: '',
    elements: [],
    playTime: '0s',
    purchases: 0,
    notation: 'words',
    particleBudget: 1200,
    reducedMotion: false,
    sound: false,
    volume: 0.6,
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
  let ambience: Ambience | null = null;

  let running = false;
  let frameHandle = 0;
  let accumulator = 0;
  /** `playTime` until which the field shows what the last star left, not the new run. */
  let releasingUntil = 0;
  /** Forecasts are a simulation, so they are kept and refreshed rather than redone per frame. */
  let etaCache = { key: '', at: -Infinity, finished: '', nextStage: '' };
  /** Wall-clock ms the caption's mass was last repainted. */
  let massPaintedAt = 0;
  let offersCache: { key: string; views: CloudView[] } = { key: '', views: [] };
  let uiTimer = 0;
  let fieldTimer = 0;
  let saveTimer = 0;
  let messageTimer = 0;
  let announceTimer = 0;
  const announcements: Array<{ eyebrow: string; title: string; body: string }> = [];
  /** How many unlocked achievements have already been announced. */
  let achievementsAnnounced = 0;

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
      achievementsAnnounced = state.achievements.length;
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

  /**
   * Announcements queue rather than overwrite: a long absence can land a stage promotion and
   * several achievements at once, and the last one winning would hide the rest.
   */
  function announce(eyebrow: string, title: string, body: string): void {
    announcements.push({ eyebrow, title, body });
  }

  function showNextAnnouncement(): void {
    const next = announcements.shift();
    if (!next) return;
    view.announceEyebrow = next.eyebrow;
    view.announceTitle = next.title;
    view.announceBody = next.body;
    announceTimer = ANNOUNCE_SECONDS;
  }

  // ---------------------------------------------------------------- forecasts

  /** A stage id from a save, as a ladder index, without throwing on one this build lacks. */
  function safeStageIndex(id: string): number {
    try {
      return stageIndexById(id);
    } catch {
      return 0;
    }
  }

  /**
   * Roughly when this star will be finished. Re-forecast every half minute of play, or when
   * something the forecast depends on changes; a word does not need refreshing per frame.
   */
  function runEta(): { finished: string; nextStage: string } {
    if (!state.cloud) return { finished: '', nextStage: '' };
    const key = `${state.sky.length}|${state.cloud.seed}|${stageIndexFor(state.totalMassEver)}|${Object.values(state.stardustLevels).join(',')}`;
    if (key !== etaCache.key || state.playTime - etaCache.at > 30) {
      const forecast = forecastRun(state);
      etaCache = {
        key,
        at: state.playTime,
        finished: forecast.finished > 0 ? roughly(forecast.finished) : '',
        nextStage: forecast.nextStage !== null ? roughly(forecast.nextStage) : '',
      };
    }
    return etaCache;
  }

  /** The clouds on offer, each with a forecast. Computed once per choice, not per frame. */
  function offerViews(): CloudView[] {
    if (state.cloud) return [];
    const key = `${state.skySeed}|${state.sky.length}|${Object.values(state.stardustLevels).join(',')}`;
    if (key === offersCache.key) return offersCache.views;

    const views = offersFor(state).map((cloud, index) => {
      const stage = stageAt(ceilingStageOf(cloud));
      const discovery = discoveryFor(state, ceilingStageOf(cloud));
      return {
        index,
        name: cloud.name,
        ceiling: stage.name,
        letter: stage.spectral ?? '',
        colour: css(stage.look.core),
        trait: TRAIT_DEFS[cloud.trait].name,
        traitBlurb: TRAIT_DEFS[cloud.trait].blurb,
        eta: roughly(forecastCloud(state, cloud)),
        worth: yieldFor(capOf(cloud).mul(0.9995)) + discovery,
        discovery: discovery > 0,
        hue: cloud.hue,
      };
    });
    offersCache = { key, views };
    return views;
  }

  // ---------------------------------------------------------------- the view

  function refreshView(): void {
    const rates = deriveRates(state);
    const notation = state.settings.notation;

    const now = Date.now();
    if (now - massPaintedAt >= 1000 || view.mass === '0') {
      view.mass = format(state.mass, notation);
      massPaintedAt = now;
    }
    view.massPerSecond = format(rates.massPerSecond, notation);

    const progress = stageProgress(state.totalMassEver);
    view.stageName = progress.stage.name;
    view.stageAnalogue = progress.stage.analogue;
    view.stageFraction = progress.fraction;
    // The ladder goes on, but this cloud does not: past its ceiling there is no next stage.
    const next = state.cloud && progress.index >= ceilingStageOf(state.cloud) ? null : progress.next;
    view.nextStageName = next?.name ?? '';
    view.nextStageThreshold = next?.threshold ? format(next.threshold, notation) : '';

    // The ladder has to be visibly worth climbing, or this is the old problem wearing a
    // different hat: the multiplier is real but folded into a number nobody attributes to it.
    view.ladderBonus = rates.promotionMultiplier > 1.005 ? `x${rates.promotionMultiplier.toFixed(2)}` : '';
    view.nextPromotion = next
      ? `x${(promotionMultiplier(progress.index + 1) / rates.promotionMultiplier).toFixed(2)}`
      : '';

    // --- the run -----------------------------------------------------------------------
    const cloud = state.cloud;
    view.choosing = cloud === null;
    view.cloudName = cloud?.name ?? '';
    view.cloudCeiling = cloud ? stageAt(ceilingStageOf(cloud)).name : '';
    view.cloudTrait = cloud ? TRAIT_DEFS[cloud.trait].name : '';
    view.cloudHue = cloud?.hue ?? view.cloudHue;
    view.remaining = rates.remaining;
    view.complete = rates.complete;
    const eta = runEta();
    view.eta = eta.finished;
    view.offers = offerViews();

    // The caption: one line about what comes next, in words.
    view.accent = accentOf(stageAt(progress.index).look.core);
    if (!cloud) {
      view.captionNext = 'Choose the next cloud when you like.';
      view.hairline = 0;
    } else if (rates.complete) {
      view.captionNext = 'Its cloud is spent. Let it go when you like.';
      view.hairline = 1;
    } else if (next) {
      view.captionNext = eta.nextStage ? `${next.name} ${eta.nextStage}` : next.name;
      view.hairline = progress.fraction;
    } else {
      // At the cloud's ceiling, the hairline measures the cloud running out, in orders.
      const from = stageAt(progress.index).threshold;
      const to = capOf(cloud).mul(COMPLETE_AT);
      const span = from && from.gt(0) ? to.log10() - from.log10() : 1;
      const here = from && from.gt(0) ? state.totalMassEver.log10() - from.log10() : 0;
      view.hairline = span > 0 ? Math.max(0, Math.min(1, here / span)) : 1;
      view.captionNext = eta.finished ? `Finished ${eta.finished}` : 'Finishing';
    }

    // --- letting go ----------------------------------------------------------------------
    view.canRelease = canRelease(state);
    const value = releaseValue(state);
    const asStage = stageAt(progress.index);
    view.releaseAs = view.canRelease ? asStage.name : '';
    view.releaseFate = view.canRelease && asStage.fate ? FATE_WORDS[asStage.fate] : '';
    view.releaseStardust = value.stardust;
    view.releaseDiscovery = value.discovery;
    view.releasing = state.playTime < releasingUntil;

    // --- the sky -----------------------------------------------------------------------
    view.stardust = formatStardust(state.stardust);
    view.skyBonus = `x${rates.skyMultiplier.toFixed(2)}`;
    view.sky = state.sky
      .map((star) => {
        const stage = stageAt(safeStageIndex(star.stage));
        return {
          id: star.id,
          name: star.name,
          className: stage.name,
          letter: stage.spectral ?? '',
          colour: css(stage.look.core),
          made: new Date(star.releasedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
          took: formatDuration(star.seconds),
          completed: star.completed,
          cloud: star.cloud,
          x: star.x,
          y: star.y,
        };
      })
      .reverse();

    const tree = treeEffects(state);
    const effectOf: Record<StardustId, string> = {
      reach: `clouds up to ${stageAt(stageOfClass(tree.maxClass)).name}`,
      enrichment: tree.massMultiplier > 1 ? `x${tree.massMultiplier.toFixed(2)} to all mass` : 'none yet',
      ignition: tree.startingTier > 0 ? `start at ${elementAt(tree.startingTier).name}` : 'start at hydrogen',
      gaze: `${tree.offers} clouds to choose from`,
    };

    view.stardustUpgrades = STARDUST_LIST.map((def) => {
      const level = state.stardustLevels[def.id];
      const cost = stardustCost(def, level);
      return {
        id: def.id,
        name: def.name,
        blurb: def.blurb,
        perLevel: def.perLevel,
        effect: effectOf[def.id],
        level,
        maxLevel: def.maxLevel,
        cost: cost === null ? '' : formatStardust(cost),
        affordable: cost !== null && state.stardust >= cost,
        maxed: cost === null,
      };
    });

    view.stages = STAGES.map((stage, index) => ({
      id: stage.id,
      name: stage.name,
      analogue: stage.analogue,
      threshold: stage.threshold ? format(stage.threshold, notation) : '—',
      viaCollapse: stage.threshold === null,
      reached: stage.threshold !== null && index <= progress.index,
      current: index === progress.index,
    }));

    // Announce a promotion once. If several were crossed at once — a long absence — only the
    // highest is worth saying.
    if (progress.index > state.stageSeen) {
      state.stageSeen = progress.index;
      ambience?.bell();
      announce('You are now', progress.stage.name, progress.stage.blurb);
    }

    view.spawnRate = rates.spawnRate.toFixed(1);
    view.captureFraction = `${(rates.captureFraction * 100).toFixed(1)}%`;
    view.massPerParticle = format(rates.massPerParticle, notation);
    // Shown without the ladder's share, which gets its own line. Multiplying them together
    // is the reader's job and the breakdown says so.
    view.globalMultiplier = `x${(rates.globalMultiplier / rates.promotionMultiplier).toFixed(2)}`;

    const buildRow = (def: (typeof UPGRADE_LIST)[number]): UpgradeView => {
      const cost = nextCost(state, def.id);
      const wallet = def.currency === 'energy' ? state.energy : state.mass;
      const income = def.currency === 'energy' ? rates.energyPerSecond : rates.massPerSecond;
      const affordable = wallet.gte(cost);
      const best = maxAffordable(def, state.levels[def.id], wallet, rates.stage);
      const seconds = affordable
        ? 0
        : income.lte(0)
          ? Infinity
          : cost.sub(wallet).div(income).toNumber();

      // What one more level actually does. Cheapest-first automation cannot tell that an
      // upgrade has saturated, so the player needs to be able to.
      //
      // Measured against the thing the upgrade actually moves: a disk level usually changes
      // mass income by nothing at all, right up until it tips the core over a fusion
      // threshold, so showing it as "+0% income" would read as broken rather than as
      // progress towards the next element.
      const probe: GameState = {
        ...state,
        levels: { ...state.levels, [def.id]: state.levels[def.id] + 1 },
      };
      const after = deriveRates(probe);
      const gainFraction =
        def.term === 'energy'
          ? after.diskThroughput / rates.diskThroughput - 1
          : def.term === 'requirement'
            ? 1 - after.requirementScale / rates.requirementScale
            : after.massPerSecond.div(rates.massPerSecond).toNumber() - 1;
      const gainLabel =
        def.term === 'energy' ? 'throughput' : def.term === 'requirement' ? 'cheaper to hold' : 'income';

      const open = isOpen(state, def.id);
      const settled =
        open &&
        isFlowing(state, def.id) &&
        def.currency === 'mass' &&
        paybackSeconds(state, def.id, rates) > paybackHorizon(state, rates);
      const status: UpgradeView['state'] = !open
        ? 'closed'
        : !state.autoBuy[def.id]
          ? 'held'
          : settled
            ? 'settled'
            : 'flowing';

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
        eta: affordable ? '' : roughly(seconds),
        gain: `+${(gainFraction * 100).toFixed(gainFraction < 0.01 ? 2 : 1)}% ${gainLabel}`,
        autoBuy: state.autoBuy[def.id],
        open,
        state: status,
        canBegin: !open && affordable,
        rebased: def.rebased === true,
        currency: def.currency,
      };
    };

    const visible = UPGRADE_LIST.filter((def) => isUnlocked(state, def));
    view.upgrades = visible.filter((def) => def.term !== 'energy' && def.term !== 'requirement').map(buildRow);
    view.energyUpgrades = visible.filter((def) => def.term === 'energy' || def.term === 'requirement').map(buildRow);

    // The one thing the game asks of a first run: begin each current once. Offered in the
    // caption only when it can actually be done, so it is an invitation and never a nag.
    const begin = cloud ? UPGRADE_LIST.find((def) => isUnlocked(state, def) && !isOpen(state, def.id) && canAfford(state, def.id)) : undefined;
    view.beginnable = begin ? { id: begin.id, name: begin.name, cost: format(nextCost(state, begin.id), notation) } : null;

    // --- the energy economy ---------------------------------------------------------
    view.energyUnlocked = rates.energyPerSecond.gt(0);
    view.energy = format(state.energy, notation);
    view.energyPerSecond = format(rates.energyPerSecond, notation);
    view.throughput = `${(rates.diskThroughput * 100).toPrecision(3)}%`;

    const element = elementAt(rates.elementTier);
    view.elementName = element.name;
    view.elementSymbol = element.symbol;
    view.elementBlurb = element.blurb;
    view.elementMultiplier = `x${rates.elementMultiplier.toFixed(2)}`;
    view.nextElementName = REACHABLE_ELEMENTS[rates.elementTier + 1]?.name ?? '';

    // Measured in orders of throughput, because that is how throughput moves.
    const need = rates.nextElementRequirement;
    const have = element.requires === null ? 0 : element.requires * rates.requirementScale;
    view.elementProgress =
      need === null || need <= 0
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              (Math.log10(rates.diskThroughput) - Math.log10(Math.max(have, 1e-12))) /
                (Math.log10(need) - Math.log10(Math.max(have, 1e-12))),
            ),
          );

    view.elements = ELEMENTS.map((entry, index) => ({
      id: entry.id,
      name: entry.name,
      symbol: entry.symbol,
      multiplier: `x${entry.multiplier.toFixed(2)}`,
      requires: entry.requires === null ? '—' : `${(entry.requires * rates.requirementScale * 100).toPrecision(3)}%`,
      reached: entry.requires !== null && index <= rates.elementTier,
      current: index === rates.elementTier,
      unreachable: entry.requires === null,
    }));

    const unlocked = new Set(state.achievements);
    view.achievements = ACHIEVEMENTS.map((achievement) => ({
      id: achievement.id,
      name: achievement.name,
      how: achievement.how,
      unlocked: unlocked.has(achievement.id),
    }));
    view.achievementsUnlocked = state.achievements.length;
    view.achievementMultiplier = `x${multiplierFor(state.achievements.length).toFixed(2)}`;
    view.autoBuyReserve = state.settings.autoBuyReserve;
    view.autoBuyersUnlocked = currentsOpen(state);

    if (state.achievements.length > achievementsAnnounced) {
      const fresh = state.achievements.slice(achievementsAnnounced);
      achievementsAnnounced = state.achievements.length;
      if (fresh.length > ANNOUNCE_BATCH_LIMIT) {
        announce('Achievements', `${fresh.length} unlocked`, 'Everything you earned while you were away.');
      } else {
        for (const id of fresh) {
          const achievement = ACHIEVEMENTS.find((a) => a.id === id);
          if (achievement) announce('Achievement', achievement.name, achievement.how);
        }
      }
    }

    view.playTime = formatDuration(state.playTime);
    view.purchases = state.stats.purchases;

    view.notation = notation;
    view.particleBudget = state.settings.particleBudget;
    view.reducedMotion = state.settings.reducedMotion;
    view.sound = state.settings.sound;
    view.volume = state.settings.volume;
  }

  function refreshField(): void {
    if (!field) return;
    const rates = deriveRates(state);
    const { look } = stageAt(stageIndexFor(state.totalMassEver));

    // What kind of cloud it is changes what falls in, and only that: an icy cloud is a fine
    // pale snow, a ferrous one is dark and heavy, a turning one swings round before it drops.
    let particleColour = look.particle;
    let particleSize = look.particleSize;
    let particleCount = look.particleCount;
    let orbit = look.orbit;
    switch (state.cloud?.trait) {
      case 'icy':
        particleColour = mixRgb(look.particle, 0xe2f2ff, 0.45);
        particleSize *= 0.85;
        particleCount *= 1.3;
        break;
      case 'ferrous':
        particleColour = mixRgb(look.particle, 0xa07a5e, 0.45);
        particleSize *= 1.12;
        particleCount *= 0.8;
        break;
      case 'turning':
        orbit = [Math.min(0.95, orbit[0] * 1.25), Math.min(0.97, orbit[1] * 1.25)];
        break;
      default:
        break;
    }

    field.setRates({
      // Emission tracks the real spawn rate until it outgrows the screen, then grows
      // logarithmically so the field keeps thickening without ever flooding.
      spawnRate: rates.spawnRate <= 60 ? rates.spawnRate : 60 + Math.log10(rates.spawnRate / 60) * 80,
      captureFraction: rates.captureFraction,
      coreScale: look.scale,
      coreColour: look.core,
      particleColour,
      particleSize,
      particleCount,
      orbit,
      drag: look.drag,
      lifetime: look.lifetime,
      width: look.width,
      grain: look.grain,
      tilt: look.tilt,
      body: look.body,
      budget: state.settings.particleBudget,
      reducedMotion: state.settings.reducedMotion,
      // The field thins as the cloud is spent, and is still once it is: completion looks like
      // stillness. Square-rooted so the thinning is visible before the very end.
      density: rates.complete ? 0 : Math.sqrt(rates.remaining),
      present: state.cloud !== null,
    });
    refreshSound();
  }

  /** The drone follows what is in the middle of the screen, and all but stops between stars. */
  function refreshSound(): void {
    if (!ambience) return;
    const stage = stageIndexFor(state.totalMassEver);
    const body = stageAt(stage).look.body;
    ambience.setState({ stage, luminous: body === 'star' || body === 'ember', present: state.cloud !== null });
  }

  /** The stars you have made, as the renderer draws them. */
  function skyStars(): SkyStar[] {
    return state.sky.map((star) => {
      const index = safeStageIndex(star.stage);
      const stage = stageAt(index);
      return {
        id: star.id,
        x: star.x,
        y: star.y,
        colour: stage.look.core,
        heat: Math.max(0, STAGES.filter((st) => st.spectral).findIndex((st) => st.id === stage.id)),
      };
    });
  }

  /** Everything about the field that is not a rate: the sky and the cloud. */
  function refreshScene(): void {
    if (!field) return;
    field.setSky(skyStars());
    field.setCloud(state.cloud ? { seed: state.cloud.seed, hue: state.cloud.hue } : null);
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
        view.announceEyebrow = '';
        view.announceTitle = '';
        view.announceBody = '';
      }
    }
    if (announceTimer <= 0) showNextAnnouncement();

    if (running) frameHandle = requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- lifecycle

  async function start(fieldParent: HTMLElement): Promise<void> {
    load();
    refreshView();

    try {
      field = await createField(fieldParent, {});
      refreshScene();
      refreshField();
    } catch (error) {
      // No WebGL, or a context that refused to start. The game is entirely playable without
      // the canvas — that is the whole point of keeping it cosmetic.
      flash('Could not start the particle field. The game still works.');
      console.warn('Particle field unavailable:', error);
    }

    // Built now but silent: no context exists until sound is on and the player has touched
    // the page, which is when a browser allows one to start.
    ambience = createAmbience();
    ambience.setVolume(state.settings.volume);
    ambience.setEnabled(state.settings.sound);
    refreshSound();

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
    ambience?.destroy();
    ambience = null;
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

    toggleAutoBuy(id: UpgradeId): void {
      if (!isOpen(state, id)) return;
      state.autoBuy[id] = !state.autoBuy[id];
      refreshView();
    },

    buyStardust(id: StardustId): void {
      if (!buyStardust(state, id)) return;
      save();
      refreshView();
      refreshField();
    },

    /**
     * Let the star go.
     *
     * The field keeps showing what it left for a few seconds before it empties, which is the
     * only place the remnant is drawn for now. The run has already ended underneath.
     */
    release(): void {
      const done = release(state, Date.now());
      if (!done) return;
      releasingUntil = state.playTime + RELEASE_SECONDS;
      // The record is in the sky before the light that carries it there sets off, so the
      // field knows where it is going; the field keeps it dark until it arrives.
      refreshScene();
      ambience?.bell();
      field?.release({
        fate: done.fate,
        colour: stageAt(safeStageIndex(done.star.stage)).look.core,
        starId: done.star.id,
      });
      const paid = done.stardust + done.discovery;
      // Ahead of anything already waiting: this is the line the moment is about.
      announcements.unshift({
        eyebrow: 'Into your sky',
        title: done.star.name,
        body: `${stageAt(safeStageIndex(done.star.stage)).name}. It leaves ${FATE_WORDS[done.fate]}. ${formatStardust(paid)} stardust${done.discovery ? ', for a discovery among it' : ''}.`,
      });
      showNextAnnouncement();
      save();
      refreshView();
      refreshField();
    },

    /** Begin the next star from one of the clouds on offer. */
    chooseCloud(index: number): void {
      if (!chooseCloud(state, index)) return;
      refreshScene();
      save();
      refreshView();
      refreshField();
    },

    renameStar(id: number, name: string): void {
      if (!renameStar(state, id, name)) return;
      save();
      refreshView();
    },

    setAutoBuyReserve(fraction: number): void {
      state.settings.autoBuyReserve = Math.max(0, Math.min(0.9, fraction));
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

    setSound(on: boolean): void {
      state.settings.sound = on;
      // This is a click, so it is the gesture a browser wants before it will play anything.
      ambience?.setEnabled(on);
      ambience?.unlock();
      refreshSound();
      refreshView();
    },

    setVolume(volume: number): void {
      state.settings.volume = Math.max(0, Math.min(1, volume));
      ambience?.setVolume(state.settings.volume);
      refreshView();
    },

    /** Called on any gesture: starts the audio context if sound is on and it is not running. */
    unlockAudio(): void {
      ambience?.unlock();
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
        ambience?.setVolume(state.settings.volume);
        ambience?.setEnabled(state.settings.sound);
        save();
        refreshView();
        refreshScene();
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
      refreshScene();
      refreshField();
      flash('Everything reset.');
    },
  };

  return { view, start, stop, ...actions };
}

export const game = createGame();

export type Game = ReturnType<typeof createGame>;
