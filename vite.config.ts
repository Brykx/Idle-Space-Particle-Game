import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // Served from https://<user>.github.io/Idle-Space-Particle-Game/
  base: process.env.GITHUB_PAGES ? '/Idle-Space-Particle-Game/' : '/',
  plugins: [svelte()],
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
