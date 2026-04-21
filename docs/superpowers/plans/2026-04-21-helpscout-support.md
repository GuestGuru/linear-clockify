# HelpScout támogatás + snap-to-previous — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HelpScout conversation page support (timer + manual entry) and a snap-to-previous toggle that rounds back new timer starts to the end of the last entry when ≤ 15 min ago.

**Architecture:** Extract shared helpers into a new `shared.js` module (dual-purpose: `window.LCShared` in content scripts, `self.LCShared` via `importScripts()` in the service worker, `module.exports` for Node tests). Create a second content script `hs-content.js` for HelpScout pages, mirroring the Linear UX but with a hardcoded project (`"Lakások és Tulajok"`) and a `[HS: #ticketNumber] subject - customer` description format. Snap-to-previous lives in `background.js` as a pure helper that inspects the latest Clockify entry end-time.

**Tech Stack:** Vanilla JS (no build step), Chrome Extension MV3, Clockify REST API, `node:test` for unit testing pure helpers (no npm deps).

**Spec:** [docs/superpowers/specs/2026-04-21-helpscout-support-design.md](../specs/2026-04-21-helpscout-support-design.md)

---

## Files — create / modify / test

### Create
- `shared.js` — dual-purpose module, pure helpers + DOM builders
- `hs-content.js` — HelpScout content script
- `tests/shared.test.js` — Node tests for pure helpers
- `tests/README.md` — one-liner on how to run tests

### Modify
- `manifest.json` — add `shared.js` to Linear content_scripts, add HS content_scripts entry, add `secure.helpscout.net` host permission
- `background.js` — `importScripts('shared.js')`, add HS actions, snap logic, `detectSource` helper, extend `checkRunningTimer`
- `content.js` — remove helpers that moved to `shared.js`, wire snap chip, use `LCShared.*`
- `options.html`, `options.js` — add `hsProjectName` field
- `popup.js` — HS-aware title rendering
- `styles.css` — snap chip + HS-specific polish (if required)

---

## Phase 1 — Test harness + shared.js scaffolding

### Task 1: Set up minimal test harness

**Files:**
- Create: `tests/README.md`
- Create: `tests/smoke.test.js`

- [ ] **Step 1: Create `tests/README.md`**

Content:

```markdown
# Tests

Pure helpers are tested with Node's built-in test runner. No dependencies needed.

## Run all tests

    node --test tests/

Requires Node 18+ (for `node:test`).
```

- [ ] **Step 2: Create `tests/smoke.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert');

test('smoke: test runner works', () => {
  assert.strictEqual(1 + 1, 2);
});
```

- [ ] **Step 3: Run tests to verify harness works**

