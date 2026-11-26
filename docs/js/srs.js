// Spaced repetition: a small SM-2 scheduler. Pure functions over YYYY-MM-DD dates,
// so the same card is due on the same day on every device and in the tests.
// A card's progress is {due, ivl, ef, reps, lapses, last}; no progress means "new".

import { addDays } from './format.js';

export const GRADES = [
  { key: 'again', label: 'Again', hint: 'Forgot' },
  { key: 'hard', label: 'Hard', hint: 'Recalled with effort' },
  { key: 'good', label: 'Good', hint: 'Recalled' },
  { key: 'easy', label: 'Easy', hint: 'Instant' },
];
const MIN_EF = 1.3;
const MAX_IVL = 365;

const clampIvl = (n) => Math.max(1, Math.min(MAX_IVL, Math.round(n)));

/** New progress after answering with grade 0..3 (again, hard, good, easy) on `today`. */
export function schedule(prev, grade, today) {
  const p = prev && prev.due ? { ...prev } : { ivl: 0, ef: 2.5, reps: 0, lapses: 0 };
  let { ivl, ef, reps, lapses } = p;
  if (grade === 0) {
    // Forgotten: see it again today, then start the ladder over.
    lapses += prev && prev.reps ? 1 : 0;
    reps = 0;
    ivl = 0;
    ef = Math.max(MIN_EF, ef - 0.2);
  } else if (grade === 1) {
    ivl = reps === 0 ? 1 : clampIvl(ivl * 1.2);
    ef = Math.max(MIN_EF, ef - 0.15);
    reps += 1;
  } else if (grade === 2) {
    ivl = reps === 0 ? 1 : reps === 1 ? 3 : clampIvl(ivl * ef);
    reps += 1;
  } else {
    ivl = reps === 0 ? 4 : clampIvl(Math.max(ivl, 1) * ef * 1.3);
    ef = Math.min(3.5, ef + 0.15);
    reps += 1;
  }
  return { due: addDays(today, ivl), ivl, ef: Math.round(ef * 100) / 100, reps, lapses, last: today };
}

/** "today", "1 d", "12 d", "3 wk", "4 mo" for the next interval a grade would give. */
export function intervalLabel(days) {
  if (days <= 0) return 'today';
  if (days < 14) return `${days} d`;
  if (days < 60) return `${Math.round(days / 7)} wk`;
  return `${Math.round(days / 30)} mo`;
}

export const isNew = (progress) => !progress || !progress.due;
export const isDue = (progress, today) => !!progress && !!progress.due && progress.due <= today;

/**
 * Today's queue: due reviews first (oldest due first), then up to `newLeft` new cards in library order.
 * cards: [{key, ...}]; progressOf(key) -> progress or undefined.
 */
export function buildQueue(cards, progressOf, today, newLeft) {
  const due = [];
  const fresh = [];
  for (const c of cards) {
    const p = progressOf(c.key);
    if (isNew(p)) fresh.push(c);
    else if (isDue(p, today)) due.push({ c, due: p.due });
  }
  due.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return [...due.map((x) => x.c), ...fresh.slice(0, Math.max(0, newLeft))];
}

/** Counts for tiles: {due, fresh, learned (seen at least once), mature (interval of 21 days or more)}. */
export function deckStats(cards, progressOf, today) {
  let due = 0;
  let fresh = 0;
  let learned = 0;
  let mature = 0;
  for (const c of cards) {
    const p = progressOf(c.key);
    if (isNew(p)) fresh++;
    else {
      learned++;
      if (p.ivl >= 21) mature++;
      if (isDue(p, today)) due++;
    }
  }
  return { due, fresh, learned, mature, total: cards.length };
}
