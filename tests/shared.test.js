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

test('buildHsDescription with Linear identifier uses [LIN-xxx] prefix', () => {
  const d = buildHsDescription({
    issueKey: 'LIN-1234',
    subject: 'Re: Népszínház 26. lemondás',
    customer: 'Tímea Kovács',
  });
  assert.strictEqual(d, '[LIN-1234] Re: Népszínház 26. lemondás — Tímea Kovács');
});

test('buildHsDescription without customer uses no trailing em-dash', () => {
  const d = buildHsDescription({
    issueKey: 'LIN-1234',
    subject: 'Test subject',
    customer: '',
  });
  assert.strictEqual(d, '[LIN-1234] Test subject');
});

test('buildHsDescription without subject falls back to HS ticket number', () => {
  const d = buildHsDescription({
    issueKey: 'LIN-1234',
    ticketNumber: '43152',
    subject: '',
    customer: 'Tímea Kovács',
  });
  assert.strictEqual(d, '[LIN-1234] HS #43152 — Tímea Kovács');
});

test('buildHsDescription HS-fallback (no issueKey): full info', () => {
  const d = buildHsDescription({
    issueKey: null,
    ticketNumber: '43152',
    subject: 'Re: Népszínház 26. lemondás',
    customer: 'Tímea Kovács',
  });
  assert.strictEqual(d, '[HS: #43152] Re: Népszínház 26. lemondás - Tímea Kovács');
});

test('buildHsDescription HS-fallback: missing subject/customer → prefix only', () => {
  assert.strictEqual(buildHsDescription({ issueKey: null, ticketNumber: '43152', subject: '', customer: '' }),
    '[HS: #43152]');
});