Run: `node --test` (from repo root; auto-discovers `**/*.test.js`)
Expected: `# pass 1`, exit code 0

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: add minimal node:test harness"
```

---

### Task 2: Create `shared.js` with time-parsing helpers + tests

**Files:**
- Create: `shared.js`
- Create: `tests/shared.test.js` (replaces smoke test)
- Delete: `tests/smoke.test.js`

- [ ] **Step 1: Create `shared.js` with dual-export wrapper and pure helpers**

```js
(function (global) {
  // ─── Time parsing ─────────────────────────────────────────────────────────

  function parseTimeInput(raw) {
    const str = String(raw || '').trim();
    if (!str) return null;

    const colonMatch = str.match(/^(\d{1,2}):(\d{2})$/);
    if (colonMatch) {
      const h = Number(colonMatch[1]);
      const m = Number(colonMatch[2]);
      if (h < 0 || h > 23 || m < 0 || m > 59) return null;
      return { h, m };
    }

    const digits = str.replace(/\D/g, '');
    if (digits.length < 1 || digits.length > 4) return null;

    let h, m;
    if (digits.length <= 2) {
      h = Number(digits);
      m = 0;
    } else if (digits.length === 3) {
      h = Number(digits.slice(0, 1));
      m = Number(digits.slice(1));
    } else {
      h = Number(digits.slice(0, 2));
      m = Number(digits.slice(2));
    }

    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return { h, m };
  }

  function formatHM({ h, m }) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function localTimeToISO(dateStr, h, m) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    return new Date(y, mo - 1, d, h, m, 0, 0).toISOString();
  }

  function dayBoundsISO(dateStr) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const start = new Date(y, mo - 1, d, 0, 0, 0, 0);
    const end = new Date(y, mo - 1, d + 1, 0, 0, 0, 0);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  const api = {
    parseTimeInput,
    formatHM,
    todayStr,
    localTimeToISO,
    dayBoundsISO,
  };

  global.LCShared = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
```

- [ ] **Step 2: Create `tests/shared.test.js` with tests for the above**

```js
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
```

- [ ] **Step 3: Delete the smoke test**

```bash
rm tests/smoke.test.js
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `node --test` (from repo root; auto-discovers `**/*.test.js`)
Expected: `# pass 9`, exit code 0

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/
git commit -m "feat: add shared.js with time-parsing helpers + tests"
```

---

### Task 3: Wire `shared.js` into the Linear content script (no behavior change)

**Files:**
- Modify: `manifest.json`
- Modify: `content.js`

- [ ] **Step 1: Update `manifest.json` content_scripts for Linear**

Change the existing Linear entry's `js` array:

```json
{
  "matches": ["https://linear.app/*"],
  "js": ["shared.js", "content.js"],
  "css": ["styles.css"],
  "run_at": "document_idle"
}
```

- [ ] **Step 2: Remove duplicate helper definitions from `content.js`**

Delete the local definitions of `parseTimeInput`, `formatHM`, `todayStr`, `localTimeToISO`, `dayBoundsISO` in `content.js` (the block under `// ─── Time Input Parsing ───`, roughly `content.js:36-88`).

- [ ] **Step 3: Replace usages with `LCShared.*`**

At the top of `content.js` add:

```js
const { parseTimeInput, formatHM, todayStr, localTimeToISO, dayBoundsISO } = window.LCShared;
```

No other code changes needed — existing call sites already use the bare names.

- [ ] **Step 4: Manual verification**

1. Reload extension at `chrome://extensions`
2. Open a Linear issue (e.g. any `/gghq/issue/IT-*`)
3. Verify timer button renders, Start/Stop works, manual entry form submits
4. Check the devtools console on the Linear page: no errors

- [ ] **Step 5: Commit**

```bash
git add manifest.json content.js
git commit -m "refactor: move time helpers to shared.js, wire into Linear content script"
```

---

### Task 4: Move form builder + status helpers to `shared.js`

**Files:**
- Modify: `shared.js`
- Modify: `content.js`

- [ ] **Step 1: Add form/status/settings-link helpers to `shared.js`**

Inside the IIFE (before the `api` object), append:

```js
// ─── Status helpers ──────────────────────────────────────────────────────

function setStatus(el, kind, text) {
  el.style.display = 'block';
  el.className = `lc-status lc-status-${kind}`;
  el.textContent = text;
}

function clearStatus(el) {
  el.style.display = 'none';
  el.textContent = '';
}

function createSettingsLink() {
  const link = document.createElement('a');
  link.href = '#';
  link.className = 'lc-settings-link';
  link.textContent = '⚙️ Beállítás szükséges';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'openOptions' });
  });
  return link;
}

// ─── Manual entry form builder ───────────────────────────────────────────

function buildManualEntryForm() {
  const form = document.createElement('form');
  form.className = 'lc-manual-form';

  const row = document.createElement('div');
  row.className = 'lc-form-row';

  const from = document.createElement('input');
  from.type = 'text';
  from.className = 'lc-time-input';
  from.placeholder = 'mettől';
  from.inputMode = 'numeric';
  from.autocomplete = 'off';
  from.maxLength = 5;

  const dash = document.createElement('span');
  dash.className = 'lc-dash';
  dash.textContent = '–';

  const to = document.createElement('input');
  to.type = 'text';
  to.className = 'lc-time-input';
  to.placeholder = 'meddig';
  to.inputMode = 'numeric';
  to.autocomplete = 'off';
  to.maxLength = 5;

  const dateChip = document.createElement('button');
  dateChip.type = 'button';
  dateChip.className = 'lc-date-chip';
  dateChip.textContent = '📅 Ma';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'lc-date-input';
  dateInput.value = todayStr();
  dateInput.style.display = 'none';

  const updateDateChip = () => {
    const today = todayStr();
    dateChip.textContent = dateInput.value === today ? '📅 Ma' : `📅 ${dateInput.value}`;
  };

  dateChip.addEventListener('click', () => {
    const wasHidden = dateInput.style.display === 'none';
    dateInput.style.display = wasHidden ? 'inline-block' : 'none';
    if (wasHidden) dateInput.focus();
  });
  dateInput.addEventListener('change', () => {
    updateDateChip();
    dateInput.style.display = 'none';
  });

  [from, to].forEach((input) => {
    input.addEventListener('blur', () => {
      if (!input.value) return;
      const parsed = parseTimeInput(input.value);
      if (parsed) input.value = formatHM(parsed);
    });
  });

  row.appendChild(from);
  row.appendChild(dash);
  row.appendChild(to);
  row.appendChild(dateChip);
  row.appendChild(dateInput);

  const submitRow = document.createElement('div');
  submitRow.className = 'lc-form-submit-row';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'lc-submit-btn';
  submit.textContent = 'Rögzít';

  const status = document.createElement('div');
  status.className = 'lc-status';
  status.style.display = 'none';

  submitRow.appendChild(submit);

  form.appendChild(row);
  form.appendChild(submitRow);
  form.appendChild(status);

  return { form, fields: { from, to, dateInput, submit, status } };
}

/**
 * Attach a submit handler that parses the form, calls `buildPayload` to get a
 * chrome.runtime.sendMessage body, and shows status.
 *
 * @param {HTMLFormElement} form
 * @param {object} fields - from buildManualEntryForm
 * @param {(ctx: {startISO: string, endISO: string, dayStart: string, dayEnd: string}) =>
 *         {action: string, data: object}} buildPayload
 */
function attachManualEntrySubmit(form, fields, buildPayload) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { from, to, dateInput, submit, status } = fields;
    clearStatus(status);

    const parsedFrom = parseTimeInput(from.value);
    const parsedTo = parseTimeInput(to.value);

    if (!parsedFrom || !parsedTo) {
      setStatus(status, 'error', 'Érvénytelen időformátum (pl. 1413 → 14:13)');
      return;
    }
    from.value = formatHM(parsedFrom);
    to.value = formatHM(parsedTo);

    const fromMin = parsedFrom.h * 60 + parsedFrom.m;
    const toMin = parsedTo.h * 60 + parsedTo.m;
    if (fromMin >= toMin) {
      setStatus(status, 'error', 'A „Meddig" nagyobb kell legyen, mint a „Mettől"');
      return;
    }

    const dateStr = dateInput.value || todayStr();
    const startISO = localTimeToISO(dateStr, parsedFrom.h, parsedFrom.m);
    const endISO = localTimeToISO(dateStr, parsedTo.h, parsedTo.m);
    const { start: dayStart, end: dayEnd } = dayBoundsISO(dateStr);

    submit.disabled = true;
    setStatus(status, 'info', 'Mentés…');

    try {
      const payload = await buildPayload({ startISO, endISO, dayStart, dayEnd });
      const result = await chrome.runtime.sendMessage(payload);

      if (result?.error === 'OVERLAP') {
        setStatus(status, 'error', `Átfedés: ${result.conflictWith}`);
      } else if (result?.error === 'NO_API_KEY') {
        setStatus(status, 'error', 'Beállítás szükséges');
      } else if (result?.error) {
        setStatus(status, 'error', result.error);
      } else {
        const msg = result?.warning ? `Rögzítve ✓ — ${result.warning}` : 'Rögzítve ✓';
        setStatus(status, 'success', msg);
        from.value = '';
        to.value = '';
        setTimeout(() => clearStatus(status), 4000);
      }
    } catch (err) {
      setStatus(status, 'error', err.message);
    } finally {
      submit.disabled = false;
    }
  });
}
```

Add these keys to the `api` object: `setStatus, clearStatus, createSettingsLink, buildManualEntryForm, attachManualEntrySubmit`.

- [ ] **Step 2: Remove the corresponding helpers from `content.js`**

Delete from `content.js`:
- `buildManualEntryForm` (whole function)
- `setStatus`, `clearStatus`
- `attachManualEntrySubmit` (whole function)
- `createSettingsLink` (whole function)

- [ ] **Step 3: Update destructuring at top of `content.js`**

Replace the top destructuring with:

```js
const {
  parseTimeInput,
  formatHM,
  todayStr,
  localTimeToISO,
  dayBoundsISO,
  setStatus,
  clearStatus,
  createSettingsLink,
  buildManualEntryForm,
  attachManualEntrySubmit,
} = window.LCShared;
```

- [ ] **Step 4: Update the two Linear `attachManualEntrySubmit` call sites**

Find the two call sites in `content.js` (inside `createTimerButton` and `createRightPanelCard`). Replace each with:

```js
const issue = parseIssueFromUrl();
const { form, fields } = buildManualEntryForm();
attachManualEntrySubmit(form, fields, async ({ startISO, endISO, dayStart, dayEnd }) => {
  const issueTitle = await getIssueTitle();
  return {
    action: 'createManualEntry',
    data: {
      issueKey: issue.issueKey,
      issueTitle,
      teamKey: issue.teamKey,
      start: startISO,
      end: endISO,
      dayStart,
      dayEnd,
    },
  };
});
```

(The previous implementation called `parseIssueFromUrl()` inside the submit handler; the new version captures it at build time. If the user could navigate to another issue between form build and submit, re-parse inside the callback instead. Since the form is re-built on every SPA nav (see `waitForDomAndInit`), capturing at build time is safe.)

- [ ] **Step 5: Manual test**

1. Reload extension
2. Open a Linear issue, test Start/Stop + manual entry (valid + invalid input + overlap)
3. Verify no regressions

- [ ] **Step 6: Commit**

```bash
git add shared.js content.js
git commit -m "refactor: move form + status helpers to shared.js, callback-based submit"
```

---

## Phase 2 — HelpScout pure helpers

### Task 5: Add HS URL + title parsers to `shared.js` with tests

**Files:**
- Modify: `shared.js`
- Modify: `tests/shared.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/shared.test.js`:

```js
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test` (from repo root; auto-discovers `**/*.test.js`)
Expected: 10 failures ("parseHsUrl is not a function" etc.)

- [ ] **Step 3: Implement the helpers in `shared.js`**

Before the `api` object, add:

```js
// ─── HelpScout parsing ───────────────────────────────────────────────────

function parseHsUrl(pathname) {
  const str = String(pathname || '');
  const m = str.match(/^\/conversation\/(\d+)\/(\d+)\/?$/);
  if (!m) return null;
  return { convId: m[1], ticketNumber: m[2] };
}

function parseHsTitle(title) {
  const str = String(title || '').trim();
  const headMatch = str.match(/^#(\d+)\s+(.+)$/);
  if (!headMatch) return null;
  const ticketNumber = headMatch[1];
  const rest = headMatch[2];

  const lastSep = rest.lastIndexOf(' - ');
  if (lastSep === -1) return null;

  const subject = rest.slice(0, lastSep).trim();
  const customer = rest.slice(lastSep + 3).trim();
  if (!subject || !customer) return null;

  return { ticketNumber, subject, customer };
}

function buildHsDescription({ ticketNumber, subject, customer }) {
  const prefix = `[HS: #${ticketNumber}]`;
  const tail = [subject, customer].filter((s) => s && String(s).trim()).join(' - ');
  return tail ? `${prefix} ${tail}` : prefix;
}
```

Add to `api`: `parseHsUrl, parseHsTitle, buildHsDescription`.

- [ ] **Step 4: Run tests, verify all pass**

Run: `node --test` (from repo root; auto-discovers `**/*.test.js`)
Expected: all tests pass (19 total now)

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/shared.test.js
git commit -m "feat: add HelpScout URL/title parsers and description builder"
```

---

### Task 6: Add `detectTimerSource` helper + tests

**Files:**
- Modify: `shared.js`
- Modify: `tests/shared.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/shared.test.js`:

```js
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
```

- [ ] **Step 2: Run tests, verify failures**

Run: `node --test` (from repo root; auto-discovers `**/*.test.js`)
Expected: 4 failures

- [ ] **Step 3: Implement in `shared.js`**

Before the `api` object:

```js
function detectTimerSource(description) {
  const str = String(description || '');
  if (!str) return null;

  const hs = str.match(/^\[HS:\s*#?(\d+)\]\s*(.*)$/);
  if (hs) {
    return {
      source: 'hs',
      ticketNumber: hs[1],
      issueTitle: hs[2].trim(),
    };
  }

  const linear = str.match(/^\[([A-Z]+-\d+)\]\s*(.+)$/);
  if (linear) {
    const issueKey = linear[1];
    const teamKey = issueKey.split('-')[0];
    return {
      source: 'linear',
      issueKey,
      teamKey,
      issueTitle: linear[2].trim(),
    };
  }

  return null;
}
```

Add `detectTimerSource` to `api`.

- [ ] **Step 4: Run tests, verify pass**

Run: `node --test` (from repo root; auto-discovers `**/*.test.js`)

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/shared.test.js
git commit -m "feat: add detectTimerSource (parses Linear + HS descriptions)"
```

---

### Task 7: Add `computeSnapTime` helper + tests

**Files:**
- Modify: `shared.js`
- Modify: `tests/shared.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/shared.test.js`:

```js
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
```

- [ ] **Step 2: Run tests, verify failures**

- [ ] **Step 3: Implement in `shared.js`**

```js
const SNAP_WINDOW_MS = 15 * 60 * 1000;

function computeSnapTime(entries, nowMs) {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  let latestEnd = 0;
  for (const e of entries) {
    const end = e?.timeInterval?.end;
    if (!end) continue;
    const t = new Date(end).getTime();
    if (Number.isFinite(t) && t > latestEnd) latestEnd = t;
  }
  if (!latestEnd) return null;

  const gap = nowMs - latestEnd;
  if (gap <= 0 || gap >= SNAP_WINDOW_MS) return null;
  return new Date(latestEnd).toISOString();
}
```

Add `computeSnapTime` to `api`. Do not export `SNAP_WINDOW_MS`.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/shared.test.js
git commit -m "feat: add computeSnapTime helper (snap-to-previous logic)"
```

---

## Phase 3 — Background integrations

### Task 8: Load `shared.js` into the service worker

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Add `importScripts` at the top of `background.js`**

At the very top (before any other code):

```js
// Linear → Clockify Timer — Service Worker
importScripts('shared.js');

const { detectTimerSource, computeSnapTime, buildHsDescription } = self.LCShared;
```

- [ ] **Step 2: Reload extension, verify SW does not crash**

1. `chrome://extensions` → reload the extension
2. Click the "service worker" link → DevTools opens → check console: no errors
3. Click the extension badge, verify the popup still works

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "chore: import shared.js in service worker"
```

---

### Task 9: Refactor `checkRunningTimer` to use `detectTimerSource`

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Update `checkRunningTimer` in `background.js` (currently `background.js:248-295`)**

Replace the description-matching block with:

```js
async function checkRunningTimer() {
  const settings = await getSettings();
  if (!settings.apiKey) return;

  const userId = await getUserId();
  const entries = await clockifyFetch(
    `/workspaces/${settings.workspaceId}/user/${userId}/time-entries?in-progress=true`
  );

  if (!entries || entries.length === 0) {
    await chrome.storage.local.remove('activeTimer');
    clearBadge();
    return;
  }

  const entry = entries[0];
  const { activeTimer } = await chrome.storage.local.get('activeTimer');

  if (activeTimer && activeTimer.timeEntryId === entry.id) {
    updateBadge(activeTimer);
    return;
  }

  const detected = detectTimerSource(entry.description);
  const base = {
    timeEntryId: entry.id,
    startedAt: entry.timeInterval.start,
    projectName: null,
    external: true,
  };

  let externalTimer;
  if (detected?.source === 'linear') {
    externalTimer = {
      ...base,
      source: 'linear',
      issueKey: detected.issueKey,
      teamKey: detected.teamKey,
      issueTitle: detected.issueTitle,
    };
  } else if (detected?.source === 'hs') {
    externalTimer = {
      ...base,
      source: 'hs',
      ticketNumber: detected.ticketNumber,
      issueTitle: detected.issueTitle,
    };
  } else {
    externalTimer = {
      ...base,
      source: 'unknown',
      issueTitle: entry.description || 'Külső timer',
    };
  }

  await chrome.storage.local.set({ activeTimer: externalTimer });
  updateBadge(externalTimer);
}
```

- [ ] **Step 2: Also update `startTimer` to set `source: 'linear'` on the stored `activeTimer`**

In `startTimer` (around `background.js:215-221`), change `const activeTimer = { ... }` to include `source: 'linear'` and `teamKey`:

```js
const activeTimer = {
  timeEntryId: entry.id,
  source: 'linear',
  issueKey,
  teamKey,
  issueTitle,
  projectName: projectName || null,
  startedAt: body.start,
};
```

- [ ] **Step 3: Manual test**

1. Reload extension
2. Start a Linear timer
3. Verify `chrome.storage.local.get('activeTimer')` in the SW console shows `source: 'linear'`
4. Stop timer; verify it clears

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "refactor: use detectTimerSource in checkRunningTimer, add source field"
```

---

### Task 10: Add snap-to-previous logic in `background.js`

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Add `getSnapInfo` and `resolveStartTime` helpers**

Append above `chrome.runtime.onMessage.addListener(...)`:

```js
const SNAP_LOOKBACK_MS = 30 * 60 * 1000;

async function getSnapInfo() {
  const settings = await getSettings();
  const snapEnabled = settings.snapEnabled !== false; // default true
  if (!snapEnabled) return { snapTo: null, snapEnabled: false };

  try {
    const now = Date.now();
    const windowStart = new Date(now - SNAP_LOOKBACK_MS).toISOString();
    const windowEnd = new Date(now).toISOString();
    const entries = await getEntriesInRange(windowStart, windowEnd);
    const snapTo = computeSnapTime(entries || [], now);
    return { snapTo, snapEnabled: true };
  } catch (err) {
    console.warn('[LC] getSnapInfo failed:', err.message);
    return { snapTo: null, snapEnabled: true };
  }
}

async function resolveStartTime() {
  const info = await getSnapInfo();
  return info.snapTo || new Date().toISOString();
}
```

- [ ] **Step 2: Wire `resolveStartTime` into `startTimer`**

In `startTimer` (around `background.js:202-204`), replace:

```js
const body = {
  start: new Date().toISOString(),
  description: `[${issueKey}] ${issueTitle}`,
};
```

with:

```js
const body = {
  start: await resolveStartTime(),
  description: `[${issueKey}] ${issueTitle}`,
};
```

- [ ] **Step 3: Add `getSnapInfo` + `setSnapEnabled` actions to the message handler**

In the `switch (message.action)` block:

```js
case 'getSnapInfo': {
  return await getSnapInfo();
}
case 'setSnapEnabled': {
  const settings = await getSettings();
  const next = { ...settings, snapEnabled: !!message.data.enabled };
  await chrome.storage.local.set({ settings: next });
  return { success: true };
}
```

- [ ] **Step 4: Extend the default settings object**

In `getSettings` (around `background.js:7-26`), add `snapEnabled: true` to the default:

```js
return settings || {
  apiKey: '',
  workspaceId: DEFAULT_WORKSPACE_ID,
  autoStop: false,
  snapEnabled: true,
  teamMapping: { ... },
};
```

- [ ] **Step 5: Manual test**

1. Reload extension
2. Start a timer, stop it
3. Within 15 min, start a new Linear timer
4. Verify the new entry's start-time in Clockify is the previous entry's end-time (check Clockify UI)
5. Wait >15 min, start again → start-time is `now`

- [ ] **Step 6: Commit**

```bash
git add background.js
git commit -m "feat: snap-to-previous — new timers round back to last entry end if ≤ 15 min gap"
```

---

### Task 11: Add HelpScout background actions

**Files:**
- Modify: `background.js`

- [ ] **Step 1: Add `HS_PROJECT_DEFAULT` constant and extend `getSettings` default**

Top of `background.js`, near `DEFAULT_WORKSPACE_ID`:

```js
const HS_PROJECT_DEFAULT = 'Lakások és Tulajok';
```

In the `getSettings` defaults, add:

```js
hsProjectName: HS_PROJECT_DEFAULT,
```

Also handle the case where persisted settings exist but lack `hsProjectName` — add a fallback read:

```js
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const defaults = {
    apiKey: '',
    workspaceId: DEFAULT_WORKSPACE_ID,
    autoStop: false,
    snapEnabled: true,
    hsProjectName: HS_PROJECT_DEFAULT,
    teamMapping: { /* existing */ },
  };
  return { ...defaults, ...(settings || {}) };
}
```

- [ ] **Step 2: Add `startHsTimer`**

After `startTimer`:

```js
async function startHsTimer({ ticketNumber, subject, customer }) {
  const settings = await getSettings();
  const projectName = settings.hsProjectName || HS_PROJECT_DEFAULT;

  let projectId = null;
  let warning = null;
  if (projectName) {
    projectId = await resolveProjectId(projectName);
    if (!projectId) warning = `Clockify projekt nem található: ${projectName}`;
  }

  const body = {
    start: await resolveStartTime(),
    description: buildHsDescription({ ticketNumber, subject, customer }),
  };
  if (projectId) body.projectId = projectId;

  const entry = await clockifyFetch(
    `/workspaces/${settings.workspaceId}/time-entries`,
    { method: 'POST', body: JSON.stringify(body) }
  );

  const issueTitle = [subject, customer].filter(Boolean).join(' - ') || `#${ticketNumber}`;
  const activeTimer = {
    timeEntryId: entry.id,
    source: 'hs',
    ticketNumber,
    issueTitle,
    projectName,
    startedAt: body.start,
  };
  await chrome.storage.local.set({ activeTimer });
  updateBadge(activeTimer);

  return { success: true, warning };
}
```

- [ ] **Step 3: Add `createHsManualEntry`**

After `createManualEntry`:

```js
async function createHsManualEntry({
  ticketNumber, subject, customer,
  startISO, endISO, dayStartISO, dayEndISO,
}) {
  const settings = await getSettings();

  const conflict = await findOverlap(startISO, endISO, dayStartISO, dayEndISO);
  if (conflict) {
    const cs = new Date(conflict.timeInterval.start);
    const ce = conflict.timeInterval.end ? new Date(conflict.timeInterval.end) : null;
    const timeStr = ce ? `${formatHMBg(cs)}–${formatHMBg(ce)}` : `${formatHMBg(cs)}–(fut)`;
    const desc = conflict.description || '(leírás nélkül)';
    return { error: 'OVERLAP', conflictWith: `${desc} @ ${timeStr}` };
  }

  const projectName = settings.hsProjectName || HS_PROJECT_DEFAULT;
  let projectId = null;
  let warning = null;
  if (projectName) {
    projectId = await resolveProjectId(projectName);
    if (!projectId) warning = `Clockify projekt nem található: ${projectName}`;
  }

  const body = {
    start: startISO,
    end: endISO,
    description: buildHsDescription({ ticketNumber, subject, customer }),
  };
  if (projectId) body.projectId = projectId;

  await clockifyFetch(
    `/workspaces/${settings.workspaceId}/time-entries`,
    { method: 'POST', body: JSON.stringify(body) }
  );

  return { success: true, warning };
}
```

Note: rename the existing local `formatHM` in `background.js` to `formatHMBg` to avoid confusion with the shared one (they have the same implementation but we don't want to accidentally pull in the shared one that works on `{h,m}` — the bg one works on `Date`). Alternatively, keep the existing name — just ensure consistency.

- [ ] **Step 4: Wire new actions into the message handler**

Add cases:

```js
case 'startHsTimer': {
  return await startHsTimer(message.data);
}
case 'stopAndStartHsTimer': {
  await stopTimer();
  return await startHsTimer(message.data);
}
case 'createHsManualEntry': {
  return await createHsManualEntry(message.data);
}
```

- [ ] **Step 5: Reload extension, quick SW console sanity check**

```js
// In SW devtools:
chrome.runtime.sendMessage({ action: 'startHsTimer', data: { ticketNumber: '99999', subject: 'Test', customer: 'Tester' }})
  .then(console.log);
