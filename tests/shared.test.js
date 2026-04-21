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
