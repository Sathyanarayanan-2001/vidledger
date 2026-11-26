// Per-record merge for multi-device sync.
// A record is {u, ...} where u is the update time in ms. A deletion is a
// tombstone {d: 1, u}. merge() picks, per key, the record that is largest under
// the total order (u, canonical JSON text). A max under a total order is
// commutative, associative and idempotent, so every device converges to the same
// result whatever order save files arrive in.

/** JSON with object keys sorted at every level, so equal data gives equal text. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}

export function isValidRecord(rec) {
  return !!rec && typeof rec === 'object' && Number.isFinite(rec.u) && rec.u >= 0;
}

/** Newer u wins; on an exact tie the larger canonical text wins. */
export function pickWinner(a, b) {
  if (!isValidRecord(a)) return isValidRecord(b) ? b : undefined;
  if (!isValidRecord(b)) return a;
  if (a.u !== b.u) return a.u > b.u ? a : b;
  const ca = canonicalJson(a);
  const cb = canonicalJson(b);
  return ca >= cb ? a : b;
}

/** Merge two {key: record} objects into a new one. O(n + m) with hash maps. */
export function merge(a, b) {
  const out = Object.create(null);
  for (const [k, v] of Object.entries(a || {})) if (isValidRecord(v)) out[k] = v;
  for (const [k, v] of Object.entries(b || {})) {
    const w = pickWinner(out[k], v);
    if (w) out[k] = w;
  }
  return out;
}

export function mergeAll(list) {
  return list.reduce((acc, recs) => merge(acc, recs), Object.create(null));
}

export const tombstone = (u) => ({ d: 1, u });
export const isTombstone = (rec) => !!rec && rec.d === 1;

/** Live records only, as [key, value] pairs. */
export function liveEntries(records) {
  return Object.entries(records).filter(([, r]) => !isTombstone(r));
}