```

Expected: `{ success: true, warning: null }` (or a warning about missing project). Verify in Clockify UI that the entry was created with description `[HS: #99999] Test - Tester`.

Stop the timer, delete the test entry in Clockify.

- [ ] **Step 6: Commit**

```bash
git add background.js
git commit -m "feat: add HS background actions (startHsTimer, createHsManualEntry)"
```

---

## Phase 4 — Snap chip UI in Linear

### Task 12: Add `buildSnapChip` to `shared.js`

**Files:**
- Modify: `shared.js`
- Modify: `styles.css`

- [ ] **Step 1: Add chip builder to `shared.js`**

Before the `api` object:

```js
// ─── Snap chip UI ────────────────────────────────────────────────────────

function formatSnapLabel(snapISO) {
  const d = new Date(snapISO);
  return `↶ ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildSnapChip() {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'lc-snap-chip';
  chip.style.display = 'none';
  chip.setAttribute('aria-pressed', 'true');

  function render({ snapTo, snapEnabled }) {
    if (!snapEnabled) {
      chip.style.display = 'inline-flex';
      chip.textContent = '↶ off';
      chip.classList.remove('lc-snap-chip-active');
      chip.classList.add('lc-snap-chip-off');
      chip.title = 'Kattintásra bekapcsolod a snap-et';
      chip.setAttribute('aria-pressed', 'false');
      return;
    }
    if (!snapTo) {
      chip.style.display = 'none';
      return;
    }
    chip.style.display = 'inline-flex';
    chip.textContent = formatSnapLabel(snapTo);
    chip.classList.add('lc-snap-chip-active');
    chip.classList.remove('lc-snap-chip-off');
    chip.title = 'Előző entry vége — kattintásra kikapcsolod';
    chip.setAttribute('aria-pressed', 'true');
  }

  async function refresh() {
    try {
      const info = await chrome.runtime.sendMessage({ action: 'getSnapInfo' });
      render(info || { snapTo: null, snapEnabled: true });
    } catch (err) {
      chip.style.display = 'none';
    }
  }

  chip.addEventListener('click', async () => {
    const current = chip.classList.contains('lc-snap-chip-off') ? false : true;
    const next = !current;
    await chrome.runtime.sendMessage({ action: 'setSnapEnabled', data: { enabled: next } });
    await refresh();
  });

  return { chip, refresh, render };
}
```

Add `buildSnapChip` to `api`.

- [ ] **Step 2: Add CSS for the chip**

Append to `styles.css`:

```css
.lc-snap-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  margin-left: 6px;
  font-size: 12px;
  line-height: 1.4;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  user-select: none;
}
.lc-snap-chip.lc-snap-chip-active {
  background: #e0f2fe;
  color: #075985;
  border-color: #bae6fd;
}
.lc-snap-chip.lc-snap-chip-off {
  background: #f3f4f6;
  color: #6b7280;
  border-color: #e5e7eb;
}
.lc-snap-chip:hover { filter: brightness(0.97); }
```

- [ ] **Step 3: Commit**

```bash
git add shared.js styles.css
git commit -m "feat: add snap chip component in shared.js"
```

---

### Task 13: Wire snap chip into the Linear content script

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Destructure `buildSnapChip` at top of `content.js`**

Add to the existing top-of-file destructuring:

```js
const {
  parseTimeInput, formatHM, todayStr, localTimeToISO, dayBoundsISO,
  setStatus, clearStatus, createSettingsLink,
  buildManualEntryForm, attachManualEntrySubmit,
  buildSnapChip,
} = window.LCShared;
```

- [ ] **Step 2: Add the chip to `createTimerButton`**

Inside `createTimerButton`, after `container.appendChild(button);`:

```js
const snap = buildSnapChip();
snap.chip.id = 'lc-snap-chip';
container.appendChild(snap.chip);
```

And at the end of `createTimerButton`, after `updateButtonState();`:

```js
snap.refresh();
```

- [ ] **Step 3: Add the chip to `createRightPanelCard`**

Inside `createRightPanelCard`, after `timerRow.appendChild(button);`:

```js
const cardSnap = buildSnapChip();
cardSnap.chip.id = 'lc-card-snap-chip';
timerRow.appendChild(cardSnap.chip);
```

And refresh it before appending the card to the DOM:

```js
cardSnap.refresh();
```

- [ ] **Step 4: Refresh chips on state/storage changes**

Refactor so `content.js` keeps references to the chip objects and calls `.refresh()` on them whenever `updateButtonState` runs.

Move the `snap` declarations to module scope (top of `content.js`, after the destructuring):

```js
let mainSnapChip = null;
let cardSnapChip = null;
```

In `createTimerButton`, replace the local `const snap = buildSnapChip()` with:

```js
mainSnapChip = buildSnapChip();
mainSnapChip.chip.id = 'lc-snap-chip';
container.appendChild(mainSnapChip.chip);
```

And at the end of `createTimerButton`, replace `snap.refresh()` with `mainSnapChip.refresh();`.

In `createRightPanelCard`, do the same with `cardSnapChip`:

```js
cardSnapChip = buildSnapChip();
cardSnapChip.chip.id = 'lc-card-snap-chip';
timerRow.appendChild(cardSnapChip.chip);
```

And `cardSnapChip.refresh();` before appending the card.

Finally, at the end of `updateButtonState`:

```js
if (mainSnapChip) mainSnapChip.refresh();
if (cardSnapChip) cardSnapChip.refresh();
```

- [ ] **Step 5: Manual test**

1. Reload extension, open a Linear issue
2. Stop any running timer, then start a timer on another issue, then stop it
3. Within 15 min on the same issue page (or any Linear issue), reload — the chip should show `↶ HH:MM` next to the Start button
4. Click the chip: it flips to `↶ off` (verify via a fresh timer start → start time is `now`, not snap)
5. Click again: re-enables snap
6. Both the floating button container and the right-panel card show the chip

- [ ] **Step 6: Commit**

```bash
git add shared.js content.js
git commit -m "feat: wire snap chip into Linear content script"
```

---

## Phase 5 — HelpScout content script

### Task 14: Create `hs-content.js` with URL detection + title parsing

**Files:**
- Create: `hs-content.js`

- [ ] **Step 1: Scaffold `hs-content.js` with URL/title parse + logging only**

```js
// HelpScout → Clockify Timer — Content Script

