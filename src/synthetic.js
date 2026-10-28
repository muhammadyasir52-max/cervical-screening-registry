// Synthetic demo population. Every name, date and result is randomly generated
// from a fixed seed; none of it describes a real person.

import { buildPatient, buildHpvObservation, buildCytologyObservation, buildColposcopy } from './fhir.js';
import { addDays, isoDate } from './rules.js';

const GIVEN = ['Amara', 'Bea', 'Chloe', 'Dina', 'Elif', 'Farah', 'Grace', 'Hana', 'Ines', 'Jade', 'Kezia', 'Lina',
  'Maya', 'Nadia', 'Oona', 'Priya', 'Rosa', 'Sana', 'Tara', 'Uma', 'Vera', 'Wren', 'Yara', 'Zoe'];
const FAMILY = ['Testwell', 'Sampleton', 'Demoford', 'Fakeley', 'Mockridge', 'Placeholder', 'Synthwood', 'Exemplar',
  'Dummett', 'Specimen', 'Trialby', 'Pretendo'];
export const DISTRICTS = ['Northfield', 'Riverside', 'Hillcrest', 'Lakeside', 'Eastbrook', 'Westmoor'];

// Small deterministic PRNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedStore(store, { count = 600, seed = 42, today = new Date() } = {}) {
  const rand = rng(seed);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const chance = (p) => rand() < p;
  const now = isoDate(today);

  for (let i = 0; i < count; i++) {
    const age = 20 + Math.floor(rand() * 51); // 20–70, so some are outside the eligible range
    const birthDate = addDays(now, -Math.round((age + rand()) * 365.25));
    const patient = store.create(buildPatient({
      given: pick(GIVEN),
      family: pick(FAMILY),
      birthDate,
      district: pick(DISTRICTS),
      registryId: `CSR-${String(i + 1).padStart(6, '0')}`,
      phone: `+00 0000 ${String(100000 + i).slice(-6)}`,
    }));

    if (age < 25 || chance(0.12)) continue; // never screened

    // Most recent screen between 0 and 7 years ago.
    const date = addDays(now, -Math.floor(rand() ** 2 * 7 * 365));
    const roll = rand();
    let hpv = 'negative';
    let cytology = null;
    if (roll < 0.03) hpv = 'invalid';
    else if (roll < 0.15) {
      hpv = 'positive';
      cytology = pick(['NILM', 'NILM', 'NILM', 'ASC-US', 'LSIL', 'LSIL', 'HSIL', 'ASC-H', 'UNSAT']);
    }
    store.create(buildHpvObservation({ patientId: patient.id, date, result: hpv }));
    if (cytology) store.create(buildCytologyObservation({ patientId: patient.id, date, result: cytology }));

    const abnormal = cytology && !['NILM', 'UNSAT'].includes(cytology);
    // Older abnormal results have almost always been followed up by now.
    if (abnormal && chance(date < addDays(now, -180) ? 0.97 : 0.6)) {
      const followUp = addDays(date, 14 + Math.floor(rand() * 60));
      if (followUp <= now) store.create(buildColposcopy({ patientId: patient.id, date: followUp }));
    }
  }
}
