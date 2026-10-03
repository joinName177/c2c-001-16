import type { TimeRepository } from '../ports/time-repository.port';
import type { TimeSnapshot } from '../core/models';
import { sampleSnapshot } from '../core/time-engine';

const KEY = 'c2c-001-time-investment';
export class LocalTimeRepository implements TimeRepository {
  load(): TimeSnapshot {
    try { const value = localStorage.getItem(KEY); if (value) { const snapshot = JSON.parse(value) as TimeSnapshot; return { account: snapshot.account, records: snapshot.records ?? [], templates: snapshot.templates ?? [] }; } } catch { /* use seed */ }
    return sampleSnapshot();
  }
  save(snapshot: TimeSnapshot) { localStorage.setItem(KEY, JSON.stringify({ account: snapshot.account, records: snapshot.records, templates: snapshot.templates ?? [] })); }
}
