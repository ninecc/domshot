import { prepareRelease } from './changelog-lib.mjs';

const version = process.argv[2];
if (!version) {
  console.error('Usage: npm run release:prepare -- <version>');
  process.exit(1);
}

try {
  const result = await prepareRelease(process.cwd(), version);
  console.log(`Prepared DOMShot ${result.version} from ${result.fragments} changelog fragment${result.fragments === 1 ? '' : 's'}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
