import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Registry } from './registry.js';
import { createApp } from './app.js';
import { seedStore } from './synthetic.js';

const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.DATA_FILE || fileURLToPath(new URL('../data/store.json', import.meta.url));
const apiKey = process.env.REGISTRY_API_KEY || null;

const store = new Store(dataFile);
const registry = new Registry(store);

if (store.all('Patient').length === 0) {
  console.log('Empty store: generating synthetic demo population…');
  seedStore(store);
}
const run = registry.refreshAll();
store.save();
console.log(`Rules evaluated for ${run.patients} patients (${run.opened} alerts opened, ${run.closed} closed).`);

// Re-run the rules once a day so people become overdue without a restart.
setInterval(() => { registry.refreshAll(); store.save(); }, 24 * 60 * 60 * 1000).unref();

createServer(createApp(registry, { apiKey })).listen(port, () => {
  console.log(`Public dashboard: http://localhost:${port}/`);
  console.log(`Staff screens:    http://localhost:${port}/staff`);
  console.log(`FHIR API:         http://localhost:${port}/fhir/metadata`);
  if (!apiKey) console.warn('REGISTRY_API_KEY is not set: staff and FHIR endpoints are open. Fine for the demo, never for real data.');
});
