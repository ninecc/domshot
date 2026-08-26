import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const CHANGE_TYPES = Object.freeze({
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
  removed: 'Removed',
  security: 'Security',
});

const CHANGELOG_PREAMBLE = '# Changelog\n\nAll notable changes to DOMShot are documented in this file.';
const FRAGMENT_PATTERN = /^[a-z0-9][a-z0-9-]*\.json$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ALLOWED_KEYS = new Set(['$schema', 'type', 'scope', 'summary', 'breaking', 'references']);

export async function loadChangeFragments(root) {
  const directory = join(root, '.changes');
  const files = (await readdir(directory)).filter(isFragmentFile).sort();
  const fragments = [];
  const errors = [];
  const summaries = new Map();

  for (const file of files) {
    let value;
    try {
      value = JSON.parse(await readFile(join(directory, file), 'utf8'));
    } catch (error) {
      errors.push(`${file}: invalid JSON (${error.message})`);
      continue;
    }

    const fragmentErrors = validateFragment(value);
    errors.push(...fragmentErrors.map((message) => `${file}: ${message}`));
    if (fragmentErrors.length) continue;

    const duplicate = summaries.get(value.summary);
    if (duplicate) errors.push(`${file}: summary duplicates ${duplicate}`);
    else summaries.set(value.summary, file);
    fragments.push({ file, ...value });
  }

  if (errors.length) throw new Error(`Changelog validation failed:\n- ${errors.join('\n- ')}`);
  return fragments;
}

export function validateChangePolicy(changedFiles, { skip = false, release = false } = {}) {
  const changedFragment = changedFiles.some((file) => file.startsWith('.changes/') && isFragmentFile(file.slice('.changes/'.length)));
  const changedChangelog = changedFiles.includes('CHANGELOG.md');

  if (changedChangelog && !release) {
    throw new Error('CHANGELOG.md may only be changed by a release/v* pull request. Add a .changes fragment instead.');
  }
  if (!changedFragment && !skip && !release) {
    throw new Error('This pull request needs a .changes/*.json fragment or the changelog: skip label.');
  }
}

export function changedFilesSince(root, base) {
  const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `Unable to compare against ${base}`);
  return result.stdout.split('\n').map((file) => file.trim()).filter(Boolean);
}

export async function prepareRelease(root, version, date = new Date()) {
  assertVersion(version);
  const fragments = await loadChangeFragments(root);
  if (!fragments.length) throw new Error('No changelog fragments are available for release.');

  const packagePath = join(root, 'package.json');
  const lockPath = join(root, 'package-lock.json');
  const manifestPath = join(root, 'public/manifest.json');
  const changelogPath = join(root, 'CHANGELOG.md');
  const [packageJson, packageLock, manifest, existingChangelog] = await Promise.all([
    readJson(packagePath),
    readJson(lockPath),
    readJson(manifestPath),
    readFile(changelogPath, 'utf8').catch((error) => error.code === 'ENOENT' ? CHANGELOG_PREAMBLE : Promise.reject(error)),
  ]);

  const currentVersion = packageJson.version;
  if (manifest.version !== currentVersion || packageLock.version !== currentVersion || packageLock.packages?.['']?.version !== currentVersion) {
    throw new Error('package.json, package-lock.json, and public/manifest.json versions must match before release.');
  }
  assertNewerVersion(currentVersion, version);
  if (existingChangelog.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md already contains ${version}.`);

  packageJson.version = version;
  packageLock.version = version;
  packageLock.packages[''].version = version;
  manifest.version = version;

  const releaseSection = renderRelease(version, date, fragments);
  const changelogTail = existingChangelog.startsWith(CHANGELOG_PREAMBLE)
    ? existingChangelog.slice(CHANGELOG_PREAMBLE.length).trim()
    : existingChangelog.trim();
  const nextChangelog = `${CHANGELOG_PREAMBLE}\n\n${releaseSection}${changelogTail ? `\n\n${changelogTail}` : ''}\n`;

  await Promise.all([
    writeJson(packagePath, packageJson),
    writeJson(lockPath, packageLock),
    writeJson(manifestPath, manifest),
    writeFile(changelogPath, nextChangelog),
  ]);
  await Promise.all(fragments.map(({ file }) => rm(join(root, '.changes', file))));
  return { version, fragments: fragments.length };
}

function validateFragment(value) {
  const errors = [];
  if (!value || Array.isArray(value) || typeof value !== 'object') return ['must be a JSON object'];
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) errors.push(`unknown field "${key}"`);
  }
  if (value.$schema !== undefined && value.$schema !== './schema.json') errors.push('$schema must be "./schema.json"');
  if (!Object.hasOwn(CHANGE_TYPES, value.type)) errors.push(`type must be one of: ${Object.keys(CHANGE_TYPES).join(', ')}`);
  if (typeof value.scope !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(value.scope)) errors.push('scope must be 2-32 lowercase letters, digits, or hyphens');
  if (typeof value.summary !== 'string' || value.summary.trim() !== value.summary || value.summary.length < 8 || value.summary.length > 180 || /[\r\n]/.test(value.summary)) {
    errors.push('summary must be a trimmed, single-line string of 8-180 characters');
  }
  if (value.breaking !== undefined && typeof value.breaking !== 'boolean') errors.push('breaking must be a boolean');
  if (value.references !== undefined && (!Array.isArray(value.references) || value.references.some((reference) => typeof reference !== 'string' || !/^(#\d+|https:\/\/\S+)$/.test(reference)))) {
    errors.push('references must contain only #123 or https://... values');
  }
  if (Array.isArray(value.references) && new Set(value.references).size !== value.references.length) errors.push('references must not contain duplicates');
  return errors;
}

function isFragmentFile(file) {
  return file !== 'schema.json' && FRAGMENT_PATTERN.test(file);
}

function renderRelease(version, date, fragments) {
  const lines = [`## [${version}] - ${date.toISOString().slice(0, 10)}`];
  for (const [type, heading] of Object.entries(CHANGE_TYPES)) {
    const entries = fragments.filter((fragment) => fragment.type === type);
    if (!entries.length) continue;
    lines.push('', `### ${heading}`, '');
    for (const fragment of entries) {
      const breaking = fragment.breaking ? ' **Breaking change.**' : '';
      const references = fragment.references?.length ? ` (${fragment.references.join(', ')})` : '';
      lines.push(`- **${fragment.scope}:** ${fragment.summary}${breaking}${references}`);
    }
  }
  return lines.join('\n');
}

function assertVersion(version) {
  if (!VERSION_PATTERN.test(version)) throw new Error('Release version must use x.y.z numeric format.');
}

function assertNewerVersion(current, next) {
  assertVersion(current);
  const currentParts = current.split('.').map(Number);
  const nextParts = next.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (nextParts[index] > currentParts[index]) return;
    if (nextParts[index] < currentParts[index]) break;
  }
  throw new Error(`Release version ${next} must be newer than ${current}.`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function writeJson(path, value) {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
