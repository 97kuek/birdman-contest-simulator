import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: 'assets',
  build: { rollupOptions: { input: ['index.html', 'opening.html', 'cruise.html'] } },
});
