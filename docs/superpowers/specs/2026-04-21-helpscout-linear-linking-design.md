# HelpScout ↔ Linear issue-linking

**Dátum:** 2026-04-21
**Scope:** `linear-clockify` Chrome extension
**Státusz:** Design — user-approved, implementation plan következik
**Előfeltétel:** a `2026-04-21-helpscout-support-design.md` spec szerinti HS-timer már él

## Áttekintés

A HS-oldali timer start (és manuális rögzítés) jelenleg `[HS: #43152] subject — customer` leírással hoz létre Clockify entry-t. Ez a spec **minden HS conversationhöz automatikusan létrehoz egy Linear issue-t** (ha még nincs), és a Clockify entry leírását `[LIN-xxx] subject — customer` formátumra cseréli. A conv ↔ issue mapping Linear **Attachment URL-lookup**-on keresztül stabil és indexelt.

A Customer (partner) tárolás ebből a fázisból **tudatosan kimarad** — egy későbbi szerver-oldali cron fogja elvégezni (HS API-val, GG owner-lookupbal, AI summary-val). Az extension minden olyan enrichment-adatot (HS IDs, email-ek, customer név) beletölt az attachment metadatájába, amire a cron-nak valaha szüksége lesz — **nincs információveszteség**.

## Architektúra — két réteg

### 1. Extension (szinkron, ebben a spec-ben)

A HS conv oldalán, Start vagy Manuális rögzítés gombnyomásra:

1. **DOM + URL parse**: canonical HS URL, conv ID-k, subject, customer név, emailek, HS customer ID
2. **Lookup** Linear-ben: `attachmentsForURL(canonicalHsUrl)` → van-e már issue?
3. **Ha van**: vedd az identifier-t (`LIN-xxx`), ugord a 6. lépésre
4. **`issueCreate`** a TUL team-be, state = In Progress, assignee = viewer (self), title = `{subject} [HS: #{short}]`, description = partner név + HS link
5. **`attachmentCreate`** a canonical URL-lel, metadata-batyuval a jövőbeli cron számára
6. **Clockify call** (start VAGY addTimeEntry, attól függően hogy Start-gomb vagy Manuális rögzítés) leírással: `[LIN-xxx] {subject} — {customer}`

### 2. Cron (aszinkron, out-of-scope)

Egy külön (nem ebben a repóban megírt) cron futhat bármikor — az attachment metadatából mindent tud:

- `customerUpsert` + `customerNeedCreate` — az emailek és HS customer ID alapján (GG owner-lookup opcionális)
- HS API-hívás a conv tartalmára → AI summary az issue descriptionben vagy kommentben
- Duplikált issue-k dedup-ja (ha két user egyszerre indít)
- Historikus `[HS: #...]` Clockify entry-k migrálása `[LIN-xxx]`-re (egyszeri, opcionális, user-kulcsokkal)

**Ez a spec nem írja elő a cron implementációját**, csak a kontraktot: az extension minden szükséges adatot eltárol az attachment `metadata` mezőjében.

## DOM-parse a HS oldalon

Az alábbi adatok a timer start (vagy manuális rögzítés) pillanatában, egyetlen szinkron DOM-olvasással elérhetőek a HS conv oldalán:

| Mező | Forrás | Fallback |
|---|---|---|
| `hsConvIdLong` | `location.pathname` → `/conversation/(\d+)/(\d+)/` → első csoport | **blokkoló** ha nem parse-olható, abort error-ral |
| `hsConvIdShort` | ugyanaz, második csoport | **blokkoló** |
| `canonicalHsUrl` | `new URL(location.href)`, `search = ''`, `hash = ''`, `toString()` | származtatott |
| `subject` | `parseHsTitle(document.title)` — már megvan `shared.js`-ben | üres string |
| `customerName` | `parseHsTitle(document.title)` — már megvan | üres string |
| `emails[]` | `document.querySelectorAll('[data-cy="Sidebar.CustomerEmails"] [data-testid="EmailList.EmailLink"]')` → minden anchor `.c-Truncate__content` textContent-je | üres tömb |
| `hsCustomerId` | ugyanaz az anchor első `href` → `/customer/(\d+)/` első csoport | `null` |

