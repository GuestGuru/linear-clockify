# Stop & Done gomb — tervezési dokumentum

**Dátum:** 2026-04-22
**Státusz:** Draft — felülvizsgálatra vár

## Háttér

A jelenlegi UI-ban a Clockify timer leállítására két forgatókönyv van:

1. **HelpScout sidebar** (`hs-content.js`): amikor egy másik HS ticketen fut a timer,
   megjelenik egy sárga `⏹ Stop & ▶ Start` gomb, ami egy kattintással leállítja a
   régi timert és elindít egy újat az aktuális ticketre.
2. **Extension popup** (`popup.js`): a futó timer mellett egy piros `⏹ Stop` gomb.

A tipikus munkafolyamat ma: válaszolok egy HS ticketre → bezárom → a HS átlép a
következő ticketre → `Stop & Start` gombbal átváltok a timerrel. Eközben a **régi
Linear issue `In Progress` state-ben marad**, kézzel kell Done-ra állítani.

## Cél

Amikor a user lezár egy HS ticketet és válaszol, egy kattintással tudja:

- leállítani a futó timert,
- a régi timer Linear issue-ját `Done` state-re állítani.

Új timer indítása külön kattintás lesz az új ticket `▶ Start` gombján (nem
kompound művelet többé).

## Architektúra

### UI változások

#### HelpScout sidebar — gombállapotok

Három lehetséges megjelenítési állapot marad (a `hidden` ugyanaz):

| Állapot | Feltétel | Gomb(ok) |
|---|---|---|
| `start` | nincs futó timer | `▶ Start` |
| `stop` | futó timer **ezen** a ticketen | `⏹ Stop` **+** `✓ Stop & Done` |
| `switch` | futó timer **másik** ticketen | `⏹ Stop` **+** `✓ Stop & Done` |
| `hidden` | nincs Clockify API key | — |

A `stop` és `switch` állapotban a két gomb ugyanazon futó timer-re hat:

- **`⏹ Stop`** — csak leállítja a timert (jelenlegi `stopTimer` action).
- **`✓ Stop & Done`** — leállítja a timert, majd a futó timer Linear issue-ját
  `Done` state-re állítja.

A korábbi `⏹ Stop & ▶ Start` (sárga, `lc-btn-switch`) megszűnik. A mostani
`stopAndStartHsTimer` message action törlődik.

A `switch` állapotban az `info` span továbbra is megmutatja, mi a futó timer
(`Timer fut: <issueTitle>`), hogy a user tudja mit fog leállítani.

Mivel HS sidebar szűk helyen van (a conversation header bar-ban vagy a jobb
oldali floating card-on), a két gombot vizuálisan csoportosítjuk, elemtördeléssel
(`flex-wrap: wrap` — a card layout már így van). A header bar verzióban ha nem
fér ki, a második gomb a következő sorba kerül.

#### Extension popup — gombok

Ha fut aktív timer, a futó timer részletei alatt két gomb jelenik meg:

- **`⏹ Stop`** (piros, meglévő) — csak leállítja a timert.
- **`✓ Stop & Done`** (új, lejjebb) — leállítja és Done-ra teszi a Linear
  issue-t. **Csak akkor jelenik meg,** ha `activeTimer.issueKey` létezik ÉS
  `activeTimer.external !== true`. (Külső/unknown timer-nél nem tudjuk, melyik
  Linear issue-t kéne lezárni.)

Ha a timer `external` vagy `unknown`, csak a meglévő Stop gomb látszik.

#### Stílus

Új CSS osztály `.lc-btn-done` (HS-ben) — visszafogott zöld (pl. `#059669`, más
mint a `▶ Start` `#22c55e` — hogy vizuálisan elkülönüljön az akció-típus).
Popup-ban a popup.html inline CSS-be új `.done-btn` a meglévő `.stop-btn`
mintájára.

### Backend (background.js) változások

#### Új függvények

