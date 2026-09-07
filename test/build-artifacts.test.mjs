import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '../dist');

test('production package excludes development maps and stays within its size budget', async () => {
  const files = await readdir(dist, { recursive: true });
  assert.equal(files.some(file => file.endsWith('.map')), false, 'Production builds must not include source maps');

  const sizes = await Promise.all(files.map(async file => {
    const info = await stat(resolve(dist, file));
    return info.isFile() ? info.size : 0;
  }));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  assert.ok(total < 512 * 1024, `Production package is ${Math.ceil(total / 1024)} KiB; review files exceeding the 512 KiB budget`);
});
