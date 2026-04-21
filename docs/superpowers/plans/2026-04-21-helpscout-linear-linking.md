# HelpScout ↔ Linear issue-linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Minden HS conv-on indított timer (Start és Manual Entry egyaránt) automatikusan létrehozzon egy Linear issue-t a TUL team-ben, ha még nincs, és a Clockify entry `[LIN-xxx]` prefixet kapjon. A conv-issue lookup `attachmentsForURL` alapján stabil és indexelt. Customer-linkage és AI summary out-of-scope (külön cron-nak szánva).

**Architecture:** Két réteg. Extension (szinkron) a timer indítás / manual entry flow-ba beékelődik egy lookup-or-create Linear lépéssel a `background.js`-ben. Minden enrichment-adat (emailek, HS customer ID, név) a Linear `attachment.metadata`-ba kerül — egy jövőbeli cron onnan dolgozik. Strict blokkolás: ha a Linear config hiányos, a HS timer nem indul.

**Tech Stack:** Chrome extension (Manifest V3), vanilla JS, `node:test` framework, Linear GraphQL API, Clockify REST API, `chrome.storage.local` settings.

---

## File Structure

**Create:**
- `tests/linear.test.js` — unit tests a `linearFindOrCreateIssue` flow-hoz mockolt `fetch`-csel
- `tests/hs-dom.test.js` — unit tests a DOM-parse helpers-hez JSDOM-szerű stub-bal

**Modify:**
- `shared.js` — új helper-ek: `canonicalizeHsUrl`, `parseHsEmailsFromDom`, `parseHsCustomerIdFromDom`; `buildHsDescription` átszabása `[LIN-xxx]` formátumra; `detectTimerSource` kiegészítése HS-forrású LIN-prefixek felismerésére
- `hs-content.js` — `getConversationContext` kiegészítése DOM-parse-eredménnyel, új `emails` / `hsCustomerId` / `canonicalHsUrl` mezők
- `background.js` — új `linearFindOrCreateIssue()` helper; `startHsTimer`, `stopAndStartHsTimer`, `createHsManualEntry` kiegészítése egy find-or-create lépéssel; strict config-check; in-memory `TEAM_META` cache; új `validateLinearConfig` és `loadLinearTeams` action-ök az options flow-hoz
- `options.html` — új `linearDefaultTeamId` dropdown + "Linear teszt" gomb
- `options.js` — teams lekérdezés, dropdown feltöltés, viewer ID + in-progress state auto-fetch save-kor
- `tests/shared.test.js` — kiegészítő tesztek az új shared.js-funkciókhoz

**Don't touch:**
- `content.js` (Linear content script) — ez a feature nem érinti
- `popup.html`, `popup.js` — csak akkor ha a timer-state megjelenítésben szöveget kell frissíteni (az új `[LIN-xxx] — customer` formátum megjelenítése)

---

## Task Breakdown

### Task 1: URL canonicalization helper a shared.js-ben

**Files:**
- Modify: `shared.js` (új függvény a HelpScout parsing szekcióba)
- Test: `tests/shared.test.js`

- [ ] **Step 1: Write failing test** — add hozzá a `tests/shared.test.js` végéhez (a `test(...)` függvény mellé, a meglévő mintát követve):

```javascript
test('canonicalizeHsUrl strips viewId, hash, and other query params', () => {
  const fn = shared.canonicalizeHsUrl;
  assert.strictEqual(
    fn('https://secure.helpscout.net/conversation/3297862965/44477?viewId=8514301'),
    'https://secure.helpscout.net/conversation/3297862965/44477'
  );
  assert.strictEqual(
    fn('https://secure.helpscout.net/conversation/3297862965/44477?viewId=1&foo=bar#thread-123'),
    'https://secure.helpscout.net/conversation/3297862965/44477'
  );
  assert.strictEqual(
    fn('https://secure.helpscout.net/conversation/3297862965/44477/'),
    'https://secure.helpscout.net/conversation/3297862965/44477/'
  );
});

test('canonicalizeHsUrl returns null on invalid input', () => {
  assert.strictEqual(shared.canonicalizeHsUrl(''), null);
  assert.strictEqual(shared.canonicalizeHsUrl('not-a-url'), null);
  assert.strictEqual(shared.canonicalizeHsUrl(null), null);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/shared.test.js`
Expected: FAIL with `canonicalizeHsUrl is not a function` vagy hasonló.

- [ ] **Step 3: Implement `canonicalizeHsUrl`** — `shared.js`-ben, a `parseHsUrl` után, a `parseHsTitle` előtt. URL class használata, nem manuális string-műveletek:

```javascript
function canonicalizeHsUrl(raw) {
  const str = String(raw || '').trim();
  if (!str) return null;
  try {
    const u = new URL(str);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}
```

Majd add hozzá a `canonicalizeHsUrl` kulcsot a modul végén lévő `api` objektumhoz (a többi `parseHsUrl` stb. mellé).

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/shared.test.js`
Expected: PASS all tests.

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/shared.test.js
git commit -m "feat(shared): add canonicalizeHsUrl helper"
```

---

### Task 2: DOM email parse helper

**Files:**
- Modify: `shared.js`
- Test: `tests/shared.test.js`

- [ ] **Step 1: Write failing test** — add hozzá a `tests/shared.test.js` végéhez. A helper egy `querySelectorAll`-szerű root-ot vár (szabványos DOM interface), így egyszerű mock objekt adhatja:

```javascript
test('parseHsEmailsFromDom returns empty array when no emails list present', () => {
  const mockRoot = { querySelectorAll: () => [] };
  assert.deepStrictEqual(shared.parseHsEmailsFromDom(mockRoot), []);
});

test('parseHsEmailsFromDom extracts single email', () => {
  const mockRoot = {
    querySelectorAll(selector) {
      if (selector === '[data-cy="Sidebar.CustomerEmails"] [data-testid="EmailList.EmailLink"]') {
        return [{
          querySelector: (s) =>
            s === '.c-Truncate__content' ? { textContent: 'user@example.com' } : null,
        }];
      }
      return [];
    },
  };
  assert.deepStrictEqual(shared.parseHsEmailsFromDom(mockRoot), ['user@example.com']);
});

test('parseHsEmailsFromDom extracts multiple emails and trims', () => {
  const mk = (v) => ({
    querySelector: (s) => s === '.c-Truncate__content' ? { textContent: v } : null,
  });
  const mockRoot = {
    querySelectorAll(selector) {
      if (selector === '[data-cy="Sidebar.CustomerEmails"] [data-testid="EmailList.EmailLink"]') {
        return [mk('a@x.com'), mk(' b@y.hu '), mk('')];
      }
      return [];
    },
  };
  // Empty entries filtered out, whitespace trimmed
  assert.deepStrictEqual(shared.parseHsEmailsFromDom(mockRoot), ['a@x.com', 'b@y.hu']);
});

test('parseHsEmailsFromDom handles null/undefined root', () => {
  assert.deepStrictEqual(shared.parseHsEmailsFromDom(null), []);
  assert.deepStrictEqual(shared.parseHsEmailsFromDom(undefined), []);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/shared.test.js`
Expected: FAIL with `parseHsEmailsFromDom is not a function`.

- [ ] **Step 3: Implement `parseHsEmailsFromDom`** — a `shared.js`-ben a `canonicalizeHsUrl` után:

```javascript
function parseHsEmailsFromDom(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const links = root.querySelectorAll(
    '[data-cy="Sidebar.CustomerEmails"] [data-testid="EmailList.EmailLink"]'
  );
  const out = [];
  for (const link of links) {
    const span = link.querySelector && link.querySelector('.c-Truncate__content');
    const text = span && span.textContent ? String(span.textContent).trim() : '';
    if (text) out.push(text);
  }
  return out;
}
```

Add hozzá a modul-végi `api` objekthez.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/shared.test.js`
Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/shared.test.js
git commit -m "feat(shared): add parseHsEmailsFromDom helper"
```

---

### Task 3: DOM HS customer ID parse helper

**Files:**
- Modify: `shared.js`
- Test: `tests/shared.test.js`

- [ ] **Step 1: Write failing test** — a `tests/shared.test.js` végéhez:

