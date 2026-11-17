<script lang="ts">
  import type { View } from '../game.svelte';
  import Stages from './Stages.svelte';
  import Achievements from './Achievements.svelte';

  const { view }: { view: View } = $props();
</script>

<!-- The record: where the ladder goes, what you have done, and how long you have been here. -->
<section class="journal" data-testid="journal">
  <Stages {view} />
  <Achievements {view} />

  <dl class="stats">
    <div><dt>Time played</dt><dd class="num">{view.playTime}</dd></div>
    <div><dt>Stars in your sky</dt><dd class="num">{view.sky.length}</dd></div>
    <div><dt>Levels bought</dt><dd class="num">{view.purchases}</dd></div>
    <div><dt>Achievements</dt><dd class="num">{view.achievementsUnlocked}/{view.achievementCount}</dd></div>
  </dl>
</section>

<style>
  .journal {
    display: grid;
    gap: 0.8rem;
  }

  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 1rem;
    margin: 0;
  }

  .stats div {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.74rem;
  }

  dt {
    color: var(--dimmer);
  }

  dd {
    margin: 0;
    color: var(--dim);
  }
</style>
