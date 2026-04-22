# Stop & Done Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Stop & Done" gomb a HelpScout sidebar-be és az extension popup-ba, ami leállítja a futó Clockify timert és a kapcsolódó Linear issue-t `Done` state-re állítja. A korábbi `Stop & Start` compound action megszűnik.

**Architecture:** Két új pure helper a `shared.js`-ben (tesztelhető), két új service-worker funkció a `background.js`-ben (`resolveLinearDoneStateId` lazy cache-sel + `markLinearIssueDone`), új message action `stopAndDoneTimer`. HS content script és popup két gombot renderel `stop`/`switch` állapotban.

**Tech Stack:** Vanilla JavaScript, Chrome Extension Manifest V3, Node built-in test runner (`node --test`). Nincs build step.

**Design Spec:** [docs/superpowers/specs/2026-04-22-stop-and-done-design.md](../specs/2026-04-22-stop-and-done-design.md)

---

## File structure

| Fájl | Mi történik |
|---|---|
| `shared.js` | Új `parseTeamKeyFromIssueKey` + `pickCompletedState` pure helper-ek; exportálva az API-ba. |
| `tests/shared.test.js` | Új unit tesztek a fenti két helper-hez. |
| `background.js` | Új `resolveLinearDoneStateId`, `markLinearIssueDone`, `stopAndDoneTimer` action handler. A `stopAndStartHsTimer` action **törlődik**. |
| `hs-content.js` | `createHsTimerButton` és `createHsRightPanelCard` egy helyett **két** gombot renderel; `applyHsButtonState` frissítve; új `handleHsDoneButtonClick`; a `handleHsButtonClick` `switch` ága törlődik (mert már nincs `stopAndStartHsTimer`). |
| `popup.js` | Új secondary gomb render: `Stop & Done`, csak ha `activeTimer.issueKey && !external`. |
| `popup.html` | Új `.done-btn` CSS a `.stop-btn` mintájára. |
| `styles.css` | Új `.lc-btn-done` osztály HS sidebar-hoz. |

---

## Task 1: `parseTeamKeyFromIssueKey` helper + tesztek

**Files:**
- Modify: `shared.js` — új pure function a HS parsing szekció után (kb. sor 155 körül, az `HS_CONV_URL_RE` előtt)
- Modify: `shared.js:807-833` — exportálja az új függvényt
- Modify: `tests/shared.test.js` — új tesztblokk a fájl végén

- [ ] **Step 1: Írj bukó tesztet a `parseTeamKeyFromIssueKey`-re**

Nyisd meg `tests/shared.test.js`-t és a fájl végére add hozzá:

```javascript
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
  // Linear team keys are uppercase by convention; accept lowercase defensively
  // and normalize so that downstream team-key lookups (teamMapping etc.) hit.
  assert.strictEqual(parseTeamKeyFromIssueKey('tul-14'), 'TUL');
});
```

- [ ] **Step 2: Futtasd, bukjon**

Run: `node --test tests/shared.test.js`
Expected: 3 új teszt bukik — `parseTeamKeyFromIssueKey is not a function`.

- [ ] **Step 3: Implementáld a `shared.js`-ben**

Nyisd meg `shared.js`-t. Keresd meg a HS parsing szekciót (`// ─── HelpScout parsing ─────`) és **utána** add hozzá:

```javascript
  // ─── Linear issue key parsing ───────────────────────────────────────────

  function parseTeamKeyFromIssueKey(issueKey) {
    if (typeof issueKey !== 'string' || !issueKey) return null;
    const m = issueKey.match(/^([A-Za-z]+)-(\d+)$/);
    if (!m) return null;
    return m[1].toUpperCase();
  }
```

Majd a `const api = {` blokkban (kb. sor 807) add hozzá a kulcsot (ABC sorrendben nem szigorú, az `OrphanIssueError` alatt helyezd el):

```javascript
    parseTeamKeyFromIssueKey,
```

- [ ] **Step 4: Futtasd újra, menjen zöldre**