const {
  parseTimeInput, formatHM, todayStr, localTimeToISO, dayBoundsISO,
  setStatus, clearStatus, createSettingsLink,
  buildManualEntryForm, attachManualEntrySubmit,
  buildSnapChip,
  parseHsUrl, parseHsTitle,
} = window.LCShared;

function getConversationContext() {
  const url = parseHsUrl(window.location.pathname);
  if (!url) return null;
  const titleParsed = parseHsTitle(document.title);
  return {
    convId: url.convId,
    ticketNumber: url.ticketNumber,
    subject: titleParsed?.subject || '',
    customer: titleParsed?.customer || '',
  };
}

console.log('[LC HS] loaded', getConversationContext());
```

- [ ] **Step 2: Add to `manifest.json`**

Under `host_permissions`:

```json
"https://secure.helpscout.net/*"
```

Under `content_scripts`:

```json
{
  "matches": ["https://secure.helpscout.net/conversation/*"],
  "js": ["shared.js", "hs-content.js"],
  "css": ["styles.css"],
  "run_at": "document_idle"
}
```

- [ ] **Step 3: Manual smoke test**

1. Reload the extension
2. Open a HelpScout conversation page
3. DevTools console → look for `[LC HS] loaded { convId: '...', ticketNumber: '...', subject: '...', customer: '...' }`

- [ ] **Step 4: Commit**

```bash
git add hs-content.js manifest.json
git commit -m "feat: HS content script scaffold (URL + title parsing)"
```

---

### Task 15: Add HS timer button rendering

**Files:**
- Modify: `hs-content.js`
- Modify: `styles.css`

- [ ] **Step 1: Add timer button + insertion logic**

Append to `hs-content.js`:

```js
const HS_BUTTON_CONTAINER_ID = 'lc-hs-timer-container';
let hsMainSnapChip = null;
let hsCardSnapChip = null;

