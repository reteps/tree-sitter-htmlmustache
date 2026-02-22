import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { RULES } from '../lsp/server/src/ruleMetadata';

const START_MARKER = '<!-- RULES_TABLE_START -->';
const END_MARKER = '<!-- RULES_TABLE_END -->';

// Build markdown table
const header = '| Rule | Default | Description |';
const separator = '| --- | --- | --- |';
const rows = RULES.map(
  r => `| \`${r.name}\` | \`${r.defaultSeverity}\` | ${r.description} |`,
);
const table = [header, separator, ...rows].join('\n');

// Read README and replace between markers
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readmePath = path.resolve(__dirname, '..', 'README.md');
const readme = fs.readFileSync(readmePath, 'utf-8');

const startIdx = readme.indexOf(START_MARKER);
const endIdx = readme.indexOf(END_MARKER);

if (startIdx === -1 || endIdx === -1) {
  console.error(`Could not find ${START_MARKER} / ${END_MARKER} markers in README.md`);
  process.exit(1);
}

const before = readme.slice(0, startIdx + START_MARKER.length);
const after = readme.slice(endIdx);

const updated = before + '\n\n' + table + '\n\n' + after;
fs.writeFileSync(readmePath, updated);

console.log(`Updated ${RULES.length} rules in README.md`);
