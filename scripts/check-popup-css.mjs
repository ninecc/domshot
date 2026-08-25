import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const css = await readFile(resolve(import.meta.dirname, '../src/popup.css'), 'utf8');
const compact = css.replace(/\s+/g, ' ');

const failures = [];

if (!/html, body \{[^}]*width: 360px;[^}]*min-width: 360px;[^}]*max-width: 360px;/.test(compact)) {
  failures.push('popup root must stay fixed at 360px when advanced settings expand');
}
if (!/\.settings-button:hover, \.settings-button\[aria-expanded="true"\] \{[^}]*color: var\(--brand-blue\);[^}]*background: transparent;/.test(compact)) {
  failures.push('settings button states must change only the icon color');
}

if (failures.length) throw new Error(failures.join('\n'));

console.log('Popup layout constraints are valid.');
