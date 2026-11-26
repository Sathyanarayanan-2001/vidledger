// Keeps your records in step with records.json on the vidledger-user branch of
// the private repository, so the agent and your other devices see your choices.
// Saving is debounced; a conflict with another device is merged per record
// (newest edit wins, see merge.js) and saved again.

import { merge } from './merge.js';

export const STATUS_TEXT = {
  local: 'Saved on this device',
  saving: 'Saving…',
  saved: 'Saved to GitHub',
  waiting: 'Will save when online',
  error: 'Not saved: see Settings',
};

export function parseRecordsFile(text) {
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    return data && typeof data.records === 'object' && data.records ? data.records : {};
  } catch {
    return {};
  }
}

export function serialiseRecords(records) {
  return JSON.stringify({ schema: 1, app: 'vidledger', saved_at: new Date().toISOString(), records });
}

export class RemoteRecords {
  constructor(store, gh, { onStatus = () => {}, debounceMs = 2500, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t), online = () => navigator.onLine } = {}) {
    this.store = store;
    this.gh = gh;
    this.onStatus = onStatus;
    this.debounceMs = debounceMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.online = online;
    this.dirty = false;
    this.timer = null;
    this.busy = null;
    this.status = 'saved';
    this.detail = '';
    this.unsub = store.onChange((source) => {
      if (source === 'local') {
        this.dirty = true;
        this.schedule();
      }
    });
  }

  set(status, detail = '') {
    this.status = status;
    this.detail = detail;
    this.onStatus(status, detail);
  }

  stop() {
    if (this.timer) this.clearTimer(this.timer);
    if (this.unsub) this.unsub();
  }

  schedule() {
    if (this.timer) this.clearTimer(this.timer);
    this.set(this.online() ? 'saving' : 'waiting');
    this.timer = this.setTimer(() => { this.timer = null; this.push().catch(() => {}); }, this.debounceMs);
  }

  /** Bring in changes saved by the agent's other readers or your other devices. */
  async pull() {
    const res = await this.gh.getUserRecords();
    if (res.exists) await this.store.mergeIn(parseRecordsFile(res.text), 'remote');
    if (!this.dirty) this.set('saved');
    return res.exists;
  }

  /** Save now; resolves when GitHub has your latest records (or rejects with the reason). */
  async flush() {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    await this.push();
  }

  push() {
    if (!this.busy) this.busy = this._push().finally(() => { this.busy = null; });
    else this.busy = this.busy.then(() => this._push());
    return this.busy;
  }

  async _push() {
    if (!this.dirty) return;
    if (!this.online()) {
      this.set('waiting');
      throw new Error('You are offline. Your changes are kept on this device and save when you are back online.');
    }
    this.set('saving');
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const remote = await this.gh.getUserRecords();
        const theirs = parseRecordsFile(remote.text);
        const merged = merge(theirs, this.store.snapshot());
        this.dirty = false; // edits made while saving set it again
        await this.gh.putUserRecords(serialiseRecords(merged), remote.sha, `dashboard save (${Object.keys(merged).length} records)`);
        await this.store.mergeIn(theirs, 'remote');
        this.set(this.dirty ? 'saving' : 'saved');
        return;
      } catch (err) {
        this.dirty = true;
        lastErr = err;
        if (err.status !== 409) break;
      }
    }
    this.set('error', lastErr ? lastErr.message : 'Saving failed.');
    throw lastErr || new Error('Saving failed.');
  }
}
