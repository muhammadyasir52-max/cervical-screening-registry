// Screening rules engine. Pure functions: given one patient's FHIR resources
// and a reference date, work out her screening status and which alerts apply.

import { rules as defaultRules } from './config.js';
import { tests, systems, hasCoding, codeIn, colposcopy } from './fhir.js';

export const STATUS = {
  NOT_ELIGIBLE: 'not-eligible',
  UP_TO_DATE: 'up-to-date',
  DUE_SOON: 'due-soon',
  OVERDUE: 'overdue',
  ABNORMAL: 'abnormal',
};

const HPV_CODES = { '10828004': 'positive', '260385009': 'negative', '125154007': 'invalid' };

export function ageOn(birthDate, date) {
  const b = new Date(birthDate);
  const d = new Date(date);
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const m = d.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && d.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

export function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return isoDate(d);
}

export const addDays = (date, days) => isoDate(new Date(new Date(date).getTime() + days * 86400000));
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export const isoDate = (d) => new Date(d).toISOString().slice(0, 10);

// Classify one screening episode (all results taken on the same date).
export function classifyEpisode({ hpv, cytology }) {
  const abnormalCytology = cytology && !['NILM', 'UNSAT'].includes(cytology);
  if (abnormalCytology) return 'abnormal';
  if (hpv === 'positive' && !cytology) return 'abnormal'; // needs triage
  if (hpv === 'positive' && cytology === 'NILM') return 'hpv-positive-nilm';
  if (hpv === 'invalid' || cytology === 'UNSAT') return 'inadequate';
  if (hpv === 'negative' || cytology === 'NILM') return 'negative';
  return 'inadequate';
}

// Collapse a patient's Observations into dated episodes, newest first.
export function episodesFrom(observations) {
  const byDate = new Map();
  for (const obs of observations) {
    if (obs.status === 'entered-in-error' || obs.status === 'cancelled') continue;
    const date = (obs.effectiveDateTime || '').slice(0, 10);
    if (!date) continue;
    const ep = byDate.get(date) || { date };
    if (hasCoding(obs.code, tests.hpv)) {
      ep.hpv = HPV_CODES[codeIn(obs.valueCodeableConcept, systems.snomed)] || 'invalid';
    } else if (hasCoding(obs.code, tests.cytology)) {
      ep.cytology = codeIn(obs.valueCodeableConcept, systems.bethesda) || 'UNSAT';
    } else continue;
    byDate.set(date, ep);
  }
  return [...byDate.values()]
    .map((ep) => ({ ...ep, outcome: classifyEpisode(ep) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function routineMonths(age, cfg) {
  const band = cfg.intervals.find((i) => age >= i.minAge && age <= i.maxAge);
  return band ? band.months : cfg.intervals[cfg.intervals.length - 1].months;
}

/**
 * Evaluate one patient.
 * @returns {{status, age, eligible, dueDate, lastScreen, lastOutcome, neverScreened, alerts: {code, detail}[]}}
 */
export function evaluate({ patient, observations = [], procedures = [] }, asOf, cfg = defaultRules) {
  const today = isoDate(asOf);
  const age = ageOn(patient.birthDate, today);
  const eligible = patient.active !== false && patient.gender === 'female'
    && age >= cfg.eligibleAge.min && age <= cfg.eligibleAge.max;

  const episodes = episodesFrom(observations);
  const last = episodes[0];
  const colposcopies = procedures
    .filter((p) => p.status === 'completed' && hasCoding(p.code, colposcopy))
    .map((p) => p.performedDateTime.slice(0, 10))
    .sort();

  const result = {
    age,
    eligible,
    lastScreen: last?.date || null,
    lastOutcome: last?.outcome || null,
    neverScreened: !last,
    dueDate: null,
    status: null,
    alerts: [],
  };

  // An abnormal result needs follow-up whatever her age.
  if (last?.outcome === 'abnormal') {
    const followUp = colposcopies.find((d) => d >= last.date);
    if (!followUp) {
      const waited = daysBetween(last.date, today);
      result.status = STATUS.ABNORMAL;
      result.dueDate = addDays(last.date, cfg.abnormalFollowUpDays);
      const detail = describe(last);
      result.alerts.push(waited > cfg.abnormalFollowUpDays
        ? { code: 'follow-up-overdue', detail: `${detail} on ${last.date}; no colposcopy after ${waited} days` }
        : { code: 'abnormal-result', detail: `${detail} on ${last.date}: refer for colposcopy` });
      return result;
    }
    // Followed up: recall early for a test of cure.
    result.dueDate = addMonths(followUp, cfg.hpvPositiveRepeatMonths);
  } else if (last) {
    const months = last.outcome === 'hpv-positive-nilm' ? cfg.hpvPositiveRepeatMonths
      : last.outcome === 'inadequate' ? cfg.inadequateRepeatMonths
        : routineMonths(ageOn(patient.birthDate, last.date), cfg);
    result.dueDate = addMonths(last.date, months);
  } else {
    // Never screened: due from her first eligible birthday.
    result.dueDate = addMonths(patient.birthDate, cfg.eligibleAge.min * 12);
  }

  if (!eligible) {
    result.status = STATUS.NOT_ELIGIBLE;
    return result;
  }

  if (result.dueDate < today) {
    result.status = STATUS.OVERDUE;
    result.alerts.push(result.neverScreened
      ? { code: 'never-screened', detail: `Eligible since ${result.dueDate}; no screening on record` }
      : { code: 'overdue', detail: `Due ${result.dueDate} (last screened ${result.lastScreen})` });
  } else if (daysBetween(today, result.dueDate) <= cfg.dueSoonDays) {
    result.status = STATUS.DUE_SOON;
  } else {
    result.status = STATUS.UP_TO_DATE;
  }
  return result;
}

function describe(ep) {
  const parts = [];
  if (ep.hpv) parts.push(`HPV ${ep.hpv}`);
  if (ep.cytology) parts.push(`cytology ${ep.cytology}`);
  return parts.join(', ');
}