Run: `node --test tests/shared.test.js`
Expected: minden teszt zölden átmegy.

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/shared.test.js
git commit -m "feat(shared): parseTeamKeyFromIssueKey helper"
```

---

## Task 2: `pickCompletedState` helper + tesztek

**Files:**
- Modify: `shared.js` — új pure function a Linear szekcióban (közvetlenül a `linearFindOrCreateIssue` előtt)
- Modify: `shared.js:807-833` — exportálja az új függvényt
- Modify: `tests/shared.test.js` — új tesztblokk

- [ ] **Step 1: Írj bukó tesztet**

Add hozzá `tests/shared.test.js` végéhez:

```javascript
// ─── pickCompletedState ──────────────────────────────────────────────────

const { pickCompletedState } = require('../shared.js');

test('pickCompletedState prefers state named "Done"', () => {
  const states = [
    { id: 's1', name: 'Completed', type: 'completed' },
    { id: 's2', name: 'Done',      type: 'completed' },
    { id: 's3', name: 'Shipped',   type: 'completed' },
  ];
  assert.strictEqual(pickCompletedState(states), 's2');
});

test('pickCompletedState falls back to first state of type "completed"', () => {
  const states = [
    { id: 's1', name: 'Backlog',  type: 'backlog' },
    { id: 's2', name: 'Shipped',  type: 'completed' },
    { id: 's3', name: 'Archived', type: 'completed' },
  ];
  assert.strictEqual(pickCompletedState(states), 's2');
});

test('pickCompletedState returns null when no completed state present', () => {
  const states = [
    { id: 's1', name: 'Backlog',   type: 'backlog' },
    { id: 's2', name: 'Todo',      type: 'unstarted' },
    { id: 's3', name: 'Cancelled', type: 'canceled' },
  ];
  assert.strictEqual(pickCompletedState(states), null);
});

test('pickCompletedState returns null on non-array input', () => {
  assert.strictEqual(pickCompletedState(null), null);
  assert.strictEqual(pickCompletedState(undefined), null);
  assert.strictEqual(pickCompletedState({}), null);
});
```

- [ ] **Step 2: Futtasd, bukjon**

Run: `node --test tests/shared.test.js`
Expected: 4 új teszt bukik — `pickCompletedState is not a function`.

- [ ] **Step 3: Implementáld a `shared.js`-ben**

`shared.js`-ben, a Linear szekcióban (`// ─── Linear: find-or-create issue` előtt, kb. sor 228) szúrd be:

```javascript
  // ─── Linear state picker ────────────────────────────────────────────────

  function pickCompletedState(stateNodes) {
    if (!Array.isArray(stateNodes)) return null;
    const byName = stateNodes.find(
      (s) => s && s.type === 'completed' && s.name === 'Done'
    );
    if (byName) return byName.id;
    const byType = stateNodes.find((s) => s && s.type === 'completed');
    return byType ? byType.id : null;
  }
```

És az `api` blokkba add hozzá:

```javascript
    pickCompletedState,
```

- [ ] **Step 4: Futtasd, menjen zöldre**

Run: `node --test tests/shared.test.js`
Expected: összes teszt zöld.

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/shared.test.js
git commit -m "feat(shared): pickCompletedState helper with Done-name preference"
```

---

## Task 3: `resolveLinearDoneStateId` a `background.js`-ben

**Files:**
- Modify: `background.js:3-6` — importálja az új helper-eket a shared-ből
- Modify: `background.js` — új függvény a `getIssueDetails` (sor 136) és `pickInProgressState` (sor 171) köré csoportosítva

- [ ] **Step 1: Bővítsd a shared import-ot a `background.js` tetején**

`background.js:3-6` jelenleg:

```javascript
const { detectTimerSource, computeSnapTime, buildHsDescription, isOverlappingEntry,
        linearRequest, linearFindOrCreateIssue, OrphanIssueError, createConvLock } = self.LCShared;
```

Cseréld le:

```javascript
const { detectTimerSource, computeSnapTime, buildHsDescription, isOverlappingEntry,
        linearRequest, linearFindOrCreateIssue, OrphanIssueError, createConvLock,
        parseTeamKeyFromIssueKey, pickCompletedState } = self.LCShared;
