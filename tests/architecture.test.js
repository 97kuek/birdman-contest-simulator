import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const allowed = {
  domain: ['domain'],
  application: ['application', 'domain'],
  presentation: ['presentation', 'application', 'domain'],
  rendering: ['rendering', 'domain', 'three'],
};

test('業務ロジックと表示の依存方向を守る', async () => {
  for (const [layer, dependencies] of Object.entries(allowed)) {
    const directory = path.join(root, layer);
    for (const name of await readdir(directory, { recursive: true })) {
      if (!name.endsWith('.js')) continue;
      const file = path.join(directory, name);
      const code = await readFile(file, 'utf8');
      const imports = code.matchAll(/\b(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g);
      for (const [, specifier] of imports) {
        const target = specifier.startsWith('.')
          ? path.relative(root, path.resolve(path.dirname(file), specifier)).split(path.sep)[0]
          : specifier.split('/')[0];
        assert.ok(dependencies.includes(target), layer + '/' + name + ' → ' + specifier);
      }
      if (layer === 'domain' || layer === 'application') {
        assert.doesNotMatch(code, /\b(?:document|window|performance)\.[a-zA-Z_$]/, layer + '/' + name);
      }
    }
  }
});
