const test = require('node:test');
const assert = require('node:assert');
const {
  parseTimeInput,
  formatHM,
  todayStr,
  localTimeToISO,
  dayBoundsISO,
} = require('../shared.js');

test('parseTimeInput: colon format', () => {
  assert.deepStrictEqual(parseTimeInput('14:13'), { h: 14, m: 13 });
  assert.deepStrictEqual(parseTimeInput('9:05'), { h: 9, m: 5 });
});

test('parseTimeInput: 4-digit no colon', () => {
  assert.deepStrictEqual(parseTimeInput('1413'), { h: 14, m: 13 });
  assert.deepStrictEqual(parseTimeInput('0905'), { h: 9, m: 5 });
});

test('parseTimeInput: 3-digit no colon (single-digit hour)', () => {
  assert.deepStrictEqual(parseTimeInput('905'), { h: 9, m: 5 });
});

test('parseTimeInput: 1-2 digits = hour only', () => {
  assert.deepStrictEqual(parseTimeInput('9'), { h: 9, m: 0 });
  assert.deepStrictEqual(parseTimeInput('14'), { h: 14, m: 0 });
});

test('parseTimeInput: invalid values return null', () => {
  assert.strictEqual(parseTimeInput(''), null);
  assert.strictEqual(parseTimeInput('25:00'), null);
  assert.strictEqual(parseTimeInput('12:61'), null);
  assert.strictEqual(parseTimeInput('abc'), null);
  assert.strictEqual(parseTimeInput('12345'), null);
});

test('formatHM pads correctly', () => {
  assert.strictEqual(formatHM({ h: 9, m: 5 }), '09:05');
  assert.strictEqual(formatHM({ h: 23, m: 59 }), '23:59');
});

test('todayStr returns ISO date', () => {
  const s = todayStr();
  assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
});

test('localTimeToISO round-trips', () => {
  const iso = localTimeToISO('2026-04-21', 14, 13);
  const d = new Date(iso);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 3);
  assert.strictEqual(d.getDate(), 21);
  assert.strictEqual(d.getHours(), 14);
  assert.strictEqual(d.getMinutes(), 13);
});

test('dayBoundsISO returns midnight-midnight', () => {
  const { start, end } = dayBoundsISO('2026-04-21');
  const s = new Date(start);
  const e = new Date(end);
  assert.strictEqual(s.getHours(), 0);
  assert.strictEqual(s.getDate(), 21);
  assert.strictEqual(e.getDate(), 22);
});

// ─── HelpScout parsing ──────────────────────────────────────────────────

const { parseHsUrl, parseHsTitle, buildHsDescription } = require('../shared.js');

test('parseHsUrl: valid conversation URL', () => {
  const r = parseHsUrl('/conversation/3259965890/43152');
  assert.deepStrictEqual(r, { convId: '3259965890', ticketNumber: '43152' });
});

test('parseHsUrl: URL with viewId query is parsed from pathname only', () => {
  const r = parseHsUrl('/conversation/3259965890/43152');
  assert.ok(r);
  assert.strictEqual(r.ticketNumber, '43152');
});

test('parseHsUrl: non-conversation path', () => {
  assert.strictEqual(parseHsUrl('/inbox/8514303'), null);
  assert.strictEqual(parseHsUrl('/'), null);
  assert.strictEqual(parseHsUrl(''), null);
});

test('parseHsTitle: standard format', () => {
  const r = parseHsTitle('#43152 Re: Népszínház 26. lemondás - Tímea Kovács');
  assert.deepStrictEqual(r, {
    ticketNumber: '43152',
    subject: 'Re: Népszínház 26. lemondás',
    customer: 'Tímea Kovács',
  });
});

test('parseHsTitle: subject contains dashes — split on last " - "', () => {
  const r = parseHsTitle('#100 A - B - C - Customer Name');
  assert.deepStrictEqual(r, {
    ticketNumber: '100',
    subject: 'A - B - C',
    customer: 'Customer Name',
  });
});

test('parseHsTitle: no customer (no " - ")', () => {
  assert.strictEqual(parseHsTitle('#43152 Subject only'), null);
});

test('parseHsTitle: no # prefix', () => {
  assert.strictEqual(parseHsTitle('Random page title'), null);
});

test('buildHsDescription: full info', () => {
  const d = buildHsDescription({
    ticketNumber: '43152',
    subject: 'Re: Népszínház 26. lemondás',
    customer: 'Tímea Kovács',
  });
  assert.strictEqual(d, '[HS: #43152] Re: Népszínház 26. lemondás - Tímea Kovács');
});

