import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadChangeFragments, prepareRelease, validateChangePolicy } from '../scripts/changelog-lib.mjs';

test('changelog fragments are schema checked and deduplicated', async (context) => {
  const root = await temporaryRepository(context);
  await mkdir(join(root, '.changes'));
  await writeJson(join(root, '.changes/fix-copy.json'), {
    $schema: './schema.json',
    type: 'fixed',
    scope: 'preview',
    summary: 'Show copy confirmation without resizing the preview',
  });

  const fragments = await loadChangeFragments(root);
  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].type, 'fixed');

  await writeJson(join(root, '.changes/duplicate.json'), {
    type: 'unknown',
    scope: 'Preview UI',
    summary: 'Show copy confirmation without resizing the preview',
  });
  await assert.rejects(loadChangeFragments(root), /type must be one of.*scope must be/s);

  await writeJson(join(root, '.changes/duplicate.json'), {
    type: 'fixed',
    scope: 'preview',
    summary: 'Show copy confirmation without resizing the preview',
  });
  await assert.rejects(loadChangeFragments(root), /summary duplicates/);
});

test('pull request policy requires an explicit fragment or skip decision', () => {
  assert.throws(() => validateChangePolicy(['src/content.ts']), /needs a \.changes/);
  assert.doesNotThrow(() => validateChangePolicy(['src/content.ts'], { skip: true }));
  assert.doesNotThrow(() => validateChangePolicy(['src/content.ts', '.changes/fix-preview.json']));
  assert.throws(() => validateChangePolicy(['CHANGELOG.md', '.changes/fix-preview.json']), /only be changed by a release/);
  assert.doesNotThrow(() => validateChangePolicy(['CHANGELOG.md'], { release: true }));
});

test('release preparation synchronizes versions and consumes validated fragments', async (context) => {
  const root = await temporaryRepository(context);
  await mkdir(join(root, '.changes'));
  await mkdir(join(root, 'public'));
  await writeJson(join(root, 'package.json'), { name: 'domshot', version: '0.1.0' });
  await writeJson(join(root, 'package-lock.json'), {
    name: 'domshot',
    version: '0.1.0',
    lockfileVersion: 3,
    packages: { '': { name: 'domshot', version: '0.1.0' } },
  });
  await writeJson(join(root, 'public/manifest.json'), { manifest_version: 3, version: '0.1.0' });
  await writeFile(join(root, 'CHANGELOG.md'), '# Changelog\n\nAll notable changes to DOMShot are documented in this file.\n');
  await writeJson(join(root, '.changes/add-permission.json'), {
    type: 'added',
    scope: 'permissions',
    summary: 'Allow users to authorize image sources and retry a capture',
    references: ['#42'],
  });
  await writeJson(join(root, '.changes/fix-preview.json'), {
    type: 'fixed',
    scope: 'preview',
    summary: 'Keep the preview fixed while the page scrolls',
  });

  const result = await prepareRelease(root, '0.2.0', new Date('2026-08-26T00:00:00Z'));

  assert.deepEqual(result, { version: '0.2.0', fragments: 2 });
  assert.equal((await readJson(join(root, 'package.json'))).version, '0.2.0');
  assert.equal((await readJson(join(root, 'package-lock.json'))).packages[''].version, '0.2.0');
  assert.equal((await readJson(join(root, 'public/manifest.json'))).version, '0.2.0');
  assert.deepEqual(await readdir(join(root, '.changes')), []);
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /## \[0\.2\.0\] - 2026-08-26/);
  assert.match(changelog, /### Added[\s\S]*\*\*permissions:\*\*.*\(#42\)/);
  assert.match(changelog, /### Fixed[\s\S]*\*\*preview:\*\*/);
});

async function temporaryRepository(context) {
  const root = await mkdtemp(join(tmpdir(), 'domshot-changelog-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function writeJson(path, value) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