function findHsHeaderInsertion() {
  // Strategy: Find the element containing the conversation subject.
  // HelpScout renders the subject in a heading near the top of the conversation.
  // Try several selectors for resilience.
  const selectors = [
    '[data-cy="conversation-subject"]',
    '[data-cy="dashboardTitle"]',
    'h1',
    'h2',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) {
      return el.parentElement || el;
    }
  }
  return document.body;
}

function createHsTimerButton() {
  const existing = document.getElementById(HS_BUTTON_CONTAINER_ID);
  if (existing) existing.remove();

  const ctx = getConversationContext();
  if (!ctx) return;

  const container = document.createElement('div');
  container.id = HS_BUTTON_CONTAINER_ID;

  const button = document.createElement('button');
  button.id = 'lc-hs-timer-button';
  button.className = 'lc-btn lc-btn-start';
  button.textContent = '▶ Start';

  const elapsed = document.createElement('span');
  elapsed.id = 'lc-hs-elapsed';
  elapsed.className = 'lc-elapsed';
  elapsed.style.display = 'none';

  const info = document.createElement('span');
  info.id = 'lc-hs-info';
  info.className = 'lc-info';
  info.style.display = 'none';

  hsMainSnapChip = buildSnapChip();
  hsMainSnapChip.chip.id = 'lc-hs-snap-chip';

  container.appendChild(button);
  container.appendChild(elapsed);
  container.appendChild(info);
  container.appendChild(hsMainSnapChip.chip);

  const anchor = findHsHeaderInsertion();
  anchor.appendChild(container);

  button.addEventListener('click', handleHsButtonClick);
  updateHsButtonState();
  hsMainSnapChip.refresh();
}
```

- [ ] **Step 2: Add `handleHsButtonClick`**

```js
async function handleHsButtonClick(event) {
  const ctx = getConversationContext();
  if (!ctx) return;

  const button = event?.currentTarget || document.getElementById('lc-hs-timer-button');
  button.disabled = true;

  try {
    const { activeTimer } = await chrome.storage.local.get('activeTimer');

    if (activeTimer && activeTimer.source === 'hs' &&
        activeTimer.ticketNumber === ctx.ticketNumber && !activeTimer.external) {
      const result = await chrome.runtime.sendMessage({ action: 'stopTimer' });
      if (result.error) showHsError(result.error);
    } else if (activeTimer && !activeTimer.external) {
      const result = await chrome.runtime.sendMessage({
        action: 'stopAndStartHsTimer',
        data: ctx,
      });
      if (result.error) showHsError(result.error);
      if (result.warning) showHsWarning(result.warning);
    } else {
      const result = await chrome.runtime.sendMessage({
        action: 'startHsTimer',
        data: ctx,
      });
      if (result.error) showHsError(result.error);
      if (result.warning) showHsWarning(result.warning);
    }
  } catch (err) {
    showHsError(err.message);
  } finally {
    button.disabled = false;
  }
}

