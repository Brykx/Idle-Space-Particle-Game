<script lang="ts">
  import type { View } from '../game.svelte';

  const { view }: { view: View } = $props();
</script>

<!--
  The whole economy, in one line. A player who reads this understands the game; every later
  system will enter by multiplying one of these four terms.
-->
<section class="breakdown">
  <h2>How mass is made</h2>

  <ol>
    <li>
      <span class="label">particles arriving</span>
      <span class="value num">{view.spawnRate}/s</span>
    </li>
    <li>
      <span class="label">of which captured</span>
      <span class="value num">{view.captureFraction}</span>
    </li>
    <li>
      <span class="label">mass per particle</span>
      <span class="value num">{view.massPerParticle}</span>
    </li>
    <li>
      <span class="label">efficiency</span>
      <span class="value num">{view.globalMultiplier}</span>
    </li>
  </ol>

  <p class="total">
    <span class="label">= mass per second</span>
    <span class="value num strong">{view.massPerSecond}</span>
  </p>
</section>

<style>
  .breakdown {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(9, 13, 26, 0.5);
    padding: 0.5rem 0.7rem;
  }

  h2 {
    margin: 0;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--dimmer);
  }

  ol {
    margin: 0.6rem 0 0.4rem;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.28rem;
  }

  li,
  .total {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.78rem;
  }

  .total {
    margin: 0;
    padding-top: 0.45rem;
    border-top: 1px solid var(--line);
  }

  .label {
    color: var(--dimmer);
  }

  .value {
    color: var(--text);
  }

  .strong {
    color: var(--warm);
  }
</style>