```javascript
test('parseHsCustomerIdFromDom extracts customer ID from first email link href', () => {
  const mockRoot = {
    querySelector(selector) {
      if (selector === '[data-cy="Sidebar.CustomerEmails"] [data-testid="EmailList.EmailLink"]') {
        return { getAttribute: (a) => a === 'href' ? '/mailbox/334555/customer/749159069/900659784' : null };
      }
      return null;
    },
  };
  assert.strictEqual(shared.parseHsCustomerIdFromDom(mockRoot), '749159069');
});

test('parseHsCustomerIdFromDom returns null when no email link', () => {
  const mockRoot = { querySelector: () => null };
  assert.strictEqual(shared.parseHsCustomerIdFromDom(mockRoot), null);
});

test('parseHsCustomerIdFromDom returns null on malformed href', () => {
  const mockRoot = {
    querySelector: () => ({ getAttribute: () => '/some/unrelated/path' }),
  };
  assert.strictEqual(shared.parseHsCustomerIdFromDom(mockRoot), null);
});

test('parseHsCustomerIdFromDom handles null/undefined root', () => {
  assert.strictEqual(shared.parseHsCustomerIdFromDom(null), null);
  assert.strictEqual(shared.parseHsCustomerIdFromDom(undefined), null);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/shared.test.js`
Expected: FAIL with `parseHsCustomerIdFromDom is not a function`.

- [ ] **Step 3: Implement `parseHsCustomerIdFromDom`** — a `shared.js`-ben a `parseHsEmailsFromDom` után:

```javascript
function parseHsCustomerIdFromDom(root) {
  if (!root || typeof root.querySelector !== 'function') return null;
  const link = root.querySelector(
    '[data-cy="Sidebar.CustomerEmails"] [data-testid="EmailList.EmailLink"]'
  );
  if (!link) return null;
  const href = link.getAttribute && link.getAttribute('href');
  if (!href) return null;
  const m = String(href).match(/\/customer\/(\d+)/);
  return m ? m[1] : null;
}
```

Add hozzá az `api`-hoz.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/shared.test.js`
Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/shared.test.js
git commit -m "feat(shared): add parseHsCustomerIdFromDom helper"
```

---

### Task 4: `buildHsDescription` átalakítás `[LIN-xxx]` formátumra

**Files:**
- Modify: `shared.js`
- Test: `tests/shared.test.js`

Jelenlegi viselkedés: `buildHsDescription({ ticketNumber, subject, customer })` → `"[HS: #43152] subject - customer"`.
Új viselkedés: vezető argumentum az `issueKey` (a `LIN-xxx`); ha `issueKey` jelen → `[LIN-xxx] subject — customer`; ha nincs → fallback a régi HS-prefix formátumra. A HS-fallback azért marad, hogy ha később feltűnik egy bug-path ahol nincs Linear (strict-check ellenére) még debug-olható legyen a kimenet.

- [ ] **Step 1: Find and review existing uses** — keresd meg a `buildHsDescription` jelenlegi hívásait és teszt-elvárásait:

Run: `grep -n 'buildHsDescription' shared.js background.js tests/shared.test.js`
Expected output (jelenleg):
- `shared.js:82` — a definíció
- `shared.js:523` — export
- `background.js:4` — importálás a `self.LCShared`-ből
- `background.js:221` — meghívás `createHsManualEntry`-ben
- `background.js:289` — meghívás `startHsTimer`-ben
- `tests/shared.test.js` — több test case

- [ ] **Step 2: Update existing tests** — a `tests/shared.test.js` meglévő `buildHsDescription` test-jeit cseréld a következőkre. Először keresd meg őket:

Run: `grep -n 'buildHsDescription' tests/shared.test.js`

Cseréld le minden `buildHsDescription({...})` hívást úgy, hogy első argumentum `null` (jelzi: nincs Linear), és ellenőrizzük hogy a régi `[HS: #...]` fallback jön. Plusz új test-eket is adj hozzá a LIN-path-ra. A végeredmény ezeket a teszteket tartalmazza a fájlban (cserélve / hozzátéve):

