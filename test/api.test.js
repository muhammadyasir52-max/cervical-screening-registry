import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Store } from '../src/store.js';
import { Registry } from '../src/registry.js';
import { createApp } from '../src/app.js';
import { tests } from '../src/fhir.js';

let server;
let base;

before(async () => {
  const registry = new Registry(new Store(), { today: () => new Date('2026-06-15') });
  server = createServer(createApp(registry, { apiKey: 'demo-key' }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const auth = { Authorization: 'Bearer demo-key', 'Content-Type': 'application/json' };
const post = (path, body, headers = auth) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });

test('public stats need no key; FHIR endpoints do', async () => {
  assert.equal((await fetch(`${base}/api/public/stats`)).status, 200);
  const res = await fetch(`${base}/fhir/Patient`);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).resourceType, 'OperationOutcome');
});

test('register, record an abnormal result, see an alert, follow up, alert clears', async () => {
  const reg = await post('/api/register', { given: 'Demo', family: 'Person', birthDate: '1988-04-02', district: 'Riverside' });
  assert.equal(reg.status, 201);
  const { patient, evaluation } = await reg.json();
  assert.equal(evaluation.status, 'overdue');

  const result = await post('/api/results', { patientId: patient.id, date: '2026-06-10', hpv: 'positive', cytology: 'HSIL' });
  assert.equal((await result.json()).evaluation.status, 'abnormal');

  let alerts = await (await fetch(`${base}/api/alerts`, { headers: auth })).json();
  assert.deepEqual(alerts.filter((a) => a.patientId === patient.id).map((a) => a.code), ['abnormal-result']);

  await post('/api/follow-up', { patientId: patient.id, date: '2026-06-14' });
  alerts = await (await fetch(`${base}/api/alerts`, { headers: auth })).json();
  assert.equal(alerts.filter((a) => a.patientId === patient.id).length, 0);
});

test('FHIR create, read and search', async () => {
  const created = await post('/fhir/Patient', {
    resourceType: 'Patient', gender: 'female', birthDate: '1980-02-02',
    name: [{ family: 'Fhirson', given: ['Ada'] }], identifier: [{ system: 'urn:test', value: 'X-1' }],
  });
  assert.equal(created.status, 201);
  assert.match(created.headers.get('location'), /^\/fhir\/Patient\/[\w-]+\/_history\/1$/);
  const p = await created.json();

  const obs = await post('/fhir/Observation', {
    resourceType: 'Observation', status: 'final', code: { coding: [tests.hpv] },
    subject: { reference: `Patient/${p.id}` }, effectiveDateTime: '2026-01-05',
    valueCodeableConcept: { coding: [{ system: 'http://snomed.info/sct', code: '260385009' }] },
  });
  assert.equal(obs.status, 201);

  const read = await (await fetch(`${base}/fhir/Patient/${p.id}`, { headers: auth })).json();
  assert.equal(read.name[0].family, 'Fhirson');

  const bundle = await (await fetch(`${base}/fhir/Observation?patient=${p.id}`, { headers: auth })).json();
  assert.equal(bundle.resourceType, 'Bundle');
  assert.equal(bundle.total, 1);

  const byId = await (await fetch(`${base}/fhir/Patient?identifier=urn:test|X-1`, { headers: auth })).json();
  assert.equal(byId.total, 1);
});

test('invalid resources are rejected with an OperationOutcome', async () => {
  const res = await post('/fhir/Patient', { resourceType: 'Patient', gender: 'male', birthDate: '1980-01-01', name: [{ family: 'X' }] });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.issue[0].code, 'invalid');

  const flag = await post('/fhir/Flag', { resourceType: 'Flag' });
  assert.equal(flag.status, 405);

  const orphan = await post('/api/results', { patientId: 'nope', hpv: 'negative' });
  assert.equal(orphan.status, 422);
});

test('capability statement describes the API', async () => {
  const cs = await (await fetch(`${base}/fhir/metadata`, { headers: auth })).json();
  assert.equal(cs.fhirVersion, '4.0.1');
  assert.deepEqual(cs.rest[0].resource.map((r) => r.type), ['Patient', 'Observation', 'Procedure', 'Flag']);
});
