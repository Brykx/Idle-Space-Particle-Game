<script lang="ts">
  import type { View } from '../game.svelte';

  const { view }: { view: View } = $props();
</script>

<!--
  The whole ladder, including the two stages accretion cannot reach. Showing those greyed is
  the point: a supernova is the only way past a star, and the list should say so long before
  the player gets there.
-->
<section class="stages">
  <h2>The ladder</h2>

  <ol>
    {#each view.stages as stage (stage.id)}
      <li class:reached={stage.reached} class:current={stage.current} class:collapse={stage.viaCollapse}>
        <span class="marker" aria-hidden="true"></span>
        <span class="name">{stage.name}</span>
        <span class="analogue">{stage.analogue}</span>
        <span class="threshold num">{stage.threshold}</span>
      </li>
    {/each}
  </ol>

  <p class="note">
    Everything up to Supergiant is accretion — you get there by getting heavier. The last two
    are not: a star does not grow into a neutron star, it runs out of fuel and throws most of
    itself away. That collapse arrives with the supernova.
  </p>
</section>

<style>
  .stages {
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

  ol {
    margin: 0.7rem 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.05rem;
  }

  li {
    display: grid;
    grid-template-columns: 0.9rem 1fr auto;
    grid-template-areas:
      'marker name threshold'
      'marker analogue analogue';
    align-items: center;
    gap: 0 0.5rem;
    padding: 0.28rem 0;
    font-size: 0.76rem;
    opacity: 0.4;
  }

  li.reached {
    opacity: 1;
  }

  .marker {
    grid-area: marker;
    justify-self: center;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    border: 1px solid var(--dimmer);
  }

  li.reached .marker {
    background: var(--accent);
    border-color: var(--accent);
  }

  li.current .marker {
    background: var(--warm);
    border-color: var(--warm);
    box-shadow: 0 0 0 3px rgba(255, 217, 160, 0.18);
  }

  li.collapse .marker {
    border-style: dashed;
    border-radius: 2px;
  }

  .name {
    grid-area: name;
    color: var(--dim);
  }

  li.current .name {
    color: var(--warm);
    font-weight: 600;
  }

  .analogue {
    grid-area: analogue;
    font-size: 0.68rem;
    color: var(--dimmer);
  }

  .threshold {
    grid-area: threshold;
    font-size: 0.7rem;
    color: var(--dimmer);
  }

  .note {
    margin: 0.8rem 0 0;
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
    font-size: 0.68rem;
    line-height: 1.5;
    color: var(--dimmer);
  }
</style>