```
resolveLinearDoneStateId(teamKey) → string | null
  Per-team cache (chrome.storage.local, kulcs: `linearDoneStateByTeam`).
  Cache miss esetén GraphQL query-vel lekéri a team összes state-jét,
  kiválasztja a `completed` típusút (név="Done" preferálva), eltárolja
  cache-be és visszaadja az ID-t. Cache találatnál azonnal visszaad.

markLinearIssueDone(issueKey) → { success: true } | { error, issueKey }
  1. issueKey-ből teamKey kiolvasás ("TUL-14" → "TUL")
  2. resolveLinearDoneStateId(teamKey) — ha null, error
  3. issueUpdate mutation: { id: issueId, stateId }
     - issueId-hoz issues() lookup teamKey + number alapján (van már ilyen
       minta: getIssueDetails)
  4. Hibák: LINEAR_CONFIG_MISSING, LINEAR_FORBIDDEN, vagy raw üzenet
```

#### Új message action-ök

- `stopAndDoneTimer` — popup + HS `stop` állapotból:
  1. `chrome.storage.local.get('activeTimer')` — kiolvassa mit kell Done-ra tenni
  2. `stopTimer()` — timer leáll (a Clockify API hibát már most is toleráljuk)
  3. ha `activeTimer.issueKey && !external`: `markLinearIssueDone(issueKey)`
  4. Siker: `{ success: true, warning? }` — a warning lehet:
     - "Linear Done nem sikerült: <msg>" — timer leállt, issue nem változott

- Legyen egyetlen action `stopAndDoneTimer`, mindkét kontextusból (popup + HS)
  használható, mert mindkét esetben ugyanaz a logika: kezeld a FUTÓ timer-t.

#### Megszűnő message action

- `stopAndStartHsTimer` — törlés. A HS content script `handleHsButtonClick`
  branchei egyszerűsödnek: csak `stopTimer` vagy `startHsTimer` vagy
  `stopAndDoneTimer`.

### Hibakezelés

- **Timer leáll, Linear update hibát dob** → timer leállt, warning megjelenik
  a szokásos `info` span-ben 5-8 mp-re, nem blokkol.
- **Linear config hiányzik** (`!isLinearConfigComplete`) → a Stop & Done gomb
  elrejtve (ugyanúgy, mint a HS sidebaron a gomb-hidden `NO_API_KEY` esetben).
  Popup-ban: a Stop & Done gomb nem jelenik meg.
- **Issue lookup sikertelen** (pl. a team-et nem találjuk) → warning:
  "Linear issue nem található: <key>" — timer már leállt.
- **Done state nem található** (`resolveLinearDoneStateId` null) → warning:
  "Linear 'Done' state nem található ehhez a team-hez" — timer leállt.
- **`markLinearIssueDone` rate limit / auth** → ugyanúgy warning, de a `info`
  span szövegében emberközelibb: "Linear Done sikertelen: <ok>".

### Állapot/kompatibilitás

- `chrome.storage.local.linearDoneStateByTeam: Record<teamKey, stateId>` — új
  kulcs. Ha nem létezik, üres objektumként kezeljük.
- Nincs Options UI változás. A validate-flow (`validateLinearConfig`) továbbra
  is a jelenlegi `In Progress` state-et detektálja — a Done state lazy.

### Manuális regresszió-teszt (terv része lesz)

- HS ticket A-n start → másik HS ticket B-re navigálás → `Stop` → timer leáll,
  A issue `In Progress` marad (jelenlegi viselkedés egy `stop`-nál).
- HS ticket A-n start → B-re nav → `Stop & Done` → timer leáll, A issue Done.
- Ugyanezen a ticketen start → `Stop & Done` → timer leáll, issue Done.
- Popup: futó timer → `Stop & Done` → timer leáll, issue Done.
- Popup: külső timer (másik eszközön indítva) → csak `Stop` látszik, Done nincs.
- Linear config hiányzik → Stop & Done egyik helyen sem látszik.
- Done state cache miss → első Done-nál lassabb (egy extra Linear GraphQL
  query), utána gyors.

## Scope-on kívül

- Nincs `In Progress` ↔ `Done` toggle — csak Done irányba tudunk állítani.
- Ha a Linear issue `Canceled` vagy más végállapotban van, a Done átírja.
  (Egyszerűbb, mint detektálni — ez a dokumentált viselkedés.)
- Nincs per-team override UI — a state feloldás automatikus (name "Done"
  vagy type "completed" alapján). Ha a user team-je egyedi Done-nevet használ
  ("Shipped", "Deployed" stb.), a type alapján működik.
- A normál Linear oldali `content.js` UI **nem kap** Stop & Done gombot
  ehhez a mérföldkőhöz. Ott a user saját maga tudja a Linear state-et állítani.
  Ha később kérés lesz, külön spec.
