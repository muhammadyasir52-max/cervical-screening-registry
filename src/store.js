// A tiny FHIR resource store: in memory, optionally persisted to one JSON file.
// Good enough for a prototype; swap for a real FHIR server (HAPI, Medplum,
// Azure/Google Healthcare API) in production.

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const RESOURCE_TYPES = ['Patient', 'Observation', 'Procedure', 'Flag'];

export class Store {
  constructor(file = null) {
    this.file = file;
    this.data = Object.fromEntries(RESOURCE_TYPES.map((t) => [t, new Map()]));
    if (file && existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      for (const t of RESOURCE_TYPES) for (const r of saved[t] || []) this.data[t].set(r.id, r);
    }
  }

  create(resource) {
    const r = structuredClone(resource);
    r.id = randomUUID();
    r.meta = { ...(r.meta || {}), versionId: '1', lastUpdated: new Date().toISOString() };
    this.data[r.resourceType].set(r.id, r);
    return r;
  }

  update(resource) {
    const prev = this.read(resource.resourceType, resource.id);
    if (!prev) throw new Error(`${resource.resourceType}/${resource.id} not found`);
    const r = structuredClone(resource);
    r.meta = { ...(r.meta || {}), versionId: String(Number(prev.meta.versionId) + 1), lastUpdated: new Date().toISOString() };
    this.data[r.resourceType].set(r.id, r);
    return r;
  }

  read(type, id) {
    return this.data[type]?.get(id) || null;
  }

  all(type) {
    return [...(this.data[type]?.values() || [])];
  }

  forPatient(type, patientId) {
    const ref = `Patient/${patientId}`;
    return this.all(type).filter((r) => r.subject?.reference === ref);
  }

  clear() {
    for (const t of RESOURCE_TYPES) this.data[t].clear();
  }

  save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const out = Object.fromEntries(RESOURCE_TYPES.map((t) => [t, this.all(t)]));
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(out));
    renameSync(tmp, this.file);
  }
}