test('buildHsDescription HS-fallback: subject only', () => {
  assert.strictEqual(buildHsDescription({ issueKey: null, ticketNumber: '43152', subject: 'Foo', customer: '' }),
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

test('computeSnapTime: last entry ended 40 min ago → null', () => {
  const now = new Date('2026-04-21T11:00:00Z').getTime();
  const entries = [
    { timeInterval: { start: '2026-04-21T10:00:00Z', end: '2026-04-21T10:20:00Z' } },
  ];
  assert.strictEqual(computeSnapTime(entries, now), null);
});

test('computeSnapTime: last entry ended 20 min ago → snap ISO', () => {
  const now = new Date('2026-04-21T11:00:00Z').getTime();
  const entries = [
    { timeInterval: { start: '2026-04-21T10:00:00Z', end: '2026-04-21T10:40:00Z' } },
  ];
  assert.strictEqual(computeSnapTime(entries, now), '2026-04-21T10:40:00.000Z');
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

test('computeSnapTime: exactly 30 min gap → null (boundary exclusive)', () => {
  const now = new Date('2026-04-21T11:00:00Z').getTime();
  const entries = [
    { timeInterval: { start: '2026-04-21T10:00:00Z', end: '2026-04-21T10:30:00Z' } },
  ];
  assert.strictEqual(computeSnapTime(entries, now), null);
});

// ─── isOverlappingEntry ─────────────────────────────────────────────────────

const { isOverlappingEntry } = require('../shared.js');

function mkEntry(id, startISO, endISO) {
  return { id, timeInterval: { start: startISO, end: endISO } };
}

test('isOverlappingEntry: entry ended at new start (minute boundary) → no overlap', () => {
  const entry = mkEntry('e1', '2026-04-21T09:00:00Z', '2026-04-21T09:30:00Z');
  const nowMs = new Date('2026-04-21T10:00:00Z').getTime();
  const overlap = isOverlappingEntry(entry, '2026-04-21T09:30:00Z', '2026-04-21T10:00:00Z', nowMs, null);
  assert.strictEqual(overlap, false);
});

test('isOverlappingEntry: entry ended 09:30:27 (second precision) — new entry at 09:30 does NOT overlap (minute floor)', () => {
  const entry = mkEntry('e1', '2026-04-21T09:00:00Z', '2026-04-21T09:30:27Z');
  const nowMs = new Date('2026-04-21T10:00:00Z').getTime();
  const overlap = isOverlappingEntry(entry, '2026-04-21T09:30:00Z', '2026-04-21T10:00:00Z', nowMs, null);
  assert.strictEqual(overlap, false);
});

test('isOverlappingEntry: real overlap (entry 09:00-09:45, new 09:30-10:00)', () => {
  const entry = mkEntry('e1', '2026-04-21T09:00:00Z', '2026-04-21T09:45:00Z');
  const nowMs = new Date('2026-04-21T10:00:00Z').getTime();
  const overlap = isOverlappingEntry(entry, '2026-04-21T09:30:00Z', '2026-04-21T10:00:00Z', nowMs, null);
  assert.strictEqual(overlap, true);
});

test('isOverlappingEntry: new entry ends exactly at existing start (minute boundary) → no overlap', () => {
  const entry = mkEntry('e1', '2026-04-21T10:00:00Z', '2026-04-21T11:00:00Z');
  const nowMs = new Date('2026-04-21T12:00:00Z').getTime();
  const overlap = isOverlappingEntry(entry, '2026-04-21T09:00:00Z', '2026-04-21T10:00:00Z', nowMs, null);
  assert.strictEqual(overlap, false);
});

test('isOverlappingEntry: running entry (no end) — overlap if new range crosses its start time', () => {
  const entry = mkEntry('e1', '2026-04-21T09:00:00Z', null);
  const nowMs = new Date('2026-04-21T10:30:00Z').getTime();
  // New entry 09:30-10:00 overlaps with running timer (09:00 → now=10:30)
  const overlap = isOverlappingEntry(entry, '2026-04-21T09:30:00Z', '2026-04-21T10:00:00Z', nowMs, null);
  assert.strictEqual(overlap, true);
});

test('isOverlappingEntry: excludeId matches → not considered overlap (for editing self)', () => {
  const entry = mkEntry('e1', '2026-04-21T09:00:00Z', null);
  const nowMs = new Date('2026-04-21T10:30:00Z').getTime();
  const overlap = isOverlappingEntry(entry, '2026-04-21T08:00:00Z', '2026-04-21T11:00:00Z', nowMs, 'e1');
  assert.strictEqual(overlap, false);
});

test('isOverlappingEntry: excludeId different → entry IS considered', () => {
  const entry = mkEntry('e1', '2026-04-21T09:00:00Z', '2026-04-21T10:00:00Z');
  const nowMs = new Date('2026-04-21T11:00:00Z').getTime();
  const overlap = isOverlappingEntry(entry, '2026-04-21T08:00:00Z', '2026-04-21T09:30:00Z', nowMs, 'e2');
  assert.strictEqual(overlap, true);
});

// ─── canonicalizeHsUrl ──────────────────────────────────────────────────

const { canonicalizeHsUrl } = require('../shared.js');

test('canonicalizeHsUrl strips viewId query', () => {
  assert.strictEqual(
    canonicalizeHsUrl('https://secure.helpscout.net/conversation/3297862965/44477?viewId=8514301'),
    'https://secure.helpscout.net/conversation/3297862965/44477'
  );
});

test('canonicalizeHsUrl strips fragment and extra query params', () => {
  assert.strictEqual(
    canonicalizeHsUrl('https://secure.helpscout.net/conversation/3297862965/44477?viewId=1&foo=bar#thread-123'),
    'https://secure.helpscout.net/conversation/3297862965/44477'
  );
});

test('canonicalizeHsUrl preserves trailing slash if present', () => {
  assert.strictEqual(
    canonicalizeHsUrl('https://secure.helpscout.net/conversation/3297862965/44477/'),
    'https://secure.helpscout.net/conversation/3297862965/44477/'
  );
});

test('canonicalizeHsUrl returns null on invalid input', () => {
  assert.strictEqual(canonicalizeHsUrl(''), null);
  assert.strictEqual(canonicalizeHsUrl('not-a-url'), null);
  assert.strictEqual(canonicalizeHsUrl(null), null);
  assert.strictEqual(canonicalizeHsUrl(undefined), null);
});

// ─── parseHsEmailsFromDom ──────────────────────────────────────────────

const { parseHsEmailsFromDom } = require('../shared.js');

const EMAIL_SELECTOR = '[data-cy="Sidebar.CustomerEmails"] [data-testid="EmailList.EmailLink"]';

test('parseHsEmailsFromDom returns empty array when no emails list present', () => {
  const mockRoot = { querySelectorAll: () => [] };
  assert.deepStrictEqual(parseHsEmailsFromDom(mockRoot), []);
});

test('parseHsEmailsFromDom extracts single email', () => {
  const mockRoot = {
    querySelectorAll(selector) {
      if (selector === EMAIL_SELECTOR) {
        return [{
          querySelector: (s) =>
            s === '.c-Truncate__content' ? { textContent: 'user@example.com' } : null,
        }];
      }
      return [];
    },
  };
  assert.deepStrictEqual(parseHsEmailsFromDom(mockRoot), ['user@example.com']);
});

test('parseHsEmailsFromDom extracts multiple emails and trims', () => {
  const mk = (v) => ({
    querySelector: (s) => s === '.c-Truncate__content' ? { textContent: v } : null,
  });
  const mockRoot = {
    querySelectorAll(selector) {
      if (selector === EMAIL_SELECTOR) {
        return [mk('a@x.com'), mk(' b@y.hu '), mk('')];
      }
      return [];
    },
  };
  assert.deepStrictEqual(parseHsEmailsFromDom(mockRoot), ['a@x.com', 'b@y.hu']);
});

test('parseHsEmailsFromDom handles null/undefined root', () => {
  assert.deepStrictEqual(parseHsEmailsFromDom(null), []);
  assert.deepStrictEqual(parseHsEmailsFromDom(undefined), []);
});

// ─── parseHsCustomerIdFromDom ──────────────────────────────────────────

const { parseHsCustomerIdFromDom } = require('../shared.js');

test('parseHsCustomerIdFromDom extracts customer ID from first email link href', () => {
  const mockRoot = {
    querySelector(selector) {
      if (selector === EMAIL_SELECTOR) {
        return { getAttribute: (a) => a === 'href' ? '/mailbox/334555/customer/749159069/900659784' : null };
      }
      return null;
    },
  };
  assert.strictEqual(parseHsCustomerIdFromDom(mockRoot), '749159069');
});

test('parseHsCustomerIdFromDom returns null when no email link', () => {
  const mockRoot = { querySelector: () => null };
  assert.strictEqual(parseHsCustomerIdFromDom(mockRoot), null);
});

test('parseHsCustomerIdFromDom returns null on malformed href', () => {
  const mockRoot = {
    querySelector: () => ({ getAttribute: () => '/some/unrelated/path' }),
  };
  assert.strictEqual(parseHsCustomerIdFromDom(mockRoot), null);
});

test('parseHsCustomerIdFromDom handles null/undefined root', () => {
  assert.strictEqual(parseHsCustomerIdFromDom(null), null);
  assert.strictEqual(parseHsCustomerIdFromDom(undefined), null);
});

test('detectTimerSource: HS-sourced timers with [LIN-xxx] prefix are classified as linear — content script relies on activeTimer.source for HS identity', () => {
  // A HS-ből indított timer description-je [LIN-xxx] formátumú, de az
  // activeTimer.source = "hs" a chrome.storage.local-ban — a content script
  // annak alapján dönt, nem a description-ből. detectTimerSource-ot csak
  // külső (más-gépen indított) timerekre használjuk, ahol a linear
  // klasszifikáció elfogadható fallback.
  const detected = detectTimerSource('[LIN-1234] Re: subject — customer');
  assert.strictEqual(detected.source, 'linear');
  assert.strictEqual(detected.issueKey, 'LIN-1234');
  assert.strictEqual(detected.teamKey, 'LIN');
});

// ─── parseTeamKeyFromIssueKey ───────────────────────────────────────────

const { parseTeamKeyFromIssueKey } = require('../shared.js');

test('parseTeamKeyFromIssueKey extracts team key from valid issue key', () => {
  assert.strictEqual(parseTeamKeyFromIssueKey('TUL-14'), 'TUL');
  assert.strictEqual(parseTeamKeyFromIssueKey('IT-1'), 'IT');
  assert.strictEqual(parseTeamKeyFromIssueKey('GG-9999'), 'GG');
});

test('parseTeamKeyFromIssueKey returns null on missing or malformed input', () => {
  assert.strictEqual(parseTeamKeyFromIssueKey(''), null);
  assert.strictEqual(parseTeamKeyFromIssueKey(null), null);
  assert.strictEqual(parseTeamKeyFromIssueKey(undefined), null);
  assert.strictEqual(parseTeamKeyFromIssueKey('no-dash'), null);
  assert.strictEqual(parseTeamKeyFromIssueKey('-14'), null);
  assert.strictEqual(parseTeamKeyFromIssueKey('TUL-'), null);
  assert.strictEqual(parseTeamKeyFromIssueKey('TUL-abc'), null);
});

test('parseTeamKeyFromIssueKey handles lowercase team keys by uppercasing', () => {
  assert.strictEqual(parseTeamKeyFromIssueKey('tul-14'), 'TUL');
});