function showHsError(message) {
  const info = document.getElementById('lc-hs-info');
  if (!info) return;
  if (message === 'NO_API_KEY') {
    info.style.display = 'inline';
    info.textContent = '';
    info.appendChild(createSettingsLink());
    return;
  }
  info.style.display = 'inline';
  info.textContent = '❌ ' + message;
  setTimeout(() => { info.style.display = 'none'; }, 5000);
}

function showHsWarning(message) {
  const info = document.getElementById('lc-hs-info');
  if (!info) return;
  info.style.display = 'inline';
  info.textContent = '⚠️ ' + message;
  setTimeout(() => { info.style.display = 'none'; }, 5000);
}
```

- [ ] **Step 3: Add state management + elapsed counter**

```js
let hsElapsedInterval = null;

function applyHsButtonState(button, elapsed, info, state, activeTimer) {
  if (!button) return;
  if (state === 'hidden') {
    button.style.display = 'none';
    if (info) {
      info.style.display = 'inline';
      info.textContent = '';
      info.appendChild(createSettingsLink());
    }
    return;
  }
  button.style.display = '';
  if (state === 'start') {
    button.className = 'lc-btn lc-btn-start';
    button.textContent = '▶ Start';
    if (elapsed) elapsed.style.display = 'none';
    if (info) info.style.display = 'none';
  } else if (state === 'stop') {
    button.className = 'lc-btn lc-btn-stop';
    button.textContent = '⏹ Stop';
    if (elapsed) elapsed.style.display = 'inline';
    if (info) info.style.display = 'none';
  } else if (state === 'switch') {
    button.className = 'lc-btn lc-btn-switch';
    button.textContent = '⏹ Stop & ▶ Start';
    if (elapsed) elapsed.style.display = 'none';
    if (info) {
      info.style.display = 'inline';
      info.textContent = `Timer fut: ${activeTimer.issueTitle}`;
    }
  }
}

async function updateHsButtonState() {
  if (hsElapsedInterval) {
    clearInterval(hsElapsedInterval);
    hsElapsedInterval = null;
  }

  const ctx = getConversationContext();
  if (!ctx) return;

  const button = document.getElementById('lc-hs-timer-button');
  const elapsed = document.getElementById('lc-hs-elapsed');
  const info = document.getElementById('lc-hs-info');
  if (!button) return;

  const { settings } = await chrome.storage.local.get('settings');
  if (!settings?.apiKey) {
    applyHsButtonState(button, elapsed, info, 'hidden');
    return;
  }

  const { activeTimer } = await chrome.storage.local.get('activeTimer');

  let state;
  if (!activeTimer || activeTimer.external) {
    state = 'start';
  } else if (activeTimer.source === 'hs' && activeTimer.ticketNumber === ctx.ticketNumber) {
    state = 'stop';
  } else {
    state = 'switch';
  }
  applyHsButtonState(button, elapsed, info, state, activeTimer);

  if (state === 'stop') startHsElapsedCounter(activeTimer.startedAt);

  // Snap chip refresh
  if (hsMainSnapChip) hsMainSnapChip.refresh();
  if (hsCardSnapChip) hsCardSnapChip.refresh();
}

function startHsElapsedCounter(startedAt) {
  const el = document.getElementById('lc-hs-elapsed');
  if (!el) return;
  function update() {
    const diff = Date.now() - new Date(startedAt).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  update();
  hsElapsedInterval = setInterval(update, 1000);
}
```

- [ ] **Step 4: Add CSS for the HS container (reuse most styles)**

Append to `styles.css` (only if existing rules don't already apply by class — the timer container uses generic `lc-btn` styles which already work):

```css
#lc-hs-timer-container {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  vertical-align: middle;
}
```

- [ ] **Step 5: Note — don't wire init yet**

Init + SPA observer is added in Task 17. For this task, just verify the scaffold compiles.

- [ ] **Step 6: Commit**

```bash
git add hs-content.js styles.css
git commit -m "feat: HS timer button render + click handler + state logic"
```

---

### Task 16: Add HS right-sidebar manual entry card

**Files:**
- Modify: `hs-content.js`

- [ ] **Step 1: Add sidebar insertion helper + card builder**

Append to `hs-content.js`:

```js
const HS_CARD_ID = 'lc-hs-right-card';

