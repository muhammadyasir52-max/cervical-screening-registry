// Build a static copy of the public dashboard (for GitHub Pages) from a fresh
// synthetic population. Output goes to ./site.
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { Registry } from '../src/registry.js';
import { seedStore } from '../src/synthetic.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}site/`;
mkdirSync(out, { recursive: true });

const store = new Store();
seedStore(store);
const registry = new Registry(store);
registry.refreshAll();
writeFileSync(`${out}stats.json`, JSON.stringify(registry.publicStats(), null, 2));

const html = readFileSync(`${root}public/index.html`, 'utf8')
  .replace('data-stats-url="api/public/stats"', 'data-stats-url="stats.json"')
  .replace(/<a class="staff-link"[^>]*>.*?<\/a>/, '');
writeFileSync(`${out}index.html`, html);
for (const f of ['app.css', 'dashboard.js']) copyFileSync(`${root}public/${f}`, `${out}${f}`);
console.log(`Static dashboard written to ${out}`);