```

- [ ] **Step 2: Implementáld a `resolveLinearDoneStateId`-t**

`background.js`-ben a `pickInProgressState` függvény **után** (sor 177 környékén) szúrd be:

```javascript
async function resolveLinearDoneStateId(teamKey) {
  if (!teamKey) return null;
  const settings = await getSettings();
  if (!settings.linearApiKey) return null;

  const stored = await chrome.storage.local.get('linearDoneStateByTeam');
  const cache = stored.linearDoneStateByTeam || {};
  if (cache[teamKey]) return cache[teamKey];

  const query = `query($teamKey: String!) {
    teams(filter: { key: { eq: $teamKey } }, first: 1) {
      nodes { id states { nodes { id name type } } }
    }
  }`;

  console.log('[LC BG] linear → done state', teamKey);
  const data = await linearRequest({
    query,
    variables: { teamKey },
    apiKey: settings.linearApiKey,
    fetchFn: fetch,
  });
  const team = data?.teams?.nodes?.[0];
  if (!team) return null;
  const stateId = pickCompletedState(team.states?.nodes || []);
  if (!stateId) return null;

  cache[teamKey] = stateId;
  await chrome.storage.local.set({ linearDoneStateByTeam: cache });
  return stateId;
}
```

- [ ] **Step 3: Nincs külön teszt (`chrome.storage` + `fetch` függőségek)**

A pure részt (`pickCompletedState`) a Task 2 fedi. A `resolveLinearDoneStateId` cache + HTTP integráció manuális QA-ban lesz ellenőrizve a Task 13-ban.

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat(bg): resolveLinearDoneStateId with per-team cache"
```

---

## Task 4: `markLinearIssueDone` a `background.js`-ben

**Files:**
- Modify: `background.js` — új függvény a `resolveLinearDoneStateId` után

- [ ] **Step 1: Implementáció**

A `resolveLinearDoneStateId` után szúrd be:

```javascript
async function markLinearIssueDone(issueKey) {
  if (!issueKey) return { error: 'NO_ISSUE_KEY' };
  const teamKey = parseTeamKeyFromIssueKey(issueKey);
  if (!teamKey) return { error: `Érvénytelen issue key: ${issueKey}` };

  const settings = await getSettings();
  const linearConfig = getLinearConfig(settings);
  if (!isLinearConfigComplete(linearConfig)) {
    return { error: 'LINEAR_CONFIG_MISSING' };
  }

  const match = issueKey.match(/^([A-Za-z]+)-(\d+)$/);
  if (!match) return { error: `Érvénytelen issue key: ${issueKey}` };
  const issueNumber = Number(match[2]);

  let stateId;
  try {
    stateId = await resolveLinearDoneStateId(teamKey);
  } catch (err) {
    return { error: `Linear Done state lookup: ${err.message}` };
  }
  if (!stateId) {
    return { error: `Linear 'Done' state nem található a(z) ${teamKey} team-hez` };
  }

  // Issue ID lookup (kell az issueUpdate-hez, a mutation "String!" ID-t vár)
  const lookupQuery = `query($teamKey: String!, $number: Float!) {
    issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }, first: 1) {
      nodes { id }
    }
  }`;
  let issueId;
  try {
    const lookupData = await linearRequest({
      query: lookupQuery,
      variables: { teamKey, number: issueNumber },
      apiKey: settings.linearApiKey,
      fetchFn: fetch,
    });
    issueId = lookupData?.issues?.nodes?.[0]?.id;
  } catch (err) {
    return { error: `Linear issue lookup: ${err.message}` };
  }
  if (!issueId) return { error: `Linear issue nem található: ${issueKey}` };

  const mutation = `mutation($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) { success }
  }`;
  try {
    const updateData = await linearRequest({
      query: mutation,
      variables: { id: issueId, input: { stateId } },
      apiKey: settings.linearApiKey,
      fetchFn: fetch,
    });
    if (!updateData?.issueUpdate?.success) {
      return { error: 'Linear issueUpdate nem járt sikerrel' };
    }
    return { success: true };
  } catch (err) {
    return { error: `Linear issueUpdate: ${err.message}` };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat(bg): markLinearIssueDone with per-team Done state resolution"
```

---

## Task 5: Új `stopAndDoneTimer` action; régi `stopAndStartHsTimer` törlése

**Files:**
- Modify: `background.js:605-624` — `switch` blokk a message listener-ben

- [ ] **Step 1: Nyisd meg `background.js`-t és keresd meg a `chrome.runtime.onMessage.addListener` `switch (message.action)` blokkját**

