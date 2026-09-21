<script lang="ts">
  import type { View } from '../game.svelte';

  const { view }: { view: View } = $props();
</script>

<details class="achievements">
  <summary>
    Achievements
    <span class="count num">{view.achievementsUnlocked}/{view.achievementCount}</span>
  </summary>

  <p class="bonus">
    Each one multiplies everything by 1.02. Yours are worth
    <strong class="num">{view.achievementMultiplier}</strong> together.
  </p>

  <ul>
    {#each view.achievements as achievement (achievement.id)}
      <li class:unlocked={achievement.unlocked}>
        <span class="marker" aria-hidden="true"></span>
        <span class="name">{achievement.unlocked ? achievement.name : achievement.how}</span>
      </li>
    {/each}
  </ul>
</details>

<style>
  .achievements {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(9, 13, 26, 0.5);
    padding: 0.5rem 0.7rem 0.7rem;
  }

  summary {
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--dim);
    list-style: none;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary::before {
    content: '▸ ';
    color: var(--dimmer);
  }

  details[open] summary::before {
    content: '▾ ';
  }

  .count {
    /* Pushed right on its own, so the marker and label stay together on the left. */
    margin-left: auto;
    color: var(--dimmer);
    font-size: 0.75rem;
  }

  .bonus {
    margin: 0.7rem 0 0.6rem;
    font-size: 0.7rem;
    line-height: 1.5;
    color: var(--dimmer);
  }

  .bonus strong {
    color: var(--warm);
    font-weight: 600;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.22rem;
  }

  li {
    display: grid;
    grid-template-columns: 0.9rem 1fr;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--dimmer);
  }

  li.unlocked {
    color: var(--dim);
  }

  .marker {
    justify-self: center;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    border: 1px solid var(--dimmer);
  }

  li.unlocked .marker {
    background: var(--good);
    border-color: var(--good);
  }
</style>
