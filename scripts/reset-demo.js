// Wipe the local store and regenerate the synthetic demo population.
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { Registry } from '../src/registry.js';
import { seedStore } from '../src/synthetic.js';

const file = process.env.DATA_FILE || fileURLToPath(new URL('../data/store.json', import.meta.url));
const store = new Store(file);
store.clear();
seedStore(store, { count: Number(process.env.COUNT) || 600 });
const run = new Registry(store).refreshAll();
store.save();
console.log(`Generated ${run.patients} synthetic patients and ${run.opened} alerts in ${file}`);
