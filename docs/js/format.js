// Formatting and calendar maths. Pure functions, no DOM, so Node tests can import them.
// Dates are day first (dd/mm/yyyy); weeks are ISO weeks (CW48); counts use Indian grouping.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Only http(s) and mailto links may be rendered; anything else (javascript:, data:) is dropped. */
export function safeUrl(value) {
  try {
    const u = new URL(String(value));
    return ['https:', 'http:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- numbers

/** 12345678 -> "1,23,456.78" (lakh/crore grouping). Integer arithmetic only. */
export function formatInr(paise) {
  if (!Number.isSafeInteger(paise)) throw new TypeError('paise must be a safe integer');
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rem = abs % 100;
  let digits = String(rupees);
  if (digits.length > 3) {
    let head = digits.slice(0, -3);
    const tail = digits.slice(-3);
    const groups = [];
    while (head.length > 2) {
      groups.unshift(head.slice(-2));
      head = head.slice(0, -2);
    }
    if (head) groups.unshift(head);
    digits = [...groups, tail].join(',');
  }
  return `${sign}${digits}.${String(rem).padStart(2, '0')}`;
}

/** Whole numbers with Indian grouping, for counts: 123456 -> "1,23,456". */
export function formatCount(n) {
  return formatInr(Math.round(n) * 100).slice(0, -3);
}

// ---------------------------------------------------------------- calendar

const partCache = new Map();
function partsFormatter(timeZone) {
  let f = partCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    partCache.set(timeZone, f);
  }
  return f;
}

export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Calendar parts of an instant in a time zone. Formatter is cached: O(1) amortised. */
export function localParts(date, timeZone = deviceTimeZone()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const p = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(d)) p[type] = value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour), mm: Number(p.minute) };
}

const DAY_MS = 86_400_000;

/** ISO 8601 week of a calendar date: weeks start Monday; week 1 holds the year's first Thursday. */
export function isoWeekOfYmd(y, m, d) {
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  const thursday = t + (3 - dow) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY_MS / 7);
  return { year, week };
}

export function isoWeek(date, timeZone) {
  const p = localParts(date, timeZone);
  return p ? isoWeekOfYmd(p.y, p.m, p.d) : null;
}

export const cwLabel = (w) => `CW${String(w.week).padStart(2, '0')}`;
export const cwKey = (w) => `${w.year}-W${String(w.week).padStart(2, '0')}`;

/** Monday (UTC midnight of the calendar date) that starts ISO week {year, week}. */
export function isoWeekMonday({ year, week }) {
  const jan4 = Date.UTC(year, 0, 4);
  const jan4dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - jan4dow * DAY_MS + (week - 1) * 7 * DAY_MS;
}

/** Indian financial year: 1 April to 31 March. */
export function fyStartYearOfYmd(y, m) {
  return m >= 4 ? y : y - 1;
}
export const fyLabelFromStart = (start) => `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;
export function fyLabel(date, timeZone) {
  const p = localParts(date, timeZone);
  return p ? fyLabelFromStart(fyStartYearOfYmd(p.y, p.m)) : '';
}

const pad = (n) => String(n).padStart(2, '0');
export function formatDate(date, timeZone) {
  const p = localParts(date, timeZone);
  return p ? `${pad(p.d)}/${pad(p.m)}/${p.y}` : '';
}
export function formatDayMonth(date, timeZone) {
  const p = localParts(date, timeZone);
  return p ? `${pad(p.d)}/${pad(p.m)}` : '';
}
export function formatTime(date, timeZone) {
  const p = localParts(date, timeZone);
  return p ? `${pad(p.hh)}:${pad(p.mm)}` : '';
}
export const formatDateTime = (date, tz) => `${formatDate(date, tz)} ${formatTime(date, tz)}`;

/** Short, list-friendly: time today, "dd/mm" this year, "dd/mm/yyyy" otherwise. */
export function formatWhen(date, now = new Date(), timeZone) {
  const p = localParts(date, timeZone);
  const n = localParts(now, timeZone);
  if (!p || !n) return '';
  if (p.y === n.y && p.m === n.m && p.d === n.d) return `${pad(p.hh)}:${pad(p.mm)}`;
  if (p.y === n.y) return `${pad(p.d)}/${pad(p.m)}`;
  return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Parse a day-first date typed by the user: "28/10", "28/10/2026", "28-10-26".
 * Without a year, the most recent past occurrence is used (typing "28/12" in
 * January means last December). Returns {y,m,d} or {error}.
 */
export function parseDayFirst(text, today) {
  const s = String(text ?? '').trim();
  const m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s);
  if (!m) return { error: 'Type the date day first, like 28/10 or 28/10/2026.' };
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : today.y;
  if (m[3] && m[3].length === 2) y += 2000;
  if (mo < 1 || mo > 12) return { error: `Month ${mo} does not exist. Use day/month, like 28/10.` };
  if (d < 1 || d > daysInMonth(y, mo)) {
    return { error: `${pad(d)}/${pad(mo)}/${y} is not a real date${mo === 2 && d === 29 ? ' (not a leap year)' : ''}.` };
  }
  if (!m[3] && (mo > today.m || (mo === today.m && d > today.d))) {
    y -= 1;
    if (d > daysInMonth(y, mo)) return { error: `29/02/${y} is not a real date (not a leap year).` };
  }
  return { y, m: mo, d };
}

/** UTC instant of local midnight for a calendar date in a zone (for "since" filters). */
export function zonedMidnight({ y, m, d }, timeZone) {
  // Start from UTC midnight and correct by the zone's offset at that moment.
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess -= asUtc - Date.UTC(y, m - 1, d);
  }
  return guess;
}

export function plural(n, one, many = one + 's') {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------- video times

/** 75 -> "01:15", 3725 -> "1:02:05" (the YouTube style). */
export function mmss(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

/** Length for lists: "45 s", "12 min", "1 h 05 min". */
export function durationText(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (!s) return '';
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

/** Seconds as hours with one decimal, for budgets and totals: "7.5 h". */
export function hoursText(seconds) {
  const h = (Number(seconds) || 0) / 3600;
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10} h`;
}

/** Today's calendar date as YYYY-MM-DD in a zone (used for flashcard due dates). */
export function ymd(date = new Date(), timeZone) {
  const p = localParts(date, timeZone);
  return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : '';
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(dateYmd, days) {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}