test('buildHsDescription: missing subject/customer → prefix only', () => {
  assert.strictEqual(buildHsDescription({ ticketNumber: '43152', subject: '', customer: '' }),
    '[HS: #43152]');
});

test('buildHsDescription: subject only', () => {
  assert.strictEqual(buildHsDescription({ ticketNumber: '43152', subject: 'Foo', customer: '' }),
    '[HS: #43152] Foo');
});

// ─── detectTimerSource ──────────────────────────────────────────────────

const { detectTimerSource } = require('../shared.js');

test('detectTimerSource: Linear issue key', () => {
  assert.deepStrictEqual(detectTimerSource('[IT-123] Post booking automsg'), {
    source: 'linear',
    issueKey: 'IT-123',
    teamKey: 'IT',
    issueTitle: 'Post booking automsg',
  });
});

test('detectTimerSource: HS ticket', () => {
  assert.deepStrictEqual(detectTimerSource('[HS: #43152] Re: Népszínház 26. lemondás - Tímea Kovács'), {
    source: 'hs',
    ticketNumber: '43152',
    issueTitle: 'Re: Népszínház 26. lemondás - Tímea Kovács',
  });
});

test('detectTimerSource: HS without # (backward compat)', () => {
  const r = detectTimerSource('[HS: 43152] Subject - Customer');
  assert.strictEqual(r?.source, 'hs');
  assert.strictEqual(r?.ticketNumber, '43152');
});

test('detectTimerSource: unknown description', () => {
  assert.strictEqual(detectTimerSource('just some random text'), null);
  assert.strictEqual(detectTimerSource(''), null);
  assert.strictEqual(detectTimerSource(null), null);
});

// ─── computeSnapTime ────────────────────────────────────────────────

const { computeSnapTime } = require('../shared.js');

test('computeSnapTime: no entries → null', () => {
  assert.strictEqual(computeSnapTime([], Date.now()), null);
});

test('computeSnapTime: only running entries (no end) → null', () => {
  const entries = [{ timeInterval: { start: '2026-04-21T10:00:00Z', end: null } }];
  assert.strictEqual(computeSnapTime(entries, Date.now()), null);
});

test('computeSnapTime: last entry ended 5 min ago → snap ISO', () => {
  const now = new Date('2026-04-21T10:40:00Z').getTime();
  const entries = [
    { timeInterval: { start: '2026-04-21T10:00:00Z', end: '2026-04-21T10:35:00Z' } },
  ];
  assert.strictEqual(computeSnapTime(entries, now), '2026-04-21T10:35:00.000Z');
});

test('computeSnapTime: last entry ended 20 min ago → null', () => {
  const now = new Date('2026-04-21T11:00:00Z').getTime();
  const entries = [
    { timeInterval: { start: '2026-04-21T10:00:00Z', end: '2026-04-21T10:40:00Z' } },
  ];
  assert.strictEqual(computeSnapTime(entries, now), null);
});

test('computeSnapTime: picks the latest end across multiple entries', () => {
  const now = new Date('2026-04-21T10:40:00Z').getTime();
  const entries = [
    { timeInterval: { start: '2026-04-21T09:00:00Z', end: '2026-04-21T10:15:00Z' } },
    { timeInterval: { start: '2026-04-21T10:20:00Z', end: '2026-04-21T10:30:00Z' } },
    { timeInterval: { start: '2026-04-21T08:00:00Z', end: '2026-04-21T08:30:00Z' } },
  ];
  assert.strictEqual(computeSnapTime(entries, now), '2026-04-21T10:30:00.000Z');
});

test('computeSnapTime: end in the future → null (clock skew guard)', () => {
  const now = new Date('2026-04-21T10:00:00Z').getTime();
  const entries = [
    { timeInterval: { start: '2026-04-21T10:00:00Z', end: '2026-04-21T10:10:00Z' } },
  ];
  assert.strictEqual(computeSnapTime(entries, now), null);
});

test('computeSnapTime: exactly 15 min gap → null (boundary exclusive)', () => {
  const now = new Date('2026-04-21T10:45:00Z').getTime();
  const entries = [
    { timeInterval: { start: '2026-04-21T10:00:00Z', end: '2026-04-21T10:30:00Z' } },
  ];
  assert.strictEqual(computeSnapTime(entries, now), null);
});
