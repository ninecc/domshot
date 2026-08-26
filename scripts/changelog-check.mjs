import { parseArgs } from 'node:util';
import { changedFilesSince, loadChangeFragments, validateChangePolicy } from './changelog-lib.mjs';

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    skip: { type: 'boolean', default: process.env.CHANGELOG_SKIP === 'true' },
    release: { type: 'boolean', default: process.env.CHANGELOG_RELEASE === 'true' },
  },
});

try {
  const fragments = await loadChangeFragments(process.cwd());
  if (values.base) {
    const changedFiles = changedFilesSince(process.cwd(), values.base);
    validateChangePolicy(changedFiles, values);
  }
  console.log(`Validated ${fragments.length} changelog fragment${fragments.length === 1 ? '' : 's'}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