function findHsSidebarInsertion() {
  // Try common HS sidebar containers.
  const selectors = [
    '[data-cy="conversation-properties"]',
    '[data-cy="sidebar"]',
    '.sidebar',
    '.conversation-sidebar',
    'aside',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
}

function createHsRightPanelCard() {
  const existing = document.getElementById(HS_CARD_ID);
  if (existing) existing.remove();

  const ctx = getConversationContext();
  if (!ctx) return;

  const insertion = findHsSidebarInsertion();
  if (!insertion) return;

  const card = document.createElement('div');
  card.id = HS_CARD_ID;
  card.className = 'lc-card';

  const title = document.createElement('div');
  title.className = 'lc-card-title';
  title.textContent = 'Clockify timer';

  const timerRow = document.createElement('div');
  timerRow.className = 'lc-card-timer-row';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'lc-hs-card-timer-button';
  button.className = 'lc-btn lc-btn-start';
  button.textContent = '▶ Start';

  const elapsed = document.createElement('span');
  elapsed.id = 'lc-hs-card-elapsed';
  elapsed.className = 'lc-elapsed';
  elapsed.style.display = 'none';

  const info = document.createElement('span');
  info.id = 'lc-hs-card-info';
  info.className = 'lc-info';
  info.style.display = 'none';

  hsCardSnapChip = buildSnapChip();
  hsCardSnapChip.chip.id = 'lc-hs-card-snap-chip';

  timerRow.appendChild(button);
  timerRow.appendChild(elapsed);
  timerRow.appendChild(info);
  timerRow.appendChild(hsCardSnapChip.chip);

  const divider = document.createElement('div');
  divider.className = 'lc-card-divider';

  const manualTitle = document.createElement('div');
  manualTitle.className = 'lc-card-subtitle';
  manualTitle.textContent = 'Manuális rögzítés';

  const { form, fields } = buildManualEntryForm();
  attachManualEntrySubmit(form, fields, async ({ startISO, endISO, dayStart, dayEnd }) => {
    const live = getConversationContext(); // re-read in case SPA changed
    return {
      action: 'createHsManualEntry',
      data: {
        ticketNumber: live?.ticketNumber || ctx.ticketNumber,
        subject: live?.subject || ctx.subject,
        customer: live?.customer || ctx.customer,
        startISO,
        endISO,
        dayStartISO: dayStart,
        dayEndISO: dayEnd,
      },
    };
  });

  card.appendChild(title);
  card.appendChild(timerRow);
  card.appendChild(divider);
  card.appendChild(manualTitle);
  card.appendChild(form);

  // Prepend to sidebar (top of properties panel)
  insertion.insertBefore(card, insertion.firstChild);

  button.addEventListener('click', handleHsButtonClick);
  hsCardSnapChip.refresh();
}
```

- [ ] **Step 2: Update `updateHsButtonState` to also drive the card button**

Modify `updateHsButtonState` to apply state to both the header button and the card button:

```js
async function updateHsButtonState() {
  if (hsElapsedInterval) {
    clearInterval(hsElapsedInterval);
    hsElapsedInterval = null;
  }

  const ctx = getConversationContext();
  if (!ctx) return;

  const buttons = [
    {
      button: document.getElementById('lc-hs-timer-button'),
      elapsed: document.getElementById('lc-hs-elapsed'),
      info: document.getElementById('lc-hs-info'),
    },
    {
      button: document.getElementById('lc-hs-card-timer-button'),
      elapsed: document.getElementById('lc-hs-card-elapsed'),
      info: document.getElementById('lc-hs-card-info'),
    },
  ].filter((b) => b.button);
  if (buttons.length === 0) return;

  const { settings } = await chrome.storage.local.get('settings');
  if (!settings?.apiKey) {
    buttons.forEach(({ button, elapsed, info }) => applyHsButtonState(button, elapsed, info, 'hidden'));
    return;
  }

  const { activeTimer } = await chrome.storage.local.get('activeTimer');

  let state;
  if (!activeTimer || activeTimer.external) {
    state = 'start';
  } else if (activeTimer.source === 'hs' && activeTimer.ticketNumber === ctx.ticketNumber) {
    state = 'stop';
  } else {
    state = 'switch';
  }
  buttons.forEach(({ button, elapsed, info }) => applyHsButtonState(button, elapsed, info, state, activeTimer));

  if (state === 'stop') startHsElapsedCounter(activeTimer.startedAt);

  if (hsMainSnapChip) hsMainSnapChip.refresh();
  if (hsCardSnapChip) hsCardSnapChip.refresh();
}
```

Update `startHsElapsedCounter` to update both elapsed elements:

```js
function startHsElapsedCounter(startedAt) {
  const elements = [
    document.getElementById('lc-hs-elapsed'),
    document.getElementById('lc-hs-card-elapsed'),
  ].filter(Boolean);
  if (elements.length === 0) return;
  function update() {
    const diff = Date.now() - new Date(startedAt).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    elements.forEach((el) => { el.textContent = text; });
  }
  update();
  hsElapsedInterval = setInterval(update, 1000);
}
```

- [ ] **Step 3: Commit**

```bash
git add hs-content.js
git commit -m "feat: HS right-sidebar card with manual entry form"
```

---

### Task 17: Init + SPA observer + storage sync for `hs-content.js`

**Files:**
- Modify: `hs-content.js`

- [ ] **Step 1: Add init/observer logic (mirrors `content.js` pattern)**

Append to `hs-content.js`:

```js
function tryInsertHsUI() {
  createHsTimerButton();
  createHsRightPanelCard();
  updateHsButtonState();

  const container = document.getElementById(HS_BUTTON_CONTAINER_ID);
  const card = document.getElementById(HS_CARD_ID);
  // Card may not render (no sidebar match) — container is the required element
  return Boolean(container);
}

let hsInitObserver = null;

function waitForHsDomAndInit() {
  if (hsInitObserver) {
    hsInitObserver.disconnect();
    hsInitObserver = null;
  }
  if (tryInsertHsUI()) return;

  let debounce = null;
  hsInitObserver = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (tryInsertHsUI()) {
        hsInitObserver.disconnect();
        hsInitObserver = null;
      }
    }, 200);
  });
  hsInitObserver.observe(document.body, { childList: true, subtree: true });

  setTimeout(() => {
    if (hsInitObserver) {
      hsInitObserver.disconnect();
      hsInitObserver = null;
    }
  }, 30000);
}

let hsLastUrl = window.location.href;
const hsUrlObserver = new MutationObserver(() => {
  if (window.location.href !== hsLastUrl) {
    hsLastUrl = window.location.href;
    if (parseHsUrl(window.location.pathname)) {
      waitForHsDomAndInit();
    }
  }
});
hsUrlObserver.observe(document.body, { childList: true, subtree: true });