**Soft-fail elv**: csak a `hsConvIdLong` / `hsConvIdShort` hiánya blokkoló — minden más hiányozhat, az issue és attachment létrejön az adott adat nélkül. A cron később a HS API-ból pótolhatja.

### Canonical URL normalizáció

```
raw:       https://secure.helpscout.net/conversation/3297862965/44477?viewId=8514301#thread-123
canonical: https://secure.helpscout.net/conversation/3297862965/44477
```

A `?viewId=...`, bármilyen más query, és fragment lekerül — így két user két view-ból indított `attachmentsForURL` ugyanazt az issue-t találja meg. URL class-szal, nem manuális string-művelettel.

## Linear API flow

### Lookup

```graphql
query IssueByHsConvUrl($url: String!) {
  attachmentsForURL(url: $url) {
    nodes {
      id
      issue { id identifier title state { name } }
    }
  }
}
```

- **Ha `nodes.length >= 1`**: vedd a **legelsőt** (`nodes[0].issue`). Duplikáció esetén (ritka, cron dedup) a legelső a stabil választás.
- **A talált issue state-jét nem módosítjuk.** Ha Done / Canceled, a user Linear-ben reopen-elhet kézzel.

### Create (csak ha a lookup üres)

Három mutation szekvenciálisan, egy transaction-jellegű flow-ban:

```graphql
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { id identifier }
  }
}
```

Input:
- `teamId`: options-ból, a user-konfigurált default team (TUL) ID
- `title`: `${subject} [HS: #${hsConvIdShort}]` — ha `subject` üres: `HS #${hsConvIdShort}`
- `description`: lásd alább
- `assigneeId`: a `viewer` query-ből cache-elt user ID (options-load-kor lekérve, per-user `chrome.storage.sync`)
- `stateId`: a team "In Progress" state ID-ja (options-load-kor lekérve, per-user cache)

Issue description sablon:

```markdown
**Partner:** {customerName || '—'}

[Helpscout conversation]({canonicalHsUrl})
```

Majd:

```graphql
mutation AttachmentCreate($input: AttachmentCreateInput!) {
  attachmentCreate(input: $input) {
    success
    attachment { id }
  }
}
```

Input:
- `issueId`: az előző lépésből
- `url`: `canonicalHsUrl` (ez a lookup kulcs a jövőben)
- `title`: `Helpscout #{hsConvIdShort}`
- `subtitle`: `customerName || ''`
- `metadata`:
  ```json
  {
    "source": "linear-clockify-extension",
    "hsConvIdLong": "3297862965",
    "hsConvIdShort": "44477",
    "hsCustomerId": "749159069",
    "hsCustomerEmails": ["teemea.kovacs@gmail.com"],
    "hsCustomerName": "Kovács Tímea",
    "createdAt": "2026-04-21T14:32:00Z"
  }
  ```

### Részleges hiba kezelése

- `issueCreate` fail → abortál, Clockify nem indul, user-nek error status (`"Linear issue létrehozás sikertelen: {reason}"`).
- `issueCreate` OK, `attachmentCreate` fail → **1× automatikus retry** 500 ms múlva. Ha az is fail:
  - A Clockify NEM indul.
  - Error status: `"Árva Linear issue létrejött: {issueUrl} — add hozzá kézzel a HS linket, vagy töröld az issue-t"`.
  - A user dönti el: kézzel rendbe teszi vagy újra próbálja (a következő start duplikátum issue-t fog létrehozni — ezt a cron dedupelja).

## Clockify description formátum

```
[LIN-xxx] {subject} — {customer}
```

Példa:

```
[LIN-1234] Re: IFA/építményadó bejelentkezés — Brigitta Sonkoly
```

- Ha `subject` üres: `[LIN-xxx] HS #{hsConvIdShort} — {customer}`
- Ha `customer` üres: `[LIN-xxx] {subject}` (nincs trailing em-dash)
- A HS# prefix eltűnik a leírásból — a Linear issue attachmentjén keresztül elérhető.

### `detectTimerSource` frissítés

A `shared.js`-ben a `detectTimerSource` regex-et ki kell terjeszteni, hogy a `[LIN-...]` prefixes HS-ből indított entry-t is felismerje mint "HS-forrás" (a `checkRunningTimer` a HS conv oldalon ezáltal helyesen jelzi ki).