```javascript
test('buildHsDescription with Linear identifier uses [LIN-xxx] prefix', () => {
  const d = shared.buildHsDescription({
    issueKey: 'LIN-1234',
    subject: 'Re: Népszínház 26. lemondás',
    customer: 'Tímea Kovács',
  });
  assert.strictEqual(d, '[LIN-1234] Re: Népszínház 26. lemondás — Tímea Kovács');
});

test('buildHsDescription without customer uses no trailing em-dash', () => {
  const d = shared.buildHsDescription({
    issueKey: 'LIN-1234',
    subject: 'Test subject',
    customer: '',
  });
  assert.strictEqual(d, '[LIN-1234] Test subject');
});

test('buildHsDescription without subject falls back to HS ticket number', () => {
  const d = shared.buildHsDescription({
    issueKey: 'LIN-1234',
    ticketNumber: '43152',
    subject: '',
    customer: 'Tímea Kovács',
  });
  assert.strictEqual(d, '[LIN-1234] HS #43152 — Tímea Kovács');
});

test('buildHsDescription without Linear issueKey falls back to [HS: #n] prefix', () => {
  const d = shared.buildHsDescription({
    issueKey: null,
    ticketNumber: '43152',
    subject: 'Re: Népszínház 26. lemondás',
    customer: 'Tímea Kovács',
  });
  assert.strictEqual(d, '[HS: #43152] Re: Népszínház 26. lemondás - Tímea Kovács');
});

test('buildHsDescription HS-fallback with only ticketNumber', () => {
  const d = shared.buildHsDescription({ issueKey: null, ticketNumber: '43152' });
  assert.strictEqual(d, '[HS: #43152]');
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `node --test tests/shared.test.js`
Expected: FAIL — az új `[LIN-...]`-alapú assertion-ök buknak, mert a függvény még régi.

- [ ] **Step 4: Update `buildHsDescription`** — a `shared.js`-ben (a jelenlegi 82-86 sort cseréld le):

```javascript
function buildHsDescription({ issueKey, ticketNumber, subject, customer } = {}) {
  const subj = subject && String(subject).trim();
  const cust = customer && String(customer).trim();
  const tnum = ticketNumber && String(ticketNumber).trim();

  if (issueKey) {
    const body = subj || (tnum ? `HS #${tnum}` : '');
    const tail = cust ? `${body} — ${cust}` : body;
    return tail ? `[${issueKey}] ${tail}` : `[${issueKey}]`;
  }

  // Fallback: no Linear identifier → legacy HS-prefix format
  const prefix = tnum ? `[HS: #${tnum}]` : '[HS: #?]';
  const legacyTail = [subj, cust].filter(Boolean).join(' - ');
  return legacyTail ? `${prefix} ${legacyTail}` : prefix;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node --test tests/shared.test.js`
Expected: PASS all.

- [ ] **Step 6: Commit**

```bash
git add shared.js tests/shared.test.js
git commit -m "feat(shared): buildHsDescription supports [LIN-xxx] prefix with HS fallback"
```

---

### Task 5: `detectTimerSource` — `[LIN-xxx]` is lehet HS-forrás

**Files:**
- Modify: `shared.js`
- Test: `tests/shared.test.js`

A `detectTimerSource` jelenleg csak a description-string alapján dönt. Linear issue-ból indított timer leírása `[LIN-xxx] subject ...` — ami **eredetileg a Linear oldalon indított timer** is. Most viszont HS-ből is jöhet ilyen description.

A HS content script (`hs-content.js`) szintjén a "HS-e a timer" döntést jelenleg a `[HS: #...]` prefix hozza meg. Mivel az új formátum `[LIN-xxx]`, a HS content script szintjén egy másodlagos jel is kell: a Linear issue-hoz tartozik-e HS-attachment?

**Döntés**: ne a `detectTimerSource`-ot terheljük meg aszinkron attachment-lookuppal. Helyette az **active timer `source` field-je** legyen az igazság forrása a `chrome.storage.local.activeTimer`-en keresztül — a background `startHsTimer` akkor is `source: 'hs'`-et ír oda, ha a description `[LIN-xxx]`. A HS content script szintjén ezt már ellenőrzi (lásd hs-content.js:113: `activeTimer.source === 'hs'`).

A `detectTimerSource` akkor hasznos amikor **külső** timer-t azonosít: egy másik user vagy más gép indította a timert, és a `checkRunningTimer` a description-ből próbálja detektálni. Ha a description `[LIN-xxx] ...` → jelenleg `source: 'linear'`-t mond. Ez most hibás lehet: lehet hogy egy HS-ből induló timer.

**Gyakorlati döntés az MVP-ben**: ne módosítsuk a `detectTimerSource`-ot. Külső timerek `linear`-ként lesznek detektálva — ez vizuálisan rendben van (a Linear oldalon látszik a Stop gomb), a HS oldalon nem látszik mint "HS-timer", csak mint "külső timer". Ez elfogadható MVP-szintű viselkedés. Egy későbbi iteráció cache-elt attachment-lookupot adhat hozzá.

**Tehát ebben a task-ban csak egy tesztet írunk annak dokumentálására, hogy a jelenlegi viselkedés megmarad és szándékos**:

- [ ] **Step 1: Write documentation test** — a `tests/shared.test.js` végéhez:

```javascript
test('detectTimerSource treats [LIN-xxx] as linear source (HS-sourced timers rely on activeTimer.source for identity)', () => {
  // A HS-ből indított timer description-je is [LIN-xxx] formátumú, de az
  // activeTimer.source = "hs" a chrome.storage.local-ban — a content script
  // annak alapján dönt, nem a description-ből. detectTimerSource-ot csak
  // külső (más-gépen indított) timereknél hívjuk, amikor egy fallback jelzés
  // elég: a user lássa hogy "külső Linear timer fut".
  const detected = shared.detectTimerSource('[LIN-1234] Re: subject — customer');
  assert.strictEqual(detected.source, 'linear');
  assert.strictEqual(detected.issueKey, 'LIN-1234');
  assert.strictEqual(detected.teamKey, 'LIN');
});
```

- [ ] **Step 2: Run test to verify pass** (a detektor viselkedése nem változott, így zöld kell legyen):

Run: `node --test tests/shared.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/shared.test.js
git commit -m "test(shared): document detectTimerSource behavior for [LIN-xxx] descriptions"
```

---

### Task 6: `getConversationContext` kiegészítés a hs-content.js-ben

**Files:**
- Modify: `hs-content.js:19-29` — `getConversationContext` függvény

A meglévő `getConversationContext` csak `convId`, `ticketNumber`, `subject`, `customer`-t ad vissza. Ki kell egészíteni a canonical URL-lel, emailekkel, HS customer ID-val.

- [ ] **Step 1: Update `getConversationContext`** — cseréld le a `hs-content.js:19-29` sorokat:

```javascript
function getConversationContext() {
  const url = parseHsUrl(window.location.pathname);
  if (!url) return null;
  const titleParsed = parseHsTitle(document.title);
  return {
    convId: url.convId,
    ticketNumber: url.ticketNumber,
    subject: titleParsed?.subject || '',
    customer: titleParsed?.customer || '',
    canonicalHsUrl: canonicalizeHsUrl(window.location.href) || window.location.href,
    emails: parseHsEmailsFromDom(document),
    hsCustomerId: parseHsCustomerIdFromDom(document),
  };
}
```

- [ ] **Step 2: Update the destructuring import** — cseréld le a `hs-content.js:3-9` sorok import blokkját:

```javascript
const {
  parseTimeInput, formatHM, todayStr, localTimeToISO, dayBoundsISO,
  setStatus, clearStatus, createSettingsLink,
  buildManualEntryForm, attachManualEntrySubmit,
  buildSnapChip, buildStartEditor,
  parseHsUrl, parseHsTitle,
  canonicalizeHsUrl, parseHsEmailsFromDom, parseHsCustomerIdFromDom,
} = window.LCShared;
```

- [ ] **Step 3: Smoke test manually**

Töltsd be az extensiont unpacked módban, menj egy HS conv oldalra. Nyisd meg a DevTools console-t és pattints a timer gombra. A `[LC HS]` prefixelt console.log-ok között látnia kell `ctx`-et emails tömbbel és hsCustomerId-val (ha a sidebar nyitva van).

Expected: `ctx.emails` tömb (0-több string), `ctx.hsCustomerId` vagy string (HS customer ID) vagy `null`, `ctx.canonicalHsUrl` `?viewId` nélkül.

**Ha a mezők `undefined`-ok** (nem `[]` vagy `null`): valami nincs exportálva a shared.js-ből. Check: `console.log(Object.keys(window.LCShared))` — tartalmaznia kell az új 3 kulcsot.

- [ ] **Step 4: Commit**

```bash
git add hs-content.js
git commit -m "feat(hs): enrich conversation context with canonicalUrl, emails, hsCustomerId"
```

---

### Task 7: Linear API — `linearRequest` wrapper a background.js-ben

**Files:**
- Modify: `background.js` (új helper a `getIssueDetails` előtt)
- Test: `tests/linear.test.js` (új fájl)

A jelenlegi `getIssueDetails` közvetlenül `fetch`-et hív a Linear API-ra. Refaktoráljuk egy közös `linearRequest` wrapper mögé, hogy az új `linearFindOrCreateIssue` is használhassa. A wrapper kezelje: hiányzó API key, 401/403 auth hiba, 429 rate limit, egyéb HTTP hibák, JSON body.

- [ ] **Step 1: Create test file** — új `tests/linear.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');

// Stub chrome.storage.local before requiring background's shared.js indirect deps.
// We don't load background.js itself (it has chrome extension APIs); instead,
// we test linearRequest as a pure function by factoring it out or by mock
// injection. For this task, we'll test via a factory pattern.

// Since background.js uses importScripts and global chrome API, we extract
// linearRequest into a plain function that accepts apiKey + fetch as deps.

// --- Minimal linearRequest contract (to be implemented in background.js):
// async function linearRequest({ query, variables, apiKey, fetchFn }) {
//   Returns parsed GraphQL response data on success.
//   Throws Error('LINEAR_NO_API_KEY') if !apiKey.
//   Throws Error('LINEAR_AUTH') on 401/403.
//   Throws Error('LINEAR_RATE_LIMIT') on 429.
//   Throws Error(`Linear API {status}: {body}`) on other errors.
//   Throws the first GraphQL error message on 200-with-errors.

// To test: move linearRequest into shared.js so it's importable without chrome API.
// For this MVP we test in isolation via dynamic require of a small module.

const { linearRequest } = require('../shared.js');

test('linearRequest throws LINEAR_NO_API_KEY if apiKey missing', async () => {
  await assert.rejects(
    linearRequest({ query: '{ viewer { id } }', apiKey: '', fetchFn: () => {} }),
    /LINEAR_NO_API_KEY/
  );
});

test('linearRequest returns data on successful response', async () => {
  const fakeFetch = async (url, opts) => {
    assert.strictEqual(url, 'https://api.linear.app/graphql');
    assert.strictEqual(opts.method, 'POST');
    assert.strictEqual(JSON.parse(opts.body).query.trim(), 'query { viewer { id } }');
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { viewer: { id: 'u1' } } }),
    };
  };
  const out = await linearRequest({
    query: 'query { viewer { id } }',
    apiKey: 'lin_api_test',
    fetchFn: fakeFetch,
  });
  assert.deepStrictEqual(out, { viewer: { id: 'u1' } });
});

test('linearRequest throws LINEAR_AUTH on 401', async () => {
  const fakeFetch = async () => ({
    ok: false, status: 401, text: async () => 'unauthorized',
  });
  await assert.rejects(
    linearRequest({ query: '', apiKey: 'x', fetchFn: fakeFetch }),
    /LINEAR_AUTH/
  );
});

test('linearRequest throws LINEAR_RATE_LIMIT on 429', async () => {
  const fakeFetch = async () => ({
    ok: false, status: 429, text: async () => 'rate limited',
  });
  await assert.rejects(
    linearRequest({ query: '', apiKey: 'x', fetchFn: fakeFetch }),
    /LINEAR_RATE_LIMIT/
  );
});

test('linearRequest throws on GraphQL-level errors', async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ errors: [{ message: 'Team not found' }] }),
  });
  await assert.rejects(
    linearRequest({ query: '', apiKey: 'x', fetchFn: fakeFetch }),
    /Team not found/
  );
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/linear.test.js`
Expected: FAIL with `linearRequest is not a function` (since we export from shared.js which doesn't have it yet).

- [ ] **Step 3: Implement `linearRequest` in `shared.js`** — a `shared.js` végén lévő `api` objektum előtt. A `linearRequest` a `fetchFn`-t DI-zi hogy tesztelhető legyen:

```javascript
async function linearRequest({ query, variables, apiKey, fetchFn }) {
  if (!apiKey) throw new Error('LINEAR_NO_API_KEY');
  const response = await fetchFn('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('LINEAR_AUTH');
  }
  if (response.status === 429) {
    throw new Error('LINEAR_RATE_LIMIT');
  }
  if (!response.ok) {
    const body = typeof response.text === 'function' ? await response.text() : '';
    throw new Error(`Linear API ${response.status}: ${body}`);
  }
  const json = await response.json();
  if (json.errors && json.errors.length) {
    throw new Error(json.errors[0].message || 'Linear GraphQL error');
  }
  return json.data;
}
```

Add hozzá az `api` objektumhoz: `linearRequest,`.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/linear.test.js`
Expected: PASS all 5 tests.

- [ ] **Step 5: Refactor `getIssueDetails` in `background.js` to use `linearRequest`** — a `background.js:85-125` sorokat cseréld:

```javascript
async function getIssueDetails(teamKey, issueNumber) {
  const settings = await getSettings();
  if (!settings.linearApiKey) return null;

  const query = `query($teamKey: String!, $number: Float!) {
    issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }, first: 1) {
      nodes {
        title
        project { name }
        parent { title }
      }
    }
  }`;

  console.log('[LC BG] linear → issue', teamKey, issueNumber);
  try {
    const data = await linearRequest({
      query,
      variables: { teamKey, number: Number(issueNumber) },
      apiKey: settings.linearApiKey,
      fetchFn: fetch,
    });
    const issue = data?.issues?.nodes?.[0];
    if (!issue) return null;
    const parts = [];
    if (issue.project?.name) parts.push(issue.project.name);
    if (issue.parent?.title) parts.push(issue.parent.title);
    parts.push(issue.title);
    return { title: parts.join(' > ') };
  } catch (err) {
    console.warn('[LC BG] Linear API error:', err.message);
    return null;
  }
}
```

Adj hozzá egy `linearRequest`-et az első destructuring-hoz (`background.js:4`):

```javascript
const { detectTimerSource, computeSnapTime, buildHsDescription, isOverlappingEntry, linearRequest } = self.LCShared;
```

- [ ] **Step 6: Smoke test** — töltsd be az extensiont, menj egy Linear issue oldalra, a timer-gombra pattintás környékén a console log-ok között kell lennie a `linear → issue` / `linear ← issue` párnak, ugyanúgy mint a refactor előtt.

- [ ] **Step 7: Commit**

```bash
git add shared.js background.js tests/linear.test.js
git commit -m "refactor(bg): extract linearRequest helper with tests"
```

---

### Task 8: `linearFindOrCreateIssue` — a core lookup + create flow

**Files:**
- Modify: `background.js` (új függvény + segédek)
- Test: `tests/linear.test.js` (bővítés)

Ez a függvény kap egy HS context-et, és vagy talál egy létező Linear issue-t (attachment URL lookup-pal), vagy létrehoz egy újat + attachmentet. Visszaadja az issue identifier-t (pl. `"LIN-1234"`) és a titlet.

A `fetch` és a settings kívülről injektált (DI) hogy teszthető legyen.

- [ ] **Step 1: Write failing tests** — add hozzá a `tests/linear.test.js` végéhez:

```javascript
const { linearFindOrCreateIssue } = require('../shared.js');

test('linearFindOrCreateIssue returns existing issue when lookup succeeds', async () => {
  let callCount = 0;
  const fakeFetch = async (url, opts) => {
    callCount++;
    const body = JSON.parse(opts.body);
    if (body.query.includes('attachmentsForURL')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          data: { attachmentsForURL: { nodes: [{ issue: { identifier: 'LIN-1234', title: 'Existing', id: 'iss-id' } }] } },
        }),
      };
    }
    throw new Error('Unexpected query: ' + body.query);
  };
  const out = await linearFindOrCreateIssue({
    ctx: {
      canonicalHsUrl: 'https://secure.helpscout.net/conversation/333/44',
      subject: 'Subj', customer: 'Cust', ticketNumber: '44',
      hsConvIdLong: '333', hsConvIdShort: '44',
      emails: ['a@b.com'], hsCustomerId: '999',
    },
    config: {
      linearApiKey: 'x', linearDefaultTeamId: 't-id',
      linearViewerId: 'u-id', linearInProgressStateId: 's-id',
    },
    fetchFn: fakeFetch,
  });
  assert.strictEqual(out.issueKey, 'LIN-1234');
  assert.strictEqual(out.issueTitle, 'Existing');
  assert.strictEqual(out.wasCreated, false);
  assert.strictEqual(callCount, 1);
});

