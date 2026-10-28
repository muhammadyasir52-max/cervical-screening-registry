// FHIR R4 code systems, resource builders and minimal validation.
// Only the subset of FHIR this registry needs is implemented.

const BASE = 'https://example.org/cervical-registry/fhir';

export const systems = {
  loinc: 'http://loinc.org',
  snomed: 'http://snomed.info/sct',
  registryId: `${BASE}/sid/registry-id`,
  district: `${BASE}/StructureDefinition/district`,
  bethesda: `${BASE}/CodeSystem/bethesda-category`,
  alert: `${BASE}/CodeSystem/screening-alert`,
  obsCategory: 'http://terminology.hl7.org/CodeSystem/observation-category',
  interpretation: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
  flagCategory: 'http://terminology.hl7.org/CodeSystem/flag-category',
  flagPriority: 'http://hl7.org/fhir/flag-priority-code',
  actReason: 'http://terminology.hl7.org/CodeSystem/v3-ActReason',
};

export const tests = {
  hpv: {
    system: systems.loinc,
    code: '21440-3',
    display: 'Human papilloma virus 16+18+31+33+35+45+51+52+56 DNA [Presence] in Cervix by Probe',
  },
  cytology: {
    system: systems.loinc,
    code: '10524-7',
    display: 'Microscopic observation [Identifier] in Cervix by Cyto stain',
  },
};

export const hpvResults = {
  positive: { system: systems.snomed, code: '10828004', display: 'Positive' },
  negative: { system: systems.snomed, code: '260385009', display: 'Negative' },
  invalid: { system: systems.snomed, code: '125154007', display: 'Specimen unsatisfactory for evaluation' },
};

// Bethesda system categories for cervical cytology.
export const cytologyResults = {
  NILM: 'Negative for intraepithelial lesion or malignancy',
  'ASC-US': 'Atypical squamous cells of undetermined significance',
  LSIL: 'Low-grade squamous intraepithelial lesion',
  'ASC-H': 'Atypical squamous cells, cannot exclude HSIL',
  HSIL: 'High-grade squamous intraepithelial lesion',
  AGC: 'Atypical glandular cells',
  SCC: 'Squamous cell carcinoma',
  UNSAT: 'Unsatisfactory for evaluation',
};

export const colposcopy = { system: systems.snomed, code: '392003006', display: 'Colposcopy' };

export const alertCodes = {
  'never-screened': { display: 'Eligible and never screened', priority: 'PM' },
  overdue: { display: 'Screening overdue', priority: 'PM' },
  'abnormal-result': { display: 'Abnormal result: refer for colposcopy', priority: 'PH' },
  'follow-up-overdue': { display: 'Abnormal result with no follow-up recorded', priority: 'PH' },
};

// Every resource carries the HL7 "test health data" security label so that
// demo records can never be mistaken for real ones.
export const testDataMeta = () => ({
  security: [{ system: systems.actReason, code: 'HTEST', display: 'test health data' }],
});

export function buildPatient({ given, family, birthDate, district, registryId, phone }) {
  const patient = {
    resourceType: 'Patient',
    meta: testDataMeta(),
    identifier: [{ system: systems.registryId, value: registryId }],
    active: true,
    name: [{ use: 'official', family, given: [given] }],
    gender: 'female',
    birthDate,
    address: [{ use: 'home', district }],
  };
  if (phone) patient.telecom = [{ system: 'phone', value: phone }];
  return patient;
}

export function buildHpvObservation({ patientId, date, result }) {
  const value = hpvResults[result];
  if (!value) throw new Error(`Unknown HPV result: ${result}`);
  return {
    resourceType: 'Observation',
    meta: testDataMeta(),
    status: 'final',
    category: [{ coding: [{ system: systems.obsCategory, code: 'laboratory' }] }],
    code: { coding: [tests.hpv], text: 'HPV test' },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: date,
    valueCodeableConcept: { coding: [value], text: value.display },
    interpretation: [interpretation(result === 'positive' ? 'POS' : result === 'negative' ? 'NEG' : 'IND')],
  };
}

