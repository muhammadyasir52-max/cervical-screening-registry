// Ties the store and the rules together: re-evaluates patients, keeps the
// generated FHIR Flags (alerts) in sync, and builds the anonymised statistics.

import { evaluate, isoDate, STATUS } from './rules.js';
import { buildFlag, flagCode, patientIdOf, districtOf, displayName } from './fhir.js';
import { rules as defaultRules, suppressionThreshold } from './config.js';

export class Registry {
  constructor(store, { cfg = defaultRules, today = () => new Date() } = {}) {
    this.store = store;
    this.cfg = cfg;
    this.today = today;
  }

  evaluatePatient(patientId) {
    const patient = this.store.read('Patient', patientId);
    if (!patient) return null;
    return evaluate({
      patient,
      observations: this.store.forPatient('Observation', patientId),
      procedures: this.store.forPatient('Procedure', patientId),
    }, this.today(), this.cfg);
  }

  // Re-run the rules for one patient and open/close her Flags to match.
  refreshPatient(patientId) {
    const evaluation = this.evaluatePatient(patientId);
    if (!evaluation) return null;
    const today = isoDate(this.today());
    const wanted = new Map(evaluation.alerts.map((a) => [a.code, a]));
    const changes = { opened: 0, closed: 0 };

    for (const flag of this.store.forPatient('Flag', patientId)) {
      if (flag.status !== 'active') continue;
      const code = flagCode(flag);
      const want = wanted.get(code);
      if (want) {
        wanted.delete(code);
        if (flag.code.text !== want.detail) this.store.update({ ...flag, code: { ...flag.code, text: want.detail } });
      } else {
        this.store.update({ ...flag, status: 'inactive', period: { ...flag.period, end: today } });
        changes.closed++;
      }
    }
    for (const alert of wanted.values()) {
      this.store.create(buildFlag({ patientId, code: alert.code, start: today, detail: alert.detail }));
      changes.opened++;
    }
    return { evaluation, changes };
  }

  refreshAll() {
    const totals = { patients: 0, opened: 0, closed: 0 };
    for (const p of this.store.all('Patient')) {
      const { changes } = this.refreshPatient(p.id);
      totals.patients++;
      totals.opened += changes.opened;
      totals.closed += changes.closed;
    }
    return totals;
  }

  // Staff worklist: identifiable, so only served on the protected API.
  worklist() {
    return this.store.all('Patient').map((p) => {
      const e = this.evaluatePatient(p.id);
      return {
        id: p.id,
        registryId: p.identifier?.[0]?.value,
        name: displayName(p),
        birthDate: p.birthDate,
        district: districtOf(p),
        ...e,
      };
    });
  }

  activeAlerts() {
    return this.store.all('Flag')
      .filter((f) => f.status === 'active')
      .map((f) => {
        const patient = this.store.read('Patient', patientIdOf(f));
        return {
          id: f.id,
          code: flagCode(f),
          priority: f.extension?.[0]?.valueCodeableConcept?.coding?.[0]?.code,
          detail: f.code.text,
          since: f.period?.start,
          patientId: patient?.id,
          patientName: patient ? displayName(patient) : '(unknown)',
          registryId: patient?.identifier?.[0]?.value,
        };
      })
      .sort((a, b) => (a.priority === b.priority ? a.since.localeCompare(b.since) : a.priority === 'PH' ? -1 : 1));
  }

  // Anonymised aggregate statistics for the public dashboard.
  publicStats() {
    const rows = this.worklist();
    const eligible = rows.filter((r) => r.eligible);
    const today = isoDate(this.today());
    const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

    const summarise = (group) => {
      const covered = group.filter((r) => r.status === STATUS.UP_TO_DATE || r.status === STATUS.DUE_SOON).length;
      return suppressGroup({
        eligible: group.length,
        covered,
        overdue: group.filter((r) => r.status === STATUS.OVERDUE).length,
        neverScreened: group.filter((r) => r.neverScreened).length,
      });
    };

    const bands = [[25, 29], [30, 39], [40, 49], [50, 64]];
    const byAgeBand = bands.map(([lo, hi]) => ({
      band: `${lo}–${hi}`,
      ...summarise(eligible.filter((r) => r.age >= lo && r.age <= hi)),
    }));

    const districts = [...new Set(eligible.map((r) => r.district))].sort();
    const byDistrict = districts.map((d) => ({ district: d, ...summarise(eligible.filter((r) => r.district === d)) }));

    const recent = rows.filter((r) => r.lastScreen && r.lastScreen > yearAgo);
    const outcomes = {};
    for (const o of ['negative', 'hpv-positive-nilm', 'abnormal', 'inadequate']) {
      outcomes[o] = suppress(recent.filter((r) => r.lastOutcome === o).length);
    }

    return {
      generatedOn: today,
      syntheticData: true,
      suppressionThreshold,
      totals: {
        ...summarise(eligible),
        abnormalAwaitingFollowUp: suppress(rows.filter((r) => r.status === STATUS.ABNORMAL).length),
        screenedLast12Months: suppress(recent.length),
      },
      byAgeBand,
      byDistrict,
      outcomesLast12Months: outcomes,
    };
  }
}

// Counts from 1 to threshold-1 become null ("fewer than N"); zero stays zero.
export function suppress(n) {
  return n > 0 && n < suppressionThreshold ? null : n;
}

function suppressGroup({ eligible, covered, overdue, neverScreened }) {
  const small = eligible < suppressionThreshold;
  // A percentage would reveal a suppressed count, so hide it too.
  const hidePct = small || eligible === 0 || suppress(covered) === null;
  return {
    eligible: suppress(eligible),
    covered: small ? null : suppress(covered),
    overdue: small ? null : suppress(overdue),
    neverScreened: small ? null : suppress(neverScreened),
    coveragePct: hidePct ? null : Math.round((covered / eligible) * 1000) / 10,
  };
}