test('linearFindOrCreateIssue creates issue + attachment when lookup empty', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.query.includes('attachmentsForURL') ? 'lookup'
            : body.query.includes('issueCreate') ? 'issueCreate'
            : body.query.includes('attachmentCreate') ? 'attachmentCreate'
            : 'unknown');
    if (body.query.includes('attachmentsForURL')) {
      return { ok: true, status: 200, json: async () => ({ data: { attachmentsForURL: { nodes: [] } } }) };
    }
    if (body.query.includes('issueCreate')) {
      return {
        ok: true, status: 200,
        json: async () => ({ data: { issueCreate: { success: true, issue: { id: 'iss-1', identifier: 'LIN-5678' } } } }),
      };
    }
    if (body.query.includes('attachmentCreate')) {
      return {
        ok: true, status: 200,
        json: async () => ({ data: { attachmentCreate: { success: true, attachment: { id: 'att-1' } } } }),
      };
    }
    throw new Error('Unexpected');
  };
  const out = await linearFindOrCreateIssue({
    ctx: {
      canonicalHsUrl: 'https://secure.helpscout.net/conversation/333/44',
      subject: 'New subject', customer: 'New cust', ticketNumber: '44',
      hsConvIdLong: '333', hsConvIdShort: '44',
      emails: ['a@b.com'], hsCustomerId: '999',
    },
    config: {
      linearApiKey: 'x', linearDefaultTeamId: 't-id',
      linearViewerId: 'u-id', linearInProgressStateId: 's-id',
    },
    fetchFn: fakeFetch,
  });
  assert.deepStrictEqual(calls, ['lookup', 'issueCreate', 'attachmentCreate']);
  assert.strictEqual(out.issueKey, 'LIN-5678');
  assert.strictEqual(out.wasCreated, true);
});

test('linearFindOrCreateIssue retries attachmentCreate once on failure', async () => {
  const calls = [];
  let attachmentAttempts = 0;
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.query.includes('attachmentsForURL')) {
      calls.push('lookup');
      return { ok: true, status: 200, json: async () => ({ data: { attachmentsForURL: { nodes: [] } } }) };
    }
    if (body.query.includes('issueCreate')) {
      calls.push('issueCreate');
      return {
        ok: true, status: 200,
        json: async () => ({ data: { issueCreate: { success: true, issue: { id: 'iss-1', identifier: 'LIN-5678' } } } }),
      };
    }
    if (body.query.includes('attachmentCreate')) {
      attachmentAttempts++;
      calls.push(`attachmentCreate#${attachmentAttempts}`);
      if (attachmentAttempts === 1) {
        return { ok: false, status: 500, text: async () => 'server error' };
      }
      return {
        ok: true, status: 200,
        json: async () => ({ data: { attachmentCreate: { success: true, attachment: { id: 'att-1' } } } }),
      };
    }
    throw new Error('Unexpected');
  };
  const out = await linearFindOrCreateIssue({
    ctx: {
      canonicalHsUrl: 'https://secure.helpscout.net/conversation/333/44',
      subject: 'S', customer: 'C', ticketNumber: '44',
      hsConvIdLong: '333', hsConvIdShort: '44',
      emails: [], hsCustomerId: null,
    },
    config: {
      linearApiKey: 'x', linearDefaultTeamId: 't-id',
      linearViewerId: 'u-id', linearInProgressStateId: 's-id',
    },
    fetchFn: fakeFetch,
    retryDelayMs: 0, // no actual delay in tests
  });
  assert.deepStrictEqual(calls, ['lookup', 'issueCreate', 'attachmentCreate#1', 'attachmentCreate#2']);
  assert.strictEqual(out.wasCreated, true);
});

