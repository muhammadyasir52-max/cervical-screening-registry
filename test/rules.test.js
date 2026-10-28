import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, classifyEpisode, addMonths, STATUS } from '../src/rules.js';
import { buildPatient, buildHpvObservation, buildCytologyObservation, buildColposcopy } from '../src/fhir.js';

const TODAY = '2026-06-15';
const patient = (birthDate) => ({ ...buildPatient({ given: 'Test', family: 'Case', birthDate, district: 'X', registryId: 'T1' }), id: 'p1' });
const hpv = (date, result) => buildHpvObservation({ patientId: 'p1', date, result });
const cyto = (date, result) => buildCytologyObservation({ patientId: 'p1', date, result });

test('classifies screening episodes', () => {
  assert.equal(classifyEpisode({ hpv: 'negative' }), 'negative');
  assert.equal(classifyEpisode({ hpv: 'positive', cytology: 'NILM' }), 'hpv-positive-nilm');
  assert.equal(classifyEpisode({ hpv: 'positive', cytology: 'HSIL' }), 'abnormal');
  assert.equal(classifyEpisode({ hpv: 'positive' }), 'abnormal');
  assert.equal(classifyEpisode({ hpv: 'invalid' }), 'inadequate');
  assert.equal(classifyEpisode({ cytology: 'UNSAT' }), 'inadequate');
});

test('addMonths clamps to the end of short months', () => {
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2023-03-15', 36), '2026-03-15');
});

test('under 25 is not eligible and gets no alerts', () => {
  const r = evaluate({ patient: patient('2003-01-01') }, TODAY);
  assert.equal(r.status, STATUS.NOT_ELIGIBLE);
  assert.deepEqual(r.alerts, []);
});

test('eligible and never screened is overdue with a never-screened alert', () => {
  const r = evaluate({ patient: patient('1990-01-01') }, TODAY);
  assert.equal(r.status, STATUS.OVERDUE);
  assert.equal(r.dueDate, '2015-01-01');
  assert.deepEqual(r.alerts.map((a) => a.code), ['never-screened']);
});

test('negative HPV at 35 recalls in 3 years', () => {
  const r = evaluate({ patient: patient('1990-01-01'), observations: [hpv('2025-02-01', 'negative')] }, TODAY);
  assert.equal(r.status, STATUS.UP_TO_DATE);
  assert.equal(r.dueDate, '2028-02-01');
  assert.deepEqual(r.alerts, []);
});

test('negative HPV at 55 recalls in 5 years', () => {
  const r = evaluate({ patient: patient('1970-01-01'), observations: [hpv('2022-01-10', 'negative')] }, TODAY);
  assert.equal(r.dueDate, '2027-01-10');
  assert.equal(r.status, STATUS.UP_TO_DATE);
});

test('last screen past its interval is overdue', () => {
  const r = evaluate({ patient: patient('1990-01-01'), observations: [hpv('2022-01-01', 'negative')] }, TODAY);
  assert.equal(r.status, STATUS.OVERDUE);
  assert.deepEqual(r.alerts.map((a) => a.code), ['overdue']);
});

test('due within 90 days is due-soon, without an alert', () => {
  const r = evaluate({ patient: patient('1990-01-01'), observations: [hpv('2023-08-01', 'negative')] }, TODAY);
  assert.equal(r.status, STATUS.DUE_SOON);
  assert.deepEqual(r.alerts, []);
});

test('HPV positive with normal cytology recalls in 12 months', () => {
  const r = evaluate({ patient: patient('1990-01-01'), observations: [hpv('2026-01-10', 'positive'), cyto('2026-01-10', 'NILM')] }, TODAY);
  assert.equal(r.lastOutcome, 'hpv-positive-nilm');
  assert.equal(r.dueDate, '2027-01-10');
});

test('recent abnormal result raises an abnormal-result alert', () => {
  const r = evaluate({ patient: patient('1990-01-01'), observations: [hpv('2026-06-01', 'positive'), cyto('2026-06-01', 'HSIL')] }, TODAY);
  assert.equal(r.status, STATUS.ABNORMAL);
  assert.deepEqual(r.alerts.map((a) => a.code), ['abnormal-result']);
});

test('abnormal result without follow-up after 42 days escalates', () => {
  const r = evaluate({ patient: patient('1990-01-01'), observations: [hpv('2026-03-01', 'positive'), cyto('2026-03-01', 'LSIL')] }, TODAY);
  assert.deepEqual(r.alerts.map((a) => a.code), ['follow-up-overdue']);
});

test('colposcopy after an abnormal result clears the alert and sets early recall', () => {
  const r = evaluate({
    patient: patient('1990-01-01'),
    observations: [hpv('2026-03-01', 'positive'), cyto('2026-03-01', 'LSIL')],
    procedures: [buildColposcopy({ patientId: 'p1', date: '2026-04-01' })],
  }, TODAY);
  assert.equal(r.status, STATUS.UP_TO_DATE);
  assert.equal(r.dueDate, '2027-04-01');
  assert.deepEqual(r.alerts, []);
});

test('abnormal result still needs follow-up when she has aged out', () => {
  const r = evaluate({ patient: patient('1960-01-01'), observations: [hpv('2026-05-01', 'positive'), cyto('2026-05-01', 'HSIL')] }, TODAY);
  assert.equal(r.eligible, false);
  assert.equal(r.status, STATUS.ABNORMAL);
});

test('entered-in-error results are ignored', () => {
  const bad = { ...cyto('2026-06-01', 'HSIL'), status: 'entered-in-error' };
  const r = evaluate({ patient: patient('1990-01-01'), observations: [hpv('2025-06-01', 'negative'), bad] }, TODAY);
  assert.equal(r.lastOutcome, 'negative');
});
