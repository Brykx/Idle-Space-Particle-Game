<script lang="ts">
  import type { Notation } from '../sim/numbers';
  import type { View } from '../game.svelte';

  interface Props {
    view: View;
    onnotation: (n: Notation) => void;
    onbudget: (n: number) => void;
    onreserve: (n: number) => void;
    onreducedmotion: (on: boolean) => void;
    onexport: () => string;
    onimport: (text: string) => boolean;
    onreset: () => void;
  }

  const { view, onnotation, onbudget, onreserve, onreducedmotion, onexport, onimport, onreset }: Props =
    $props();

  let saveText = $state('');
  let copied = $state(false);
  let confirmingReset = $state(false);

  async function copyExport(): Promise<void> {
    const text = onexport();
    saveText = text;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard is blocked in plenty of contexts; the textarea is the fallback.
      copied = false;
    }
  }
</script>

<section class="settings">
  <h2>Settings</h2>

  <div class="row">
    <label for="notation">Numbers</label>
    <select
      id="notation"
      value={view.notation}
      onchange={(event) => onnotation(event.currentTarget.value as Notation)}
    >
      <option value="letters">1.23 M</option>
      <option value="scientific">1.230e6</option>
      <option value="engineering">1.23e6</option>
    </select>
  </div>

  <div class="row">
    <label for="budget">Particles</label>
    <div class="slider">
      <input
        id="budget"
        type="range"
        min="0"
        max="6000"
        step="200"
        value={view.particleBudget}
        oninput={(event) => onbudget(Number(event.currentTarget.value))}
      />
      <span class="num">{view.particleBudget}</span>
    </div>
  </div>

  <p class="note">A graphics setting only — it cannot change how much mass you earn.</p>

  {#if view.autoBuyersUnlocked > 0}
    <div class="row">
      <label for="reserve">Auto-buy reserve</label>
      <div class="slider">
        <input
          id="reserve"
          type="range"
          min="0"
          max="0.9"
          step="0.05"
          value={view.autoBuyReserve}
          oninput={(event) => onreserve(Number(event.currentTarget.value))}
        />
        <span class="num">{(view.autoBuyReserve * 100).toFixed(0)}%</span>
      </div>
    </div>

    <p class="note">Mass the auto-buyers will not touch, so you can save towards something by hand.</p>
  {/if}

  <div class="row">
    <label for="motion">Reduced motion</label>
    <input
      id="motion"
      type="checkbox"
      checked={view.reducedMotion}
      onchange={(event) => onreducedmotion(event.currentTarget.checked)}
    />
  </div>

  <hr />

  <div class="save">
    <div class="buttons">
      <button onclick={copyExport}>{copied ? 'Copied' : 'Export save'}</button>
      <button disabled={saveText.trim() === ''} onclick={() => onimport(saveText)}>Import</button>
    </div>
    <textarea
      bind:value={saveText}
      rows="3"
      spellcheck="false"
      placeholder="Paste a save string here to restore it"
      aria-label="Save string"
    ></textarea>
  </div>

  <hr />

  {#if confirmingReset}
    <div class="buttons">
      <button
        class="danger"
        onclick={() => {
          onreset();
          confirmingReset = false;
        }}>Erase everything</button
      >
      <button onclick={() => (confirmingReset = false)}>Cancel</button>
    </div>
  {:else}
    <button class="wide" onclick={() => (confirmingReset = true)}>Hard reset</button>
  {/if}

  <dl class="stats">
    <div><dt>Time played</dt><dd class="num">{view.playTime}</dd></div>
    <div><dt>Upgrades bought</dt><dd class="num">{view.purchases}</dd></div>
    <div><dt>Pulses fired</dt><dd class="num">{view.pulses}</dd></div>
    <div><dt>Achievements</dt><dd class="num">{view.achievementsUnlocked}/{view.achievementCount}</dd></div>
  </dl>
</section>

<style>
  .settings {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(9, 13, 26, 0.5);
    padding: 0.5rem 0.7rem 0.7rem;
  }

  h2 {
    margin: 0;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--dimmer);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    margin-top: 0.7rem;
    font-size: 0.78rem;
  }

  label {
    color: var(--dim);
  }

  .slider {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .slider span {
    min-width: 2.9rem;
    text-align: right;
    font-size: 0.75rem;
    color: var(--dimmer);
  }

  input[type='range'] {
    width: 8rem;
    accent-color: var(--accent);
  }

  input[type='checkbox'] {
    accent-color: var(--accent);
    width: 1rem;
    height: 1rem;
  }

  select {
    background: rgba(30, 44, 78, 0.6);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.25rem 0.4rem;
    font-size: 0.78rem;
  }

  .note {
    margin: 0.35rem 0 0;
    font-size: 0.7rem;
    color: var(--dimmer);
    line-height: 1.4;
  }

  hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 0.9rem 0;
  }

  .buttons {
    display: flex;
    gap: 0.4rem;
  }

  button {
    flex: 1;
    padding: 0.4rem 0.5rem;
    font-size: 0.78rem;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: rgba(30, 44, 78, 0.5);
  }

  button:hover:not(:disabled) {
    background: rgba(48, 70, 122, 0.7);
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  button.wide {
    width: 100%;
  }

  button.danger {
    border-color: rgba(255, 138, 138, 0.4);
    color: var(--bad);
  }

  textarea {
    margin-top: 0.4rem;
    width: 100%;
    resize: vertical;
    background: rgba(4, 6, 14, 0.8);
    color: var(--dim);
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 0.4rem 0.5rem;
    font-family: var(--mono);
    font-size: 0.68rem;
  }

  .stats {
    margin: 0.9rem 0 0;
    display: grid;
    gap: 0.25rem;
    font-size: 0.75rem;
  }

  .stats div {
    display: flex;
    justify-content: space-between;
  }

  dt {
    color: var(--dimmer);
  }

  dd {
    margin: 0;
    color: var(--dim);
  }
</style>