test('linearFindOrCreateIssue throws ORPHAN_ISSUE on repeated attachmentCreate failure', async () => {
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.query.includes('attachmentsForURL')) {
      return { ok: true, status: 200, json: async () => ({ data: { attachmentsForURL: { nodes: [] } } }) };
    }
    if (body.query.includes('issueCreate')) {
      return {
        ok: true, status: 200,
        json: async () => ({ data: { issueCreate: { success: true, issue: { id: 'iss-1', identifier: 'LIN-777' } } } }),
      };
    }
    if (body.query.includes('attachmentCreate')) {
      return { ok: false, status: 500, text: async () => 'down' };
    }
    throw new Error('Unexpected');
  };
  await assert.rejects(
    linearFindOrCreateIssue({
      ctx: {
        canonicalHsUrl: 'https://secure.helpscout.net/conversation/333/44',
        subject: 'S', customer: 'C', ticketNumber: '44',
        hsConvIdLong: '333', hsConvIdShort: '44',
        emails: [], hsCustomerId: null,
      },
      config: {
        linearApiKey: 'x', linearDefaultTeamId: 't-id',
        linearViewerId: 'u-id', linearInProgressStateId: 's-id',
      },
      fetchFn: fakeFetch,
      retryDelayMs: 0,
    }),
    (err) => err.name === 'OrphanIssueError' && err.issueKey === 'LIN-777'
  );
});

