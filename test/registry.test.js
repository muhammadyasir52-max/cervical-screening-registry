import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Registry, suppress } from '../src/registry.js';
import { seedStore } from '../src/synthetic.js';
import { buildPatient, buildHpvObservation, buildColposcopy, buildCytologyObservation, flagCode } from '../src/fhir.js';

const fixedDay = () => new Date('2026-06-15');

test('flags open when rules fire and close when they stop', () => {
  const store = new Store();
  const registry = new Registry(store, { today: fixedDay });
  const p = store.create(buildPatient({ given: 'A', family: 'B', birthDate: '1990-01-01', district: 'X', registryId: 'T1' }));

  registry.refreshPatient(p.id);
  assert.deepEqual(store.forPatient('Flag', p.id).filter((f) => f.status === 'active').map(flagCode), ['never-screened']);

  store.create(buildHpvObservation({ patientId: p.id, date: '2026-06-01', result: 'positive' }));
  store.create(buildCytologyObservation({ patientId: p.id, date: '2026-06-01', result: 'HSIL' }));
  registry.refreshPatient(p.id);
  const active = store.forPatient('Flag', p.id).filter((f) => f.status === 'active');
  assert.deepEqual(active.map(flagCode), ['abnormal-result']);
  const closed = store.forPatient('Flag', p.id).find((f) => flagCode(f) === 'never-screened');
  assert.equal(closed.status, 'inactive');
  assert.equal(closed.period.end, '2026-06-15');

  store.create(buildColposcopy({ patientId: p.id, date: '2026-06-10' }));
  registry.refreshPatient(p.id);
  assert.equal(store.forPatient('Flag', p.id).filter((f) => f.status === 'active').length, 0);
});

test('refreshing twice does not duplicate flags', () => {
  const store = new Store();
  const registry = new Registry(store, { today: fixedDay });
  const p = store.create(buildPatient({ given: 'A', family: 'B', birthDate: '1990-01-01', district: 'X', registryId: 'T1' }));
  registry.refreshPatient(p.id);
  const second = registry.refreshPatient(p.id);
  assert.deepEqual(second.changes, { opened: 0, closed: 0 });
  assert.equal(store.all('Flag').length, 1);
});

test('small counts are suppressed', () => {
  assert.equal(suppress(0), 0);
  assert.equal(suppress(1), null);
  assert.equal(suppress(4), null);
  assert.equal(suppress(5), 5);
});

test('public stats contain no identifiers', () => {
  const store = new Store();
  seedStore(store, { count: 300, today: fixedDay() });
  const registry = new Registry(store, { today: fixedDay });
  registry.refreshAll();
  const stats = registry.publicStats();
  const text = JSON.stringify(stats);

  for (const p of store.all('Patient')) {
    assert.ok(!text.includes(p.id), 'leaks a resource id');
    assert.ok(!text.includes(p.identifier[0].value), 'leaks a registry id');
    assert.ok(!text.includes(p.name[0].family), 'leaks a family name');
  }
  assert.ok(!text.includes('birthDate'));
  assert.equal(stats.syntheticData, true);
  assert.ok(stats.totals.eligible > 100);
  assert.ok(stats.totals.coveragePct > 0 && stats.totals.coveragePct < 100);
});

test('a group under the threshold reveals nothing but "<5"', () => {
  const store = new Store();
  const registry = new Registry(store, { today: fixedDay });
  for (let i = 0; i < 3; i++) {
    store.create(buildPatient({ given: 'A', family: 'B', birthDate: '1990-01-01', district: 'Tiny', registryId: `T${i}` }));
  }
  const tiny = registry.publicStats().byDistrict.find((d) => d.district === 'Tiny');
  assert.deepEqual(tiny, { district: 'Tiny', eligible: null, covered: null, overdue: null, neverScreened: null, coveragePct: null });
});

test('synthetic data is deterministic and labelled as test data', () => {
  const a = new Store();
  const b = new Store();
  seedStore(a, { count: 50, today: fixedDay() });
  seedStore(b, { count: 50, today: fixedDay() });
  assert.deepEqual(a.all('Patient').map((p) => p.birthDate), b.all('Patient').map((p) => p.birthDate));
  for (const type of ['Patient', 'Observation', 'Procedure']) {
    for (const r of a.all(type)) assert.equal(r.meta.security[0].code, 'HTEST');
  }
});
