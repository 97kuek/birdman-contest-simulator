import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

function sceneAssetVersions() {
  const versions = {};
  for (const directory of ['models', 'terrain', 'fujikawa']) {
    const folder = new URL('./assets/' + directory + '/', import.meta.url);
    for (const name of readdirSync(folder)) {
      if (!/\.(?:glb|gz|png|webp|jpg|json)$/.test(name)) continue;
      const content = readFileSync(new URL(name, folder));
      versions[directory + '/' + name] = createHash('sha256').update(content).digest('hex').slice(0, 16);
    }
  }
  return versions;
}

export default defineConfig(({ command }) => ({
  define: { __SCENE_ASSET_VERSIONS__: JSON.stringify(command === 'build' ? sceneAssetVersions() : {}) },
  base: './',
  publicDir: 'assets',
  build: { rollupOptions: { input: ['index.html', 'opening.html', 'cruise.html'] } },
}));