test('linearFindOrCreateIssue throws LINEAR_CONFIG_MISSING when config incomplete', async () => {
  await assert.rejects(
    linearFindOrCreateIssue({
      ctx: { canonicalHsUrl: 'https://x/y/z', subject: '', customer: '', ticketNumber: '1',
             hsConvIdLong: '1', hsConvIdShort: '1', emails: [], hsCustomerId: null },
      config: { linearApiKey: 'x', linearDefaultTeamId: '' /* missing */ },
      fetchFn: () => { throw new Error('should not fetch'); },
    }),
    /LINEAR_CONFIG_MISSING/
  );
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/linear.test.js`
Expected: FAIL with `linearFindOrCreateIssue is not a function`.

- [ ] **Step 3: Implement `linearFindOrCreateIssue` in `shared.js`** — a `linearRequest` után:

```javascript
class OrphanIssueError extends Error {
  constructor(issueKey, cause) {
    super(`Orphan Linear issue created (attachment failed): ${issueKey}`);
    this.name = 'OrphanIssueError';
    this.issueKey = issueKey;
    this.cause = cause;
  }
}

async function linearFindOrCreateIssue({ ctx, config, fetchFn, retryDelayMs = 500 }) {
  const { canonicalHsUrl, subject, customer, ticketNumber,
          hsConvIdLong, hsConvIdShort, emails, hsCustomerId } = ctx;
  const { linearApiKey, linearDefaultTeamId, linearViewerId, linearInProgressStateId } = config;

  if (!linearApiKey || !linearDefaultTeamId || !linearViewerId || !linearInProgressStateId) {
    throw new Error('LINEAR_CONFIG_MISSING');
  }

  // 1. Lookup existing
  const lookupQuery = `query($url: String!) {
    attachmentsForURL(url: $url) {
      nodes { issue { id identifier title } }
    }
  }`;
  const lookupData = await linearRequest({
    query: lookupQuery,
    variables: { url: canonicalHsUrl },
    apiKey: linearApiKey,
    fetchFn,
  });
  const existing = lookupData?.attachmentsForURL?.nodes?.[0]?.issue;
  if (existing) {
    return {
      issueKey: existing.identifier,
      issueTitle: existing.title,
      wasCreated: false,
    };
  }

  // 2. Create issue
  const titleSubject = subject || `HS #${hsConvIdShort}`;
  const title = `${titleSubject} [HS: #${hsConvIdShort}]`;
  const description = [
    `**Partner:** ${customer || '—'}`,
    '',
    `[Helpscout conversation](${canonicalHsUrl})`,
  ].join('\n');

  const issueMutation = `mutation($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { id identifier title }
    }
  }`;
  const issueData = await linearRequest({
    query: issueMutation,
    variables: {
      input: {
        teamId: linearDefaultTeamId,
        title,
        description,
        stateId: linearInProgressStateId,
        assigneeId: linearViewerId,
      },
    },
    apiKey: linearApiKey,
    fetchFn,
  });
  const issue = issueData?.issueCreate?.issue;
  if (!issueData?.issueCreate?.success || !issue) {
    throw new Error('Linear issueCreate failed (no success)');
  }

  // 3. Create attachment (with 1 retry)
  const attachmentMutation = `mutation($input: AttachmentCreateInput!) {
    attachmentCreate(input: $input) {
      success
      attachment { id }
    }
  }`;
  const attachmentInput = {
    issueId: issue.id,
    url: canonicalHsUrl,
    title: `Helpscout #${hsConvIdShort}`,
    subtitle: customer || '',
    metadata: {
      source: 'linear-clockify-extension',
      hsConvIdLong,
      hsConvIdShort,
      hsCustomerId: hsCustomerId || null,
      hsCustomerEmails: emails || [],
      hsCustomerName: customer || '',
      createdAt: new Date().toISOString(),
    },
  };

  let attachmentErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const attData = await linearRequest({
        query: attachmentMutation,
        variables: { input: attachmentInput },
        apiKey: linearApiKey,
        fetchFn,
      });
      if (attData?.attachmentCreate?.success) {
        return {
          issueKey: issue.identifier,
          issueTitle: issue.title,
          wasCreated: true,
        };
      }
      attachmentErr = new Error('attachmentCreate returned no success');
    } catch (err) {
      attachmentErr = err;
    }
    if (attempt === 1 && retryDelayMs > 0) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  throw new OrphanIssueError(issue.identifier, attachmentErr);
}
```

Add hozzá az `api`-hoz: `linearFindOrCreateIssue, OrphanIssueError,`.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/linear.test.js`
Expected: PASS all (existing 5 + new 5 = 10 tests).

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/linear.test.js
git commit -m "feat(shared): add linearFindOrCreateIssue with retry + OrphanIssueError"
```

---

### Task 9: Per-conv in-flight lock a background.js-ben

**Files:**
- Modify: `background.js` (új segéd fv + használat)

Ha ugyanaz a user egyszerre két tabból indítja a timert ugyanarra a conv-ra, ne fusson párhuzamosan két `linearFindOrCreateIssue`. Per-`hsConvIdLong` in-flight `Map`-t használunk a service worker memóriájában. Ha a worker restartol, a lock elvész — ez elfogadható (cross-restart race == same as cross-user race).

- [ ] **Step 1: Write a simple test** — a `tests/linear.test.js` végéhez:

```javascript
const { createConvLock } = require('../shared.js');

test('createConvLock dedupes concurrent calls with same key', async () => {
  const lock = createConvLock();
  let callCount = 0;
  const worker = async () => {
    callCount++;
    await new Promise((r) => setTimeout(r, 10));
    return callCount;
  };
  const [a, b] = await Promise.all([
    lock.run('key1', worker),
    lock.run('key1', worker),
  ]);
  assert.strictEqual(a, 1);
  assert.strictEqual(b, 1); // same result, deduped
  assert.strictEqual(callCount, 1);
});

test('createConvLock allows different keys in parallel', async () => {
  const lock = createConvLock();
  let callCount = 0;
  const worker = async () => { callCount++; return callCount; };
  const [a, b] = await Promise.all([
    lock.run('k1', worker),
    lock.run('k2', worker),
  ]);
  assert.strictEqual(callCount, 2);
  assert.notStrictEqual(a, b);
});

test('createConvLock releases after failure', async () => {
  const lock = createConvLock();
  await assert.rejects(lock.run('k', async () => { throw new Error('boom'); }), /boom/);
  const out = await lock.run('k', async () => 42);
  assert.strictEqual(out, 42);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/linear.test.js`
Expected: FAIL with `createConvLock is not a function`.

- [ ] **Step 3: Implement `createConvLock` in `shared.js`** — a `linearFindOrCreateIssue` után:

```javascript
function createConvLock() {
  const inFlight = new Map();
  return {
    async run(key, worker) {
      if (inFlight.has(key)) return inFlight.get(key);
      const promise = (async () => {
        try {
          return await worker();
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, promise);
      return promise;
    },
  };
}
```

Add hozzá az `api`-hoz: `createConvLock,`.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/linear.test.js`
Expected: PASS all (13 tests total).

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/linear.test.js
git commit -m "feat(shared): add createConvLock for in-flight dedup"
```

---

### Task 10: Integrate `linearFindOrCreateIssue` into `startHsTimer`

**Files:**
- Modify: `background.js` (`startHsTimer`, 276-311)

A `startHsTimer` most csak a Clockify felé indít. Ki kell egészíteni egy Linear find-or-create lépéssel a Clockify-hívás előtt, és a description a `[LIN-xxx]` formátumot kapja.

- [ ] **Step 1: Update the top of `background.js`** — a destructuring import (sor 4) egészüljön ki:

```javascript
const { detectTimerSource, computeSnapTime, buildHsDescription, isOverlappingEntry,
        linearRequest, linearFindOrCreateIssue, OrphanIssueError, createConvLock } = self.LCShared;

const convLock = createConvLock();
```

- [ ] **Step 2: Add a Linear config loader helper** — a `getSettings` (sor 11) után, az első `clockifyFetch` (35) előtt:

```javascript
function getLinearConfig(settings) {
  return {
    linearApiKey: settings.linearApiKey || '',
    linearDefaultTeamId: settings.linearDefaultTeamId || '',
    linearViewerId: settings.linearViewerId || '',
    linearInProgressStateId: settings.linearInProgressStateId || '',
  };
}
```

- [ ] **Step 3: Replace `startHsTimer`** — cseréld le a `background.js:276-311`-et:

```javascript
async function startHsTimer(ctx) {
  const { ticketNumber, subject, customer, canonicalHsUrl, emails, hsCustomerId, convId } = ctx;
  const settings = await getSettings();
  const linearConfig = getLinearConfig(settings);

  // Strict: Linear config required to start HS timers.
  if (!linearConfig.linearApiKey || !linearConfig.linearDefaultTeamId ||
      !linearConfig.linearViewerId || !linearConfig.linearInProgressStateId) {
    return { error: 'LINEAR_CONFIG_MISSING' };
  }

  const lockKey = `hsconv:${convId}`;
  let linearResult;
  try {
    linearResult = await convLock.run(lockKey, () => linearFindOrCreateIssue({
      ctx: {
        canonicalHsUrl,
        subject, customer, ticketNumber,
        hsConvIdLong: convId,
        hsConvIdShort: ticketNumber,
        emails: emails || [],
        hsCustomerId: hsCustomerId || null,
      },
      config: linearConfig,
      fetchFn: fetch,
    }));
  } catch (err) {
    if (err instanceof OrphanIssueError) {
      return { error: 'ORPHAN_LINEAR_ISSUE', issueKey: err.issueKey };
    }
    return { error: `Linear: ${err.message}` };
  }

  const { issueKey } = linearResult;
  const projectName = settings.hsProjectName || HS_PROJECT_DEFAULT;
  let projectId = null;
  let warning = null;
  if (projectName) {
    projectId = await resolveProjectId(projectName);
    if (!projectId) warning = `Clockify projekt nem található: ${projectName}`;
  }

  const body = {
    start: await resolveStartTime(),
    description: buildHsDescription({ issueKey, ticketNumber, subject, customer }),
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
    issueKey, // NEW: store so UI can show linear ref
    issueTitle,
    projectName,
    startedAt: body.start,
  };
  await chrome.storage.local.set({ activeTimer });
  updateBadge(activeTimer);

  return { success: true, warning };
}
```

- [ ] **Step 4: Replace `createHsManualEntry`** — cseréld le a `background.js:195-231`-et (a manual entry):

```javascript
async function createHsManualEntry(ctx) {
  const { ticketNumber, subject, customer, canonicalHsUrl, emails, hsCustomerId, convId,
          startISO, endISO, dayStartISO, dayEndISO } = ctx;
  const settings = await getSettings();
  const linearConfig = getLinearConfig(settings);

  if (!linearConfig.linearApiKey || !linearConfig.linearDefaultTeamId ||
      !linearConfig.linearViewerId || !linearConfig.linearInProgressStateId) {
    return { error: 'LINEAR_CONFIG_MISSING' };
  }

  const conflict = await findOverlap(startISO, endISO, dayStartISO, dayEndISO);
  if (conflict) {
    const cs = new Date(conflict.timeInterval.start);
    const ce = conflict.timeInterval.end ? new Date(conflict.timeInterval.end) : null;
    const timeStr = ce ? `${formatHM(cs)}–${formatHM(ce)}` : `${formatHM(cs)}–(fut)`;
    const desc = conflict.description || '(leírás nélkül)';
    return { error: 'OVERLAP', conflictWith: `${desc} @ ${timeStr}` };
  }

  const lockKey = `hsconv:${convId}`;
  let linearResult;
  try {
    linearResult = await convLock.run(lockKey, () => linearFindOrCreateIssue({
      ctx: {
        canonicalHsUrl,
        subject, customer, ticketNumber,
        hsConvIdLong: convId,
        hsConvIdShort: ticketNumber,
        emails: emails || [],
        hsCustomerId: hsCustomerId || null,
      },
      config: linearConfig,
      fetchFn: fetch,
    }));
  } catch (err) {
    if (err instanceof OrphanIssueError) {
      return { error: 'ORPHAN_LINEAR_ISSUE', issueKey: err.issueKey };
    }
    return { error: `Linear: ${err.message}` };
  }

  const { issueKey } = linearResult;
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
    description: buildHsDescription({ issueKey, ticketNumber, subject, customer }),
  };
  if (projectId) body.projectId = projectId;

  await clockifyFetch(
    `/workspaces/${settings.workspaceId}/time-entries`,
    { method: 'POST', body: JSON.stringify(body) }
  );

  return { success: true, warning };
}
```

- [ ] **Step 5: Sanity check — `stopAndStartHsTimer`** — a handler (sor 558-562) már csak meghívja a `stopTimer` + `startHsTimer`-t szekvenciálisan, az új `startHsTimer` átveszi a Linear-logikát. Nem kell módosítani.

- [ ] **Step 6: Run all tests**

Run: `node --test tests/`
Expected: PASS all (nincs regresszió).

- [ ] **Step 7: Manual smoke check (élő teszt, opt-in)**

Ehhez szükséges:
1. Linear API key az options page-en (már van mező)
2. Egy `linearDefaultTeamId`, `linearViewerId`, `linearInProgressStateId` érték a settings-ben (Task 11 után konfigurálható; addig a DevTools console-ból kézzel beállítható):

```javascript
// DevTools console a bármely oldalon, az extension service worker kontextusában:
chrome.storage.local.get('settings', ({ settings }) => {
  chrome.storage.local.set({
    settings: {
      ...settings,
      linearDefaultTeamId: 'YOUR_TEAM_UUID',
      linearViewerId: 'YOUR_USER_UUID',
      linearInProgressStateId: 'YOUR_STATE_UUID',
    }
  });
});
```

A 3 UUID-t az options page / teams dropdown adja majd, de most egy Linear GraphQL query-vel is kinyerhetőek (pl. `linear.app/graphql` playground).

Menj egy HS conv oldalra, kattints Start-ra. Elvárás:
- Új Linear issue a TUL team-ben, state In Progress, self-assigned
- Clockify-ban futó timer `[LIN-xxx] subject — customer` description-nel
- A HS gomb "Stop" állapotba kerül

Hogyha a 3 beállítás hiányzik: a gomb hibát mutat `LINEAR_CONFIG_MISSING`.

- [ ] **Step 8: Commit**

```bash
git add background.js
git commit -m "feat(hs): wrap startHsTimer/createHsManualEntry with Linear find-or-create"
```

---

### Task 11: Options page — teams dropdown + validation

**Files:**
- Modify: `options.html` (új `<select>` + validáló gomb), `options.js`, `background.js` (két új action)

A user-nek választania kell egy default teamet (TUL). Ezt a Linear API-ból lekérdezzük, dropdown-ban megjelenítjük, és save-kor elmentjük a `viewerId`-t és az In-Progress state ID-t is.

- [ ] **Step 1: Add new actions to `background.js`** — a switch-case (sor 535-589) végén, a `default:` előtt adj hozzá:

```javascript
case 'validateLinearConfig': {
  const settings = await getSettings();
  const apiKey = (message.data && message.data.linearApiKey) || settings.linearApiKey;
  if (!apiKey) return { error: 'NO_API_KEY' };
  try {
    const data = await linearRequest({
      query: `query { viewer { id name } teams(first: 100) { nodes { id key name states { nodes { id name type } } } } }`,
      apiKey,
      fetchFn: fetch,
    });
    return {
      success: true,
      viewerId: data.viewer.id,
      viewerName: data.viewer.name,
      teams: data.teams.nodes.map((t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        inProgressStateId: pickInProgressState(t.states.nodes),
      })),
    };
  } catch (err) {
    return { error: err.message };
  }
}
```

És add hozzá a `pickInProgressState` segédet a `getIssueDetails` után (a `getEntriesInRange` előtt, sor ~126):

```javascript
function pickInProgressState(stateNodes) {
  if (!Array.isArray(stateNodes)) return null;
  const byName = stateNodes.find((s) => s.name === 'In Progress');
  if (byName) return byName.id;
  const byType = stateNodes.find((s) => s.type === 'started');
  return byType ? byType.id : null;
}
```

- [ ] **Step 2: Add the dropdown and validate button to `options.html`** — a Linear API key mező után (a `<h2>Linear API</h2>` szekció `<input id="linearApiKey">` után):

```html
<button type="button" id="linearValidate" class="btn">🔎 Linear teszt</button>
<div id="linearStatus" class="status" style="display:none;"></div>

<label for="linearDefaultTeam" style="margin-top:12px;">Alapértelmezett Team (HS issue-khoz)</label>
<select id="linearDefaultTeam">
  <option value="">— Tölts ki és kattints Linear tesztre —</option>
</select>
```

- [ ] **Step 3: Update `options.js`** — a DEFAULT_SETTINGS (sor 5-22) kiegészítése:

```javascript
const DEFAULT_SETTINGS = {
  apiKey: '',
  linearApiKey: '',
  linearDefaultTeamId: '',
  linearViewerId: '',
  linearInProgressStateId: '',
  workspaceId: DEFAULT_WORKSPACE_ID,
  autoStop: false,
  teamMapping: {
    GG: 'Cég működése', MAN: 'Management', SAL: 'Sales', IT: 'IT',
    FIN: 'Pénzügy', HR: 'HR', KOM: 'Kommunikáció és Vendégek',
    LBE: 'Lakásindítás', TUL: 'Lakások és Tulajok', LM: 'Lakásmenedzserek',
  },
};
```

A `render()` függvényben (sor 29-38) add hozzá a dropdown feltöltést a végére:

```javascript
async function render() {
  const settings = await loadSettings();
  document.getElementById('apiKey').value = settings.apiKey || '';
  document.getElementById('linearApiKey').value = settings.linearApiKey || '';
  document.getElementById('workspaceId').value = settings.workspaceId || DEFAULT_SETTINGS.workspaceId;
  document.getElementById('autoStop').checked = settings.autoStop || false;

  // Restore team dropdown if a team was already selected
  const sel = document.getElementById('linearDefaultTeam');
  if (settings.linearDefaultTeamId) {
    const opt = document.createElement('option');
    opt.value = settings.linearDefaultTeamId;
    opt.textContent = '(mentett — kattints Linear teszt-re frissítéshez)';
    opt.selected = true;
    sel.appendChild(opt);
  }

  renderMappingTable(settings.teamMapping || DEFAULT_SETTINGS.teamMapping);
}
```

Add hozzá egy új event handler-t a file alján (a `render()` hívás elé vagy után):

```javascript
document.getElementById('linearValidate').addEventListener('click', async () => {
  const statusEl = document.getElementById('linearStatus');
  statusEl.style.display = 'block';
  statusEl.className = 'status';
  statusEl.textContent = 'Kapcsolódás Linear-hez…';

  const apiKey = document.getElementById('linearApiKey').value.trim();
  if (!apiKey) {
    statusEl.className = 'status error';
    statusEl.textContent = 'Add meg a Linear API key-t előbb.';
    return;
  }

  const result = await chrome.runtime.sendMessage({
    action: 'validateLinearConfig',
    data: { linearApiKey: apiKey },
  });

  if (result.error) {
    statusEl.className = 'status error';
    statusEl.textContent = `Hiba: ${result.error}`;
    return;
  }

  statusEl.className = 'status';
  statusEl.textContent = `✓ Bejelentkezve mint ${result.viewerName} — ${result.teams.length} team elérhető.`;

  // Populate dropdown
  const sel = document.getElementById('linearDefaultTeam');
  sel.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— Válassz egy team-et —';
  sel.appendChild(placeholder);

  const currentSettings = await loadSettings();
  for (const team of result.teams) {
    const opt = document.createElement('option');
    opt.value = team.id;
    opt.dataset.inProgressStateId = team.inProgressStateId || '';
    opt.textContent = `${team.key} — ${team.name}`;
    if (team.id === currentSettings.linearDefaultTeamId) opt.selected = true;
    sel.appendChild(opt);
  }

  // Stash viewerId for save-time use
  sel.dataset.viewerId = result.viewerId;
});
```

Módosítsd a `save` handler-t (sor 109-121):

```javascript
document.getElementById('save').addEventListener('click', async () => {
  const sel = document.getElementById('linearDefaultTeam');
  const chosen = sel.options[sel.selectedIndex];
  const linearDefaultTeamId = sel.value || '';
  const linearInProgressStateId = chosen?.dataset?.inProgressStateId || '';
  const linearViewerId = sel.dataset.viewerId || '';

  const settings = {
    apiKey: document.getElementById('apiKey').value.trim(),
    linearApiKey: document.getElementById('linearApiKey').value.trim(),
    linearDefaultTeamId,
    linearViewerId,
    linearInProgressStateId,
    workspaceId: document.getElementById('workspaceId').value.trim() || DEFAULT_SETTINGS.workspaceId,
    autoStop: document.getElementById('autoStop').checked,
    teamMapping: collectMapping(),
  };

  await chrome.storage.local.set({ settings });
  await chrome.storage.local.remove(['projectCache', 'userId']);
  showStatus('\u2705 Beállítások mentve');
});
```

Mentsd meg és tölts be az options oldalt.

- [ ] **Step 4: Manual smoke test**

1. Nyisd meg az options oldalt (`chrome://extensions` → Linear → Clockify → Details → Extension options).
2. Írj be egy Linear API key-t, kattints "🔎 Linear teszt".
3. Elvárás: a dropdown feltöltődik a teameiddel. Válaszd a TUL-t.
4. Kattints Save.
5. Nyisd meg a DevTools console-t (options page), futtasd:
   ```javascript
   chrome.storage.local.get('settings').then(({ settings }) =>
     console.log({
       teamId: settings.linearDefaultTeamId,
       viewerId: settings.linearViewerId,
       stateId: settings.linearInProgressStateId,
     })
   );
   ```
6. Mind a 3 érték legyen UUID-szerű string (nem üres).

Ha nem működik: ellenőrizd a background service worker console-t (`chrome://extensions` → background page / service worker inspect) — a Linear API-hívás log-jai ott jelennek meg.

- [ ] **Step 5: Commit**

```bash
git add options.html options.js background.js
git commit -m "feat(options): Linear validate button + default team dropdown"
```

---

### Task 12: Error messages — user-visible strings a HS content script-ben

**Files:**
- Modify: `hs-content.js` (error display)

A hs-content.js `showHsError` függvénye jelenleg csak `NO_API_KEY`-t kezel specifikusan (HS Clockify key hiánya). Ki kell egészíteni az új Linear-hibák (`LINEAR_CONFIG_MISSING`, `ORPHAN_LINEAR_ISSUE`, `Linear: ...`) magyar üzeneteire.

- [ ] **Step 1: Find and update `showHsError`** — a `hs-content.js:150` környékén (a `showHsError` függvény). Cseréld le a teljes függvényt:

```javascript
function showHsError(message, extra = {}) {
  const info = document.getElementById('lc-hs-info');
  if (!info) return;
  info.style.display = 'inline';
  info.textContent = '';

  if (message === 'NO_API_KEY') {
    info.appendChild(createSettingsLink());
    return;
  }
  if (message === 'LINEAR_CONFIG_MISSING') {
    const span = document.createElement('span');
    span.textContent = 'Állítsd be a Linear integrációt: ';
    info.appendChild(span);
    info.appendChild(createSettingsLink());
    return;
  }
  if (message === 'ORPHAN_LINEAR_ISSUE') {
    const span = document.createElement('span');
    span.textContent = `Árva Linear issue létrejött (${extra.issueKey || '?'}). Ellenőrizd Linear-ben, vagy próbáld újra.`;
    info.appendChild(span);
    return;
  }
  // Generic string-based errors (e.g. "Linear: LINEAR_AUTH")
  info.textContent = message;
}
```

- [ ] **Step 2: Pass `extra` from click handler** — a `hs-content.js:118, 126, 135` sorokban az `if (result.error) showHsError(result.error)` után add hozzá a rest-et:

```javascript
if (result.error) showHsError(result.error, { issueKey: result.issueKey });
```

Mindhárom helyen (a 3 `if (result.error)` sor). Keresd meg őket:

Run: `grep -n 'showHsError(result.error)' hs-content.js`

Minden találatnál cseréld a fentire.

- [ ] **Step 3: Update the manual entry submit handler similarly** — a `hs-content.js:393` környékén az `attachManualEntrySubmit` callbackje. Jelenleg `setStatus(status, 'error', result.error)` stílusban jelzi. Nincs is `showHsError` hívás itt — a shared.js `attachManualEntrySubmit` bele van kódolva `NO_API_KEY`-re. Bővítsük a `shared.js` belső error mappingját a `LINEAR_CONFIG_MISSING`-re és `ORPHAN_LINEAR_ISSUE`-ra:

A `shared.js:491-494` rész (a `setStatus(status, 'error', 'Beállítás szükséges')`) cseréld le:

```javascript
} else if (result?.error === 'NO_API_KEY') {
  setStatus(status, 'error', 'Beállítás szükséges (Clockify)');
} else if (result?.error === 'LINEAR_CONFIG_MISSING') {
  setStatus(status, 'error', 'Beállítás szükséges (Linear)');
} else if (result?.error === 'ORPHAN_LINEAR_ISSUE') {
  setStatus(status, 'error', `Árva Linear issue: ${result.issueKey}. Ellenőrizd Linear-ben.`);
} else if (result?.error) {
```

- [ ] **Step 4: Manual smoke test**

1. Távolítsd el a `linearDefaultTeamId`-t a settings-ből:
   ```javascript
   chrome.storage.local.get('settings').then(({ settings }) => {
     const next = { ...settings, linearDefaultTeamId: '' };
     chrome.storage.local.set({ settings: next });
   });
   ```
2. Menj egy HS conv oldalra, kattints Start.
3. Elvárás: az info mezőben magyar üzenet és egy beállítások-link jelenik meg.
4. Kattints a linkre → options page megnyílik.
5. Állítsd vissza a beállítást, teszteld újra a happy path-t.

- [ ] **Step 5: Commit**

```bash
git add shared.js hs-content.js
git commit -m "feat(hs): user-friendly error messages for Linear config + orphan issue"
```

---

### Task 13: End-to-end manual test checklist

Ez nem kódolás — ez egy dokumentált manuális QA szekvencia, amit futtatni kell a release előtt. Adj hozzá a `docs/TELEPITES.md`-hez egy új szekciót "Linear integráció tesztelés".

**Files:**
- Modify: `docs/TELEPITES.md` (új szekció a fájl végére)

- [ ] **Step 1: Add QA checklist** — fűzd a `docs/TELEPITES.md` fájl végéhez:

```markdown

## Linear integráció tesztelés (manual QA)

### Setup
- [ ] Linear API key a linear.app/settings/api-ból generálva
- [ ] Options page → Linear API key beírva → "🔎 Linear teszt" zöld visszajelzést ad
- [ ] TUL team kiválasztva a dropdown-ból
- [ ] Save → "Beállítások mentve"

### Happy path — új conv
- [ ] Menj egy olyan HS conv-re, amire még nem indítottál timert
- [ ] Kattints ▶ Start
- [ ] Linear-ben: új issue a TUL-ban, In Progress, téged assignolt, title = `{subject} [HS: #{short}]`, description-ben partner név + HS link
- [ ] Linear issue sidebarján: Helpscout attachment a conv URL-jével
- [ ] Clockify-ban: futó timer `[LIN-xxx] {subject} — {customer}` leírással
- [ ] HS oldalon: a gomb Stop-ra vált, a header/card-ban LIN-xxx látszik

### Happy path — meglévő conv
- [ ] Kattints ▶ Start újra ugyanazon a conv-n
- [ ] Linear-ben: **ugyanaz** az issue (nem új), a Clockify ugyanazt a LIN-xxx-t kapja

### Manual entry
- [ ] Friss HS conv, töltsd ki a "Mettől – Meddig" mezőket, kattints Rögzít
- [ ] Clockify-ban: historikus entry `[LIN-xxx] ...` leírással
- [ ] Linear-ben: az issue is létrejött (attachment-tel)

### Config hiány
- [ ] Töröld a `linearDefaultTeamId`-t a DevTools-ból
- [ ] Start gombra → "Állítsd be a Linear integrációt" + link az options-ra
- [ ] Clockify timer NEM indult
- [ ] Állítsd vissza, happy path újra működik

### Állapot megőrzés (ha egyszer már létezik)
- [ ] Egy meglévő issue-t kézzel zárj le Linear-ben (state = Done)
- [ ] Kattints újra Start-ra a HS conv-n
- [ ] Linear-ben: az issue marad Done-ban (**nem** kerül vissza In Progress-be) — manuálisan kell reopen-elned

### Konfig reset
- [ ] "Reset" gomb az options-on → Linear beállítások eltűnnek
- [ ] HS Start → config-missing hiba (elvárt)
```

- [ ] **Step 2: Commit**

```bash
git add docs/TELEPITES.md
git commit -m "docs: manual QA checklist for Linear integration"
```

---

### Task 14: Final integration run — all tests green

- [ ] **Step 1: Run full test suite**

Run: `node --test tests/`
Expected: PASS all. Meghatározott minimális teszt-count:
- `tests/shared.test.js` — eredeti tesztek + 3 új URL-canonicalize + 4 új email-parse + 4 új customerId-parse + 5 új buildHsDescription + 1 detectTimerSource doc = ~17 új test
- `tests/linear.test.js` — 5 linearRequest + 5 linearFindOrCreateIssue + 3 createConvLock = 13 test

Ha bármelyik bukik: menj vissza a megfelelő task-ra, javítsd, ne lépj tovább.

- [ ] **Step 2: Coverage check**

Run: `node --experimental-test-coverage --test tests/`
Expected: coverage ≥ 80% a `shared.js`-re.

**Ha < 80%**: nézd meg melyik ágak nincsenek tesztelve (pl. edge case-ek a `buildHsDescription` HS-fallback-ben). Adj hozzá célzott teszteket.

- [ ] **Step 3: Lint-style scan (manual)**

Nincs ESLint a projektben. Kézi scan:
- Run: `grep -n 'console\.log' shared.js` — van-e új `console.log` a shared.js-ben? Ha igen: távolítsd el vagy mozgasd `background.js`-be. A shared.js-nek pure-nek kell maradnia.
- Run: `grep -n 'TODO\|FIXME\|XXX' shared.js background.js hs-content.js options.js`
Expected: nincs új TODO/FIXME.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: test coverage + lint cleanups"
```

- [ ] **Step 5: Create release-ready zip (optional)**

Run: `./build-zip.sh`
Expected: `linear-clockify.zip` frissítve a repo gyökerében.

---

## Self-Review Results

**Spec coverage check:**
- ✅ DOM parse (URL, emails, customer ID, name) — Task 1-3, 6
- ✅ Lookup → Create flow — Task 7, 8
- ✅ Per-conv lock — Task 9
- ✅ Clockify description `[LIN-xxx]` — Task 4
- ✅ detectTimerSource behavior — Task 5
- ✅ `buildHsDescription` — Task 4
- ✅ Options page team dropdown + validation — Task 11
- ✅ Config-missing strict blocking — Task 10 (startHsTimer), Task 12 (UI)
- ✅ Partial mutation retry + OrphanIssueError — Task 8
- ✅ Manual entry uses same flow — Task 10 (createHsManualEntry)
- ✅ Tests + QA — Task 13, 14

**Placeholder scan:**
- No TBD, TODO, "implement later" strings in the plan.
- All code blocks complete.

**Type consistency:**
- `issueKey` (not `issueIdentifier`, `issueKey`, or `linearId`) used consistently throughout.
- `linearFindOrCreateIssue` contract: `{ issueKey, issueTitle, wasCreated }` — consistent in Task 8 and callers in Task 10.
- `ctx` object shape: `{ convId, ticketNumber, subject, customer, canonicalHsUrl, emails, hsCustomerId, ... }` — consistent from `getConversationContext` (Task 6) through `startHsTimer` / `createHsManualEntry` (Task 10).
- Error names: `LINEAR_CONFIG_MISSING`, `ORPHAN_LINEAR_ISSUE`, `LINEAR_AUTH`, `LINEAR_RATE_LIMIT`, `LINEAR_NO_API_KEY` — all consistent.

**Out-of-scope preservation:**
- No `customerUpsert` or `customerNeedCreate` anywhere in the plan.
- No AI summary.
- No cron / server code.
- No historic Clockify description migration.

Plan is complete and internally consistent.