export function buildCytologyObservation({ patientId, date, result }) {
  const display = cytologyResults[result];
  if (!display) throw new Error(`Unknown cytology result: ${result}`);
  const code = result === 'NILM' ? 'N' : result === 'UNSAT' ? 'IND' : 'A';
  return {
    resourceType: 'Observation',
    meta: testDataMeta(),
    status: 'final',
    category: [{ coding: [{ system: systems.obsCategory, code: 'laboratory' }] }],
    code: { coding: [tests.cytology], text: 'Cervical cytology' },
    subject: { reference: `Patient/${patientId}` },
    effectiveDateTime: date,
    valueCodeableConcept: { coding: [{ system: systems.bethesda, code: result, display }], text: display },
    interpretation: [interpretation(code)],
  };
}

export function buildColposcopy({ patientId, date }) {
  return {
    resourceType: 'Procedure',
    meta: testDataMeta(),
    status: 'completed',
    code: { coding: [colposcopy], text: 'Colposcopy' },
    subject: { reference: `Patient/${patientId}` },
    performedDateTime: date,
  };
}

export function buildFlag({ patientId, code, start, detail }) {
  const def = alertCodes[code];
  return {
    resourceType: 'Flag',
    meta: testDataMeta(),
    extension: [{
      url: 'http://hl7.org/fhir/StructureDefinition/flag-priority',
      valueCodeableConcept: { coding: [{ system: systems.flagPriority, code: def.priority }] },
    }],
    status: 'active',
    category: [{ coding: [{ system: systems.flagCategory, code: 'clinical', display: 'Clinical' }] }],
    code: { coding: [{ system: systems.alert, code, display: def.display }], text: detail || def.display },
    subject: { reference: `Patient/${patientId}` },
    period: { start },
  };
}

function interpretation(code) {
  return { coding: [{ system: systems.interpretation, code }] };
}

// --- Reading helpers -------------------------------------------------------

export const patientIdOf = (resource) => resource.subject?.reference?.replace(/^Patient\//, '');

export const hasCoding = (concept, { system, code }) =>
  (concept?.coding || []).some((c) => c.system === system && c.code === code);

export const codeIn = (concept, system) =>
  (concept?.coding || []).find((c) => c.system === system)?.code;

export const flagCode = (flag) => codeIn(flag.code, systems.alert);

export const districtOf = (patient) => patient.address?.[0]?.district || 'Unknown';

export const displayName = (patient) => {
  const n = patient.name?.[0];
  return n ? `${(n.given || []).join(' ')} ${n.family || ''}`.trim() : '(no name)';
};

// --- Validation ------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}/;

// Returns a list of human-readable problems; an empty list means valid.
export function validate(resource) {
  const problems = [];
  if (!resource || typeof resource !== 'object') return ['Body must be a JSON object'];
  switch (resource.resourceType) {
    case 'Patient':
      if (resource.gender !== 'female') problems.push('Patient.gender must be "female" for this registry');
      if (!DATE.test(resource.birthDate || '')) problems.push('Patient.birthDate is required (YYYY-MM-DD)');
      if (!resource.name?.[0]?.family) problems.push('Patient.name[0].family is required');
      break;
    case 'Observation': {
      const known = hasCoding(resource.code, tests.hpv) || hasCoding(resource.code, tests.cytology);
      if (!known) problems.push(`Observation.code must be LOINC ${tests.hpv.code} (HPV) or ${tests.cytology.code} (cytology)`);
      if (!patientIdOf(resource)) problems.push('Observation.subject must reference a Patient');
      if (!DATE.test(resource.effectiveDateTime || '')) problems.push('Observation.effectiveDateTime is required');
      if (!resource.valueCodeableConcept?.coding?.length) problems.push('Observation.valueCodeableConcept is required');
      break;
    }
    case 'Procedure':
      if (!hasCoding(resource.code, colposcopy)) problems.push(`Procedure.code must be SNOMED ${colposcopy.code} (colposcopy)`);
      if (!patientIdOf(resource)) problems.push('Procedure.subject must reference a Patient');
      if (!DATE.test(resource.performedDateTime || '')) problems.push('Procedure.performedDateTime is required');
      break;
    default:
      problems.push(`Unsupported resourceType: ${resource.resourceType}`);
  }
  return problems;
}