Új regex: `/^\[LIN-(\d+)\]\s*(.*)$/` — ha illeszkedik, és az issue attachmentjei között van `secure.helpscout.net/conversation/...` URL, akkor HS-forrás. Az attachment-lookup egy extra Linear API hívást jelent a `checkRunningTimer`-ben — **cache-elendő** (per-issue, `chrome.storage.local`, 1 órás TTL).

Fallback a cache-nélküli vagy hibás esetre: a `[LIN-xxx]` prefix önmagában is elég ahhoz, hogy a gomb-state logika jól működjön (mert az issue-re mutat, amihez a user timert rendelt).

## Options page változások

A `linearApiKey` mező már létezik az `options.html`-ben (a Linear issue-enrichment feature miatt). Új mezők és tárolási kulcsok (mind a `settings` object alatt, `chrome.storage.local` — a codebase konvenciója):

| Mező | Tárolás (`settings.`) | Validáció / forrás |
|---|---|---|
| Linear personal API key | `linearApiKey` | Már létezik, most validálni is kell |
| Default Linear team | `linearDefaultTeamId` | Dropdown, `teams` query-ből feltöltve |
| Self user ID (rejtett) | `linearViewerId` | Automatikusan `viewer` query-ből a save lépésnél |
| In-Progress state ID (rejtett) | `linearInProgressStateId` | Automatikusan a kiválasztott team `states`-éből |

### Options page flow

1. User beírja az API key-t.
2. `validateLinearKey()`: `viewer` + `teams` query. Ha 401/403 → piros hiba. Ha OK → `viewerId` elmentve, team-dropdown feltöltve.
3. User választ team-et.
4. `loadTeamMeta(teamId)`: lekéri a team `states`-eit, kiválasztja az `In Progress` state-et név alapján (fallback: `type = "started"`). Ez az ID elmentődik.
5. "Save" → `chrome.storage.sync` persist.

### Konfigurálatlan állapot (strict blokkolás)

Ha a HS content script Start/Manuális rögzítés-re kattintás pillanatában:

- `linearApiKey` hiányzik, VAGY
- `linearDefaultTeamId` hiányzik, VAGY
- `linearViewerId` hiányzik, VAGY
- `linearInProgressStateId` hiányzik

akkor a művelet **abortál**, és a status-chip-ben:

> `"Állítsd be a Linear integrációt a beállításokban"` — a settings ikonra mutató inline link

A Clockify NEM indul ilyen esetben. (A user döntése: ne keletkezzenek `[HS: #...]` entry-k konfigurálatlan user-től, mert azokat nehéz később migrálni.)

## Manuális rögzítés-flow

**A Linear `find-or-create` lépés ugyanaz**, csak a Clockify hívás más (`addTimeEntry` fix `start` és `end` idővel, nem futó timer).

Szekvencia kattintáskor a "Rögzít" gombra:

1. Parse DOM + URL (mint Start-nál).
2. Lookup Linear-ben.
3. Ha nincs, issue + attachment create.
4. `addTimeEntry` a Clockify-hoz a user által megadott `mettől` / `meddig` idővel, `description = "[LIN-xxx] ..."`.

**Nincs architekturális különbség**, csak a Clockify-hívás típusa. A `hs-content.js` jelenlegi `attachManualEntrySubmit` handler-ét ki kell egészíteni a Linear-lépéssel, ugyanúgy mint a Start gombot.

## Idempotencia, race feltételek

### Egyazon user, több tab ugyanazon a conv-on

Probléma: ha a user gyorsan egymás után indít timert két tabból → két `attachmentsForURL` lookup fut párhuzamosan, mindkettő üreset ad → két `issueCreate`.

Védelem: **per-conv-ID lock `chrome.storage.local`-ben**. A Linear lookup + create + Clockify-start flow körbefogva:

```
key: `lc-linear-lock:${hsConvIdLong}`, TTL 10 sec
```

Ha a lock foglalt, a második kattintás vár max 5 sec-ig, aztán újraprobál (addigra az első flow végzett, a lookup pozitív).

### Két user egyszerre

**Nincs védelem**, a user elfogadta. A cron dedup-ja megold (out-of-scope). Valós életben percekre sem valószínű.

### Lookup-to-create race

