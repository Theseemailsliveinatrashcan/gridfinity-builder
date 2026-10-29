import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on GitHub Pages under /<repo>/.
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});