A jelenlegi blokk tartalmazza ezeket az ágakat:
- `'stopAndStartTimer'` (Linear content.js-hez) — **marad**
- `'stopAndStartHsTimer'` — **törölni**
- Új ág kell: `'stopAndDoneTimer'`

- [ ] **Step 2: Töröld a `stopAndStartHsTimer` ágat**

A `background.js:618-621` blokkot (vagy megfelelő sorokat) töröld:

```javascript
case 'stopAndStartHsTimer': {
  await stopTimer();
  return await startHsTimer(message.data);
}
```

- [ ] **Step 3: Add hozzá az új `stopAndDoneTimer` ágat**

A törölt helyre szúrd be:

```javascript
case 'stopAndDoneTimer': {
  const { activeTimer } = await chrome.storage.local.get('activeTimer');
  if (!activeTimer) {
    return { success: true, warning: 'Nem volt futó timer' };
  }
  const issueKey = activeTimer.issueKey || null;
  const isExternal = !!activeTimer.external;

  await stopTimer();

  if (!issueKey || isExternal) {
    return {
      success: true,
      warning: isExternal
        ? 'Külső timer: Linear state nem frissült'
        : 'Ismeretlen issue: Linear state nem frissült',
    };
  }

  const done = await markLinearIssueDone(issueKey);
  if (done.error) {
    return { success: true, warning: `Linear Done sikertelen: ${done.error}` };
  }
  return { success: true };
}
```

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat(bg): stopAndDoneTimer action; remove stopAndStartHsTimer"
```

---

## Task 6: CSS `.lc-btn-done` + `.lc-btn-stop-with-done` layout

**Files:**
- Modify: `styles.css:31-33` — új button variant

- [ ] **Step 1: Add hozzá `styles.css:33` utáni sorokhoz**

```css
.lc-btn-done { background-color: #059669; }
.lc-btn-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
```

Ellenőrzéshez: `styles.css` sor 31-34 így nézzen ki:

```css
.lc-btn-start { background-color: #22c55e; }
.lc-btn-stop { background-color: #ef4444; }
.lc-btn-switch { background-color: #eab308; color: #1a1a1a; }
.lc-btn-done { background-color: #059669; }
.lc-btn-group { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
```

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "feat(styles): lc-btn-done variant + lc-btn-group layout"
```

---

## Task 7: HS sidebar — handler függvények + `handleHsButtonClick` egyszerűsítése

**Files:**
- Modify: `hs-content.js:105-152` — `handleHsButtonClick`
- Modify: `hs-content.js` — új `handleHsDoneButtonClick` függvény hozzáadva

A handler-eket **a render task előtt** definiáljuk, mert a render-ben az `addEventListener` már szimbólum-referenciát kér.

- [ ] **Step 1: Egyszerűsítsd a `handleHsButtonClick`-et**

A jelenlegi `handleHsButtonClick` 3 ágú (stop / switch / start). Most a `switch` ág (másik ticketen futó timer) **csak Stop-ot** végez — az új timer indítása külön kattintás lesz. Az `else if (activeTimer && !activeTimer.external)` ág törlődik.

Cseréld le a `hs-content.js:105-152` tartalmát (a teljes `handleHsButtonClick` függvényt):

```javascript
async function handleHsButtonClick(event) {
  const ctx = getConversationContext();
  if (!ctx) return;

  const button = event?.currentTarget || document.getElementById('lc-hs-timer-button');
  const originalText = button.textContent;
  button.disabled = true;

  try {
    const { activeTimer } = await chrome.storage.local.get('activeTimer');
    console.log('[LC HS] click', { buttonId: button.id, ticketNumber: ctx.ticketNumber, activeTimer });

    const isRunningHere = activeTimer && activeTimer.source === 'hs' &&
                          activeTimer.ticketNumber === ctx.ticketNumber && !activeTimer.external;
    const isRunningElsewhere = activeTimer && !activeTimer.external && !isRunningHere;

    if (isRunningHere || isRunningElsewhere) {
      button.textContent = '⏳ Stopping…';
      const result = await chrome.runtime.sendMessage({ action: 'stopTimer' });
      console.log('[LC HS] stopTimer ←', result);
      if (result.error) showHsError(result.error, { issueKey: result.issueKey });
    } else {
      button.textContent = '⏳ Starting…';
      const result = await chrome.runtime.sendMessage({
        action: 'startHsTimer',
        data: ctx,
      });
      console.log('[LC HS] startHsTimer ←', result);
      if (result.error) showHsError(result.error, { issueKey: result.issueKey });
      if (result.warning) showHsWarning(result.warning);
    }
  } catch (err) {
    console.error('[LC HS] click error', err);
    showHsError(err.message);
    button.textContent = originalText;
  } finally {
    button.disabled = false;
  }
}
```

- [ ] **Step 2: Add hozzá az új `handleHsDoneButtonClick`-et a `handleHsButtonClick` után**

```javascript
async function handleHsDoneButtonClick(event) {
  const button = event?.currentTarget;
  if (!button) return;
  const originalText = button.textContent;
  button.disabled = true;

  try {
    button.textContent = '⏳ Stopping…';
    const result = await chrome.runtime.sendMessage({ action: 'stopAndDoneTimer' });
    console.log('[LC HS] stopAndDoneTimer ←', result);
    if (result.error) showHsError(result.error);
    else if (result.warning) showHsWarning(result.warning);
  } catch (err) {
    console.error('[LC HS] done click error', err);
    showHsError(err.message);
    button.textContent = originalText;
  } finally {
    button.disabled = false;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add hs-content.js
git commit -m "feat(hs): handleHsDoneButtonClick; drop stopAndStart compound"
```

---

## Task 8: HS sidebar — render a második Done gombot

**Files:**
- Modify: `hs-content.js:43-103` — `createHsTimerButton`
- Modify: `hs-content.js:332-454` — `createHsRightPanelCard`

- [ ] **Step 1: Bővítsd ki a `createHsTimerButton`-t**

A jelenlegi gomb-felépítési blokkban (`const button = document.createElement('button'); ... button.textContent = '▶ Start';`, kb. sor 60-64) **után** és az `elapsed` span előtt szúrj be egy második gombot:

```javascript
  const doneButton = document.createElement('button');
  doneButton.id = 'lc-hs-timer-done-button';
  doneButton.className = 'lc-btn lc-btn-done';
  doneButton.textContent = '✓ Stop & Done';
  doneButton.style.display = 'none';
```

Majd a `container.appendChild(button);` **után** (sor 80 környékén) szúrd be:

```javascript
  container.appendChild(doneButton);
```

A click handler kötést is add hozzá a fájl végén az `updateHsButtonState();` hívás **előtt** (sor 101-102 környékén, a `button.addEventListener('click', handleHsButtonClick);` sor után):

```javascript
  doneButton.addEventListener('click', handleHsDoneButtonClick);
```

- [ ] **Step 2: Bővítsd ki a `createHsRightPanelCard`-ot**

A card render-ben (`const button = document.createElement('button'); ... button.textContent = '▶ Start';`, kb. sor 360-363) **után** szúrj be:

```javascript
  const doneButton = document.createElement('button');
  doneButton.type = 'button';
  doneButton.id = 'lc-hs-card-timer-done-button';
  doneButton.className = 'lc-btn lc-btn-done';
  doneButton.textContent = '✓ Stop & Done';
  doneButton.style.display = 'none';
```

A `timerRow.appendChild(button);` **után** (sor 387 környékén) szúrd be:

```javascript
  timerRow.appendChild(doneButton);
```

A fájl végén (`button.addEventListener('click', handleHsButtonClick);`, sor 452 környéke) **után** szúrd be:

```javascript
  doneButton.addEventListener('click', handleHsDoneButtonClick);
```

- [ ] **Step 3: Commit**

```bash
git add hs-content.js
git commit -m "feat(hs): render Stop & Done buttons (hidden by default)"
```

---

## Task 9: HS sidebar — `applyHsButtonState` frissítés a Done gombra

**Files:**
- Modify: `hs-content.js:193-224` — `applyHsButtonState`
- Modify: `hs-content.js:229-299` — `updateHsButtonState` iteráció

- [ ] **Step 1: Bővítsd az `updateHsButtonState` gomb-regisztert a Done gombokkal + Linear config check**

A jelenlegi `buttons` tömb (sor 233-244) csak a primary gombokat tartalmazza. Cseréld le:

```javascript
  const buttons = [
    {
      button: document.getElementById('lc-hs-timer-button'),
      doneButton: document.getElementById('lc-hs-timer-done-button'),
      elapsed: document.getElementById('lc-hs-elapsed'),
      info: document.getElementById('lc-hs-info'),
    },
    {
      button: document.getElementById('lc-hs-card-timer-button'),
      doneButton: document.getElementById('lc-hs-card-timer-done-button'),
      elapsed: document.getElementById('lc-hs-card-elapsed'),
      info: document.getElementById('lc-hs-card-info'),
    },
  ].filter((b) => b.button);
```

Az `applyHsButtonState` hívásokat frissítsd, hogy a `doneButton`-t és a Linear config teljességét is átadja. A `settings` objektum már elérhető (sor 247 környékén lett lekérve). Számold ki a Linear config-et a függvény elején, majd add át minden `applyHsButtonState` hívásba:

A `const { settings } = await chrome.storage.local.get('settings');` **után** (sor 248) szúrd be:

```javascript
  const linearConfigComplete = !!(
    settings?.linearApiKey && settings?.linearDefaultTeamId &&
    settings?.linearViewerId && settings?.linearInProgressStateId
  );
```

A jelenlegi `NO_API_KEY` ágat (sor 249) cseréld le:

```javascript
    buttons.forEach(({ button, doneButton, elapsed, info }) => {
      applyHsButtonState(button, doneButton, elapsed, info, 'hidden', null, false);
    });
```

A normál render hívást (sor 263) cseréld le:

```javascript
  buttons.forEach(({ button, doneButton, elapsed, info }) => {
    applyHsButtonState(button, doneButton, elapsed, info, state, activeTimer, linearConfigComplete);
  });
```

- [ ] **Step 2: Frissítsd az `applyHsButtonState` függvényt, hogy a `doneButton`-t + Linear config-et is kezelje**

Cseréld le a `hs-content.js:193-224` teljes `applyHsButtonState` függvényt:

```javascript
function applyHsButtonState(button, doneButton, elapsed, info, state, activeTimer, linearConfigComplete) {
  if (!button) return;
  if (state === 'hidden') {
    button.style.display = 'none';
    if (doneButton) doneButton.style.display = 'none';
    if (info) {
      info.style.display = 'inline';
      info.textContent = '';
      info.appendChild(createSettingsLink());
    }
    return;
  }
  button.style.display = '';
  const showDone = !!linearConfigComplete;
  if (state === 'start') {
    button.className = 'lc-btn lc-btn-start';
    button.textContent = '▶ Start';
    if (doneButton) doneButton.style.display = 'none';
    if (elapsed) elapsed.style.display = 'none';
    if (info) info.style.display = 'none';
  } else if (state === 'stop') {
    button.className = 'lc-btn lc-btn-stop';
    button.textContent = '⏹ Stop';
    if (doneButton) {
      doneButton.style.display = showDone ? '' : 'none';
      doneButton.className = 'lc-btn lc-btn-done';
      doneButton.textContent = '✓ Stop & Done';
    }
    if (elapsed) elapsed.style.display = 'inline';
    if (info) info.style.display = 'none';
  } else if (state === 'switch') {
    button.className = 'lc-btn lc-btn-stop';
    button.textContent = '⏹ Stop';
    if (doneButton) {
      doneButton.style.display = showDone ? '' : 'none';
      doneButton.className = 'lc-btn lc-btn-done';
      doneButton.textContent = '✓ Stop & Done';
    }
    if (elapsed) elapsed.style.display = 'none';
    if (info) {
      info.style.display = 'inline';
      info.textContent = `Timer fut: ${activeTimer.issueTitle}`;
    }
  }
}
```

**Megjegyzés:** A `switch` ágban a primary gomb mostantól `lc-btn-stop` (piros, "⏹ Stop") — a régi sárga `lc-btn-switch` és "⏹ Stop & ▶ Start" szöveg megszűnt.

- [ ] **Step 3: Ellenőrizd, hogy a `lc-btn-switch` CSS-osztály nincs már a HS content script-ben / popup-ban**

Run: `grep -n "lc-btn-switch" hs-content.js popup.js popup.html`
Expected: nincs találat.

**Megjegyzés:** A Linear oldali `content.js` **megtartja** a `lc-btn-switch` osztályt — ott a Stop & Start kompound gomb továbbra is élő (spec scope-on kívül esik). A `styles.css` `.lc-btn-switch` definíciója is marad (a Linear content.js használja).

Ha találsz találatot HS-ben vagy popup-ban, töröld.

- [ ] **Step 4: Commit**

```bash
git add hs-content.js
git commit -m "feat(hs): applyHsButtonState renders Stop + Stop & Done in stop/switch"
```

---

## Task 10: Popup — CSS és Stop & Done gomb

**Files:**
- Modify: `popup.html:38-50` — új `.done-btn` CSS
- Modify: `popup.js:79-98` — stop gomb után add hozzá a Done gombot

- [ ] **Step 1: Adj hozzá CSS-t a `popup.html`-ben**

A `popup.html` `.stop-btn { ... }` block után (sor 48 környékén, `.stop-btn:disabled` után) szúrd be:

```css
    .done-btn {
      width: 100%;
      padding: 8px 16px;
      background: #059669;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      margin-top: 8px;
    }
    .done-btn:hover { opacity: 0.9; }
    .done-btn:disabled { opacity: 0.5; cursor: not-allowed; }
```

- [ ] **Step 2: Módosítsd a `popup.js`-t, hogy rendereljen Stop & Done gombot is**

A `popup.js:79-98` blokk:

```javascript
  if (!activeTimer.external) {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'stop-btn';
    stopBtn.textContent = '⏹ Stop';
    stopBtn.addEventListener('click', async () => { ... });
    content.appendChild(stopBtn);
  }
```

Cseréld le a teljes `if (!activeTimer.external) { ... }` blokkot így:

```javascript
  if (!activeTimer.external) {
    const linearConfigComplete = !!(
      settings?.linearApiKey && settings?.linearDefaultTeamId &&
      settings?.linearViewerId && settings?.linearInProgressStateId
    );
    let doneBtn = null;

    const stopBtn = document.createElement('button');
    stopBtn.className = 'stop-btn';
    stopBtn.textContent = '⏹ Stop';
    stopBtn.addEventListener('click', async () => {
      stopBtn.disabled = true;
      if (doneBtn) doneBtn.disabled = true;
      const result = await chrome.runtime.sendMessage({ action: 'stopTimer' });
      if (result.error) {
        const errEl = document.createElement('div');
        errEl.className = 'error';
        errEl.style.display = 'block';
        errEl.textContent = result.error;
        content.appendChild(errEl);
        stopBtn.disabled = false;
        if (doneBtn) doneBtn.disabled = false;
      } else {
        render();
      }
    });
    content.appendChild(stopBtn);

    if (activeTimer.issueKey && linearConfigComplete) {
      doneBtn = document.createElement('button');
      doneBtn.className = 'done-btn';
      doneBtn.textContent = '✓ Stop & Done';
      doneBtn.addEventListener('click', async () => {
        stopBtn.disabled = true;
        doneBtn.disabled = true;
        const result = await chrome.runtime.sendMessage({ action: 'stopAndDoneTimer' });
        if (result.error) {
          const errEl = document.createElement('div');
          errEl.className = 'error';
          errEl.style.display = 'block';
          errEl.textContent = result.error;
          content.appendChild(errEl);
          stopBtn.disabled = false;
          doneBtn.disabled = false;
          return;
        }
        if (result.warning) {
          const warnEl = document.createElement('div');
          warnEl.className = 'error';
          warnEl.style.display = 'block';
          warnEl.style.color = '#eab308';
          warnEl.textContent = `⚠️ ${result.warning}`;
          content.appendChild(warnEl);
        }
        render();
      });
      content.appendChild(doneBtn);
    }
  }
```

**Sorrend magyarázat:** A `let doneBtn = null;` a blokk **elején** van deklarálva, így a `stopBtn` click handler zárványa (closure) biztonságosan elérheti a változót. Klikk-időben a változó már inicializálva van, a `if (doneBtn)` check pedig a null esetet kezeli (Linear config hiányzott vagy nincs `issueKey`).

- [ ] **Step 3: Manuális füst-teszt**

Tölts be az extension-t fejlesztői módban (`chrome://extensions/ → Load unpacked → linear-clockify/` vagy Reload), indíts egy HS timert, kattints az ikonra. Várt: két gomb látszik (`⏹ Stop`, `✓ Stop & Done`).

- [ ] **Step 4: Commit**

```bash
git add popup.html popup.js
git commit -m "feat(popup): Stop & Done button next to Stop"
```

---

## Task 11: Manuális regresszió + doksi frissítés

**Files:**
- Modify: `README.md` — frissítsd a "Funkciók" szekciót
- Modify: `docs/TELEPITES.md` — új manuális teszt lépések

- [ ] **Step 1: Frissítsd a `README.md` "Timer gomb a Linear issue oldalon" táblát**

A `README.md:25-30` táblázat változatlan marad (Linear oldal). Cseréld le a tábla **alatti** részt, hogy tartalmazza a HS + Done viselkedést. A `### Manuális időrögzítés` szekció elé szúrd be:

```markdown
### HelpScout timer

Minden `secure.helpscout.net/conversation/*` oldalon és a jobb oldali panelen megjelenik egy Clockify card:

| Állapot | Gombok |
|---|---|
| Nincs futó timer | `▶ Start` |
| Ezen a ticketen fut | `⏹ Stop` + `✓ Stop & Done` |
| Másik ticketen fut | `⏹ Stop` + `✓ Stop & Done` |

A **Stop & Done** leállítja a futó Clockify timert, és a kapcsolódó Linear issue-t `Done` state-re állítja. Ha Linear-ben még nincs config vagy külső timer fut (pl. másik eszközről), a Done gomb nem jelenik meg.
```

- [ ] **Step 2: Frissítsd a `docs/TELEPITES.md` manuális QA listát**

Keresd meg a `### HelpScout integráció manuális QA` (vagy hasonló) szekciót. A végére add hozzá:

```markdown
- [ ] HS timer start A ticketen → navigálj B ticketre → `⏹ Stop` → timer leáll, A Linear issue marad `In Progress`-ben
- [ ] HS timer start A ticketen → navigálj B ticketre → `✓ Stop & Done` → timer leáll, A Linear issue `Done` state-re vált
- [ ] HS timer start A ticketen (ugyanazon a ticketen maradsz) → `✓ Stop & Done` → timer leáll, A Linear issue `Done`
- [ ] Extension popup: futó timer → `⏹ Stop` → leáll, issue változatlan
- [ ] Extension popup: futó timer → `✓ Stop & Done` → leáll, Linear issue Done
- [ ] Extension popup: külső (másik eszközön indított) timer → csak `⏹ Stop` látszik, `Stop & Done` nincs
- [ ] Ha Linear config hiányzik, HS-ben nincs timer gomb, popup-ban csak Stop (nem Done)
- [ ] Első Stop & Done lassabb (GraphQL lookup); második ugyanazon team-en gyors (cache)
```

- [ ] **Step 3: Futtasd az összes unit tesztet**

Run: `node --test`
Expected: minden teszt zöld.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/TELEPITES.md
git commit -m "docs: Stop & Done button in README + manual QA list"
```

---

## Task 12: Záró manuális tesztelés + build

**Files:** nincs kód-módosítás, csak verifikáció

- [ ] **Step 1: Töltsd újra az extension-t fejlesztői módban**

`chrome://extensions/` → `linear-clockify` → reload ikon.

- [ ] **Step 2: Végignyomni a `docs/TELEPITES.md` új Stop & Done ellenőrző listáját**

Minden pipa megy → OK. Ha valami bukik, annak a task-nek megfelelő lépéshez visszatérés.

- [ ] **Step 3: Node tesztek záró futtatása**

Run: `node --test`
Expected: minden zöld.

- [ ] **Step 4: ZIP csomag build (ha kell release)**

Run: `./build-zip.sh`
Expected: `linear-clockify.zip` frissül.

- [ ] **Step 5: Záró commit (ha van build artifact változás)**

```bash
git add linear-clockify.zip
git commit -m "chore: rebuild zip with Stop & Done feature"
```

Ha nem épült új zip vagy nem kell, ugord át ezt.