Linear `attachmentsForURL` nem transactional a `attachmentCreate`-tel. Ha lookup visszaad üreset, de create közben mást hoz létre párhuzamosan → duplikátum. Ugyanaz mint a két-user race. Accept, cron.

## Fájl-változások

```
hs-content.js         +Linear-lookup-or-create a Start és Manual Entry előtt
shared.js             +parseHsEmailsFromDom(), +parseHsCustomerIdFromDom(),
                      +canonicalizeHsUrl(), +LIN-prefix detectTimerSource regex
background.js         +linearRequest() wrapper, +linearFindOrCreateIssue(),
                      +in-memory cache a team-state + viewer ID-nak
options.html / .js    +Linear API key mező, +team dropdown, +validálás
manifest.json         host_permissions `https://api.linear.app/*` már jelen
                      (v1.0-ban már ott van), nem igényel változtatást
tests/
  shared.test.js      +new tests a DOM-parse + URL-canonicalize helpers-hez
  linear.test.js      új fájl — find-or-create flow, mockolt fetch
```

A Linear API-hívások elhelyezését (`background.js` service worker vs. közvetlenül a content script-ből) a plan doc dönti el, követve a meglévő Clockify-hívás mintát a `background.js`-ben. A Linear API támogatja a CORS-ot, szóval nem kötelező a background-proxy, de konzisztencia-okból valószínű ott lesz.

## Tesztelés

**Új unit tesztek (`tests/shared.test.js` bővítés):**
- `canonicalizeHsUrl` — viewId, hash, egyéb query stripelés
- `parseHsEmailsFromDom` — 0, 1, több email, malformed DOM, hiányzó selector
- `parseHsCustomerIdFromDom` — normál href, malformed href

**Új integrációs tesztek (`tests/linear.test.js`):**
- `linearFindOrCreateIssue` — lookup hit (létező issue)
- Lookup miss → teljes create flow (issue + attachment) mock-olt `fetch`-csel
- Partial failure: issueCreate OK, attachmentCreate 1× retry, aztán fail
- API key hiány → throws specific error type
- Rate limit (429) → throws, nincs retry

**Manual smoke test-plan a plan doc-ban** lesz részletezve — 5-6 konkrét scenario (friss conv, meglévő conv, manual entry, magas-latency, Linear-404-es team).

**E2E (Playwright)** — **out-of-scope** erre a fázisra. A live HS + Linear oldalakat drága tesztelni automatizálva.

**Coverage**: 80%+ a meglévő target, bővítjük az új kódra.

## Out-of-scope

Ebben a spec-ben NEM kerül implementálásra:

- **Customer-linkage** (`customerUpsert`, `customerNeedCreate`) — cron csinálja
- **AI summary** — cron csinálja
- **Dedup cron** — két párhuzamos issue összemergelése
- **Historikus `[HS: #...]` Clockify entry migráció** — opcionális, cron csinálja, user-kulcsokkal
- **E2E tesztek** a live Linear + HS ellen
- **Linear-oldal támogatás** ezen feature-ben (a Linear `content.js` nem változik; az ott induló timerek továbbra is `[LIN-xxx]` leírással futnak, mint eddig)

## Függőségek

- Linear Personal API token (user maga generálja: `linear.app/settings/api`)
- Linear Business plan (ahol a `Customer` feature későbbi use-ra elérhető — de MVP-ben nem használjuk)
- HS Beacon / email inbox (már él)

## Siker-kritériumok

1. Új HS conv-on timer indítása → új Linear issue a TUL-ban, In Progress state, self-assigned, `{subject} [HS: #nnn]` title-lel, attachment-el a HS URL-re, + Clockify-ban `[LIN-xxx] ...` leírással futó timer.
2. Ugyanazon a HS conv-on újra indítás (akár más user-ként) → **nem** jön létre új issue, a meglévőhöz kapcsolódik.
3. Manuális rögzítés ugyanúgy működik (LIN-xxx a leírásban).
4. Linear nem konfigurált user-nél: Start / Manual rögzítés visszautasítva, status üzenet a settings-re mutat.
5. Linear részleges hiba → árva issue URL-je látszik a user-nek, Clockify nem indul.
6. A `detectTimerSource` és `checkRunningTimer` helyesen azonosítja a `[LIN-xxx]` entry-t mint HS-forrás a HS oldalon (attachment-lookup alapján).
