import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js alone is ~550 kB minified, which is expected for a 3D game.
    chunkSizeWarningLimit: 800,
  },
});