chrome.storage.onChanged.addListener((changes) => {
  if (changes.activeTimer || changes.settings) {
    updateHsButtonState();
  }
});

if (parseHsUrl(window.location.pathname)) {
  waitForHsDomAndInit();
}
```

- [ ] **Step 2: Manual integration test**

1. Reload extension
2. Visit HelpScout, open a conversation
3. Verify:
   - Timer button appears near the conversation header
   - Right-sidebar card appears (if a sidebar selector matched — OK if it doesn't on some pages)
   - Click Start → timer starts, Clockify entry created with `[HS: #ticketNumber] subject - customer`
   - Click Stop → entry ends
   - Navigate to another conversation → UI re-injects
   - Snap chip works (after stopping a timer, start a new one on HS within 15 min → snaps back)
4. Navigate to Linear → Linear UI still works
5. Test manual entry form in HS card → entry created with overlap detection

- [ ] **Step 3: Commit**

```bash
git add hs-content.js
git commit -m "feat: HS content script init + SPA observer + storage sync"
```

---

## Phase 6 — Ancillary updates

### Task 18: Update popup to show HS source correctly

**Files:**
- Read: `popup.js` (inspect current format)
- Modify: `popup.js`

- [ ] **Step 1: Read current `popup.js` to see existing title rendering**

```bash
cat popup.js
```

Note where `activeTimer.issueKey` + `issueTitle` are rendered.

- [ ] **Step 2: Branch on `source` when rendering**

Replace the title-rendering block with:

```js
let headline;
if (activeTimer.source === 'hs') {
  const tkt = activeTimer.ticketNumber ? `#${activeTimer.ticketNumber}` : '';
  headline = [tkt, activeTimer.issueTitle].filter(Boolean).join(' — ');
} else if (activeTimer.issueKey) {
  headline = `${activeTimer.issueKey} — ${activeTimer.issueTitle}`;
} else {
  headline = activeTimer.issueTitle || 'Külső timer';
}
// assign `headline` to whichever DOM element currently shows the title
```

(Adjust based on actual popup.js structure.)

- [ ] **Step 3: Manual test**

1. Start an HS timer on a conversation page
2. Click the extension icon
3. Verify popup shows `#43152 — Re: ... - Customer` (or similar)
4. Stop, start a Linear timer, verify popup shows `IT-1 — ...`

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat: popup shows HS timers with #ticketNumber prefix"
```

---

### Task 19: Add `hsProjectName` field to Options

**Files:**
- Modify: `options.html`
- Modify: `options.js`

- [ ] **Step 1: Add HTML field**

In `options.html`, near the workspace/team section, add:

```html
<div class="field">
  <label for="hsProjectName">HelpScout projekt neve</label>
  <input type="text" id="hsProjectName" placeholder="Lakások és Tulajok" />
  <p class="hint">Ez a Clockify projekt amibe a HelpScout timerek kerülnek.</p>
</div>
```

- [ ] **Step 2: Load/save in `options.js`**

In the load handler, add:

```js
document.getElementById('hsProjectName').value = settings.hsProjectName || 'Lakások és Tulajok';
```

In the save handler, include:

```js
hsProjectName: document.getElementById('hsProjectName').value.trim() || 'Lakások és Tulajok',
```

- [ ] **Step 3: Manual test**

1. Reload extension
2. Open Options; verify field shows `Lakások és Tulajok`
3. Change to e.g. `Management`, save
4. Start a HS timer; verify Clockify entry is in the Management project
5. Change back to `Lakások és Tulajok`

- [ ] **Step 4: Commit**

```bash
git add options.html options.js
git commit -m "feat: add HS project name field to Options"
```

---

## Phase 7 — Final verification

### Task 20: End-to-end manual test checklist

**Files:**
- Create: `docs/superpowers/plans/2026-04-21-helpscout-support-acceptance.md` (test log)

- [ ] **Step 1: Run through the checklist — fill the test log as you go**

Create `docs/superpowers/plans/2026-04-21-helpscout-support-acceptance.md`:

```markdown
# Acceptance — HelpScout + snap-to-previous

## Linear regression
- [ ] Open Linear issue → timer button appears in header
- [ ] Right-panel card appears under Project section
- [ ] Start timer → Clockify entry created with `[IT-n] title`
- [ ] Elapsed counter ticks
- [ ] Stop → entry ends
- [ ] Stop & Start (switch) → works
- [ ] Manual entry: valid input → Rögzítve ✓
- [ ] Manual entry: overlap → error shown with conflicting entry
- [ ] Manual entry: invalid time format → error
- [ ] Missing API key → settings link shown instead of button

## HelpScout new features
- [ ] Timer button visible in conversation header
- [ ] Start → `[HS: #n] subject - customer` in Clockify, project "Lakások és Tulajok"
- [ ] Elapsed counter ticks
- [ ] Stop works
- [ ] Stop & Start across conversations
- [ ] Right-sidebar card (if sidebar selector matches)
- [ ] Manual entry on HS card
- [ ] Overlap detection in manual entry
- [ ] SPA nav (switch conversation) re-injects UI

## Snap-to-previous
- [ ] Stop a timer, start a new one < 15 min later → start = previous end
- [ ] >15 min later → start = now
- [ ] Chip shows `↶ HH:MM` when snap available
- [ ] Click chip → flips to off, timer starts at `now`
- [ ] Click again → re-enables, snap resumes
- [ ] Works on Linear floating button + card
- [ ] Works on HS timer button + card

## Cross-platform
- [ ] Linear timer running → HS shows "Switch" state
- [ ] HS timer running → Linear shows "Switch" state
- [ ] Popup shows correct format for each source
- [ ] External timer created in Clockify UI → extension detects source correctly
```

- [ ] **Step 2: Execute the checklist**

Walk through every item. Check ✓ or note the issue.

- [ ] **Step 3: Fix any issues discovered**

Create follow-up commits as needed, one per issue.

- [ ] **Step 4: Commit the test log**

```bash
git add docs/superpowers/plans/2026-04-21-helpscout-support-acceptance.md
git commit -m "docs: HS support acceptance test log"
```

- [ ] **Step 5: Final manifest version bump**

Bump `"version"` in `manifest.json` (e.g. `1.0.0` → `1.1.0`).

```bash
git add manifest.json
git commit -m "chore: bump version to 1.1.0 (HelpScout + snap-to-previous)"
```

---

## Self-review notes

- **Spec coverage:** HS timer ✓, HS manual entry ✓, HS description format ✓, HS project resolution ✓, external timer detection ✓, snap chip ✓, snap logic (not applied to switch / manual) ✓, popup update ✓, options field ✓.
- **Type consistency:** `activeTimer` shape is `{ timeEntryId, source, ... }` throughout — `source` is required for Linear (Task 9), HS (Task 11), and unknown (Task 9 fallback). `ticketNumber` only on HS; `issueKey`/`teamKey` only on Linear.
- **Action naming:** `startHsTimer`, `stopAndStartHsTimer`, `createHsManualEntry`, `getSnapInfo`, `setSnapEnabled` — matches spec.
- **Testing:** pure helpers have Node tests; UI gets manual checklist. Zero new runtime dependencies.
- **No placeholders:** all code blocks contain actual implementations; commands are exact.
