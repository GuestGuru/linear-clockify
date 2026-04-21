# HelpScout támogatás + snap-to-previous

**Dátum:** 2026-04-21
**Scope:** `linear-clockify` Chrome extension
**Státusz:** Design — user approved, implementation plan következik

## Áttekintés

Két új funkció a `linear-clockify` extension-höz:

1. **HelpScout támogatás** — a Linear mellett a `secure.helpscout.net/conversation/*` oldalakon is jelenjen meg a Clockify timer UI (Start/Stop + manuális rögzítés), hasonló UX-szel. A projekt hardcode-olva `"Lakások és Tulajok"`.
2. **Snap-to-previous** — timer indításakor, ha az előző befejezett entry ≤ 15 percen belül ért véget, a timer ne a `now`-tól, hanem az előző entry végétől induljon. Inline toggle chip a Start gomb mellett.

## HelpScout támogatás

### Adatforrás (subject / customer / id-k)

A conversation adatokat **URL + `document.title` parse**-ból nyerjük, **nem** használunk HelpScout API-t ebben a fázisban. Ezért nincs új API key a user részéről.

- **URL pattern:** `https://secure.helpscout.net/conversation/{convId}/{ticketNumber}`
  - `convId` — hosszú belső ID (pl. `3259965890`), API-hívásra használható
  - `ticketNumber` — rövid user-facing szám (pl. `43152`), ez jelenik meg `#43152` formában a felületen és a title-ben
- **`document.title`:** `#{ticketNumber} {subject} - {customer}` (pl. `#43152 Re: Népszínház 26. lemondás - Tímea Kovács`)
  - Regex: `/^#(\d+)\s+(.+?)\s+-\s+(.+?)\s*$/`
  - Ha a title nem parse-olható (pl. még nem töltött be), fallback: `subject = ''`, `customer = ''`, a description csak `[HS: #{ticketNumber}]` lesz
- Ha később API kell (pl. tag-ek, status lekérése), a rövid számból az API `GET /v2/conversations?query=(number:43152)` endpoint-tal a hosszú ID felbontható — a rövid szám megőrzése elég.

### Description formátum

```
[HS: #43152] Re: Népszínház 26. lemondás - Tímea Kovács
```

- Fix prefix `[HS: #...]` — így a `checkRunningTimer` felismeri mint HS-forrást
- Ha nincs subject vagy customer (title fallback), csak a prefix jelenik meg

### UI elhelyezés

**Desktop (csak desktop-ra optimalizálva — HS nem igazán responsive):**

- **Timer gomb** — a conversation header közelébe injektálva (a `#43152 Re: ...` subject sor környezetébe). Ugyanaz a gomb-state logika mint Linear-en: Start / Stop / Switch.
- **Manuális rögzítés form** — a jobb oldali sidebar-be card-ként (customer properties / tags környéke). Ugyanaz a form, mint Linear right-panel card-on: Start/Stop gomb felül, "Mettől–Meddig" input + dátum chip + Rögzít gomb alul.

A konkrét injection pontot a `hs-content.js` DOM-exploration-nel határozza meg (analóg a Linear `findInsertionPoint` / `findRightPanelInsertion` megoldással). Fallback: `document.body`.

### Fájl struktúra

```
content.js         Linear content script (eddig is)
hs-content.js      HelpScout content script (új)
shared.js          Közös utilityk (új) — time parsing, form building,
                   status helpers, snap UI chip
background.js      +HS action-ök, +snap logika
manifest.json      +host_permissions, +content_script matches
options.html/js    +HelpScout projekt név mező (hsProjectName, default "Lakások és Tulajok")
popup.html/js      HS timer megfelelő megjelenítése (#43152 — subject)
styles.css         +HS-specifikus stílusok (ha kellenek)
```

A `shared.js`-be kerülnek:

- `parseTimeInput`, `formatHM`, `todayStr`, `localTimeToISO`, `dayBoundsISO`
- `buildManualEntryForm`, `attachManualEntrySubmit` *(generalizálva, hogy Linear és HS action-t is tudjon küldeni)*
- `setStatus`, `clearStatus`, `createSettingsLink`
- Snap chip builder (`buildSnapChip`) és state-renderer

A `attachManualEntrySubmit` signature megkap egy `buildPayload(fields)` callback-et, ami a forrás-specifikus message payload-ot adja vissza. Így ugyanaz a form mindkét helyen használható.

### Manifest változások

```json
{
  "host_permissions": [
    "https://api.clockify.me/*",
    "https://api.linear.app/*",
    "https://linear.app/gghq/*",
    "https://secure.helpscout.net/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://linear.app/*"],
      "js": ["shared.js", "content.js"],
      "css": ["styles.css"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://secure.helpscout.net/conversation/*"],
      "js": ["shared.js", "hs-content.js"],
      "css": ["styles.css"],
      "run_at": "document_idle"
    }
  ]
}
```

### Background változások

**Új / módosult action-ök:**

- `startHsTimer { convId, ticketNumber, subject, customer }` — description összeállítás, projekt resolve `hsProjectName` (default `"Lakások és Tulajok"`) alapján, opcionális snap.
- `stopAndStartHsTimer { convId, ticketNumber, subject, customer }` — stop után start, snap **nem** alkalmazódik (switch esetén a gap 0).
- `createHsManualEntry { convId, ticketNumber, subject, customer, start, end, dayStart, dayEnd }` — overlap check + create, snap nem alkalmazódik.
- `getSnapInfo` — visszaadja `{ snapTo: ISO | null, snapEnabled: boolean }` a UI chip-nek. `snapTo` a kiszámított snap idő, vagy `null` ha nincs snap-elhető entry (gap > 15 perc, vagy nincs entry).

**External timer detection bővítés:**

`checkRunningTimer` regex-ét két pattern-re osztjuk:

- Linear: `/^\[([A-Z]+-\d+)\]\s*(.+)$/`
- HS: `/^\[HS:\s*#?(\d+)\]\s*(.+)$/`

Az `activeTimer` új mezői:

```js
{
  timeEntryId,
  source: 'linear' | 'hs',   // új
  // Linear esetén:
  issueKey: 'IT-123',
  teamKey: 'IT',
  // HS esetén:
  ticketNumber: '43152',
  convId: null,              // nem tároljuk (nincs az description-ben),
                             // ha később kell, API-ból resolve-oljuk
  // közös:
  issueTitle,                // a megjelenítendő szöveg (subject + customer HS-nél)
  projectName,
  startedAt,
  external?,
}
```

**Állapot-egyezés HS oldalon:**

- `activeTimer.source === 'hs'` **és** `activeTimer.ticketNumber === thisTicketNumber` → Stop állapot (ezen a conversation-ön fut)
- Bármi más → Switch állapot (vagy Start, ha nincs timer)

### Popup

A `popup.js` mostantól két formátumot támogat a megjelenítésnél:

- Linear: `IT-1 — title` (eddig is)
- HS: `#43152 — subject - customer` (új)

Ezt a `source` mező alapján döntöm el.

### Options oldal bővítés

Új mező: **HelpScout projekt neve**

```
hsProjectName: string (default: "Lakások és Tulajok")
```

Ha a Clockify projekt név később változna, nem kell kódot nyúlni.

## Snap-to-previous

### Működés

Amikor a user a **Start** gombra kattint (Linear vagy HS):

1. Background megkérdezi a Clockify-t: mi a legutóbbi befejezett entry vége a user workspace-ében?
2. Ha `now - lastEnd < 15 perc` **és** a `snapEnabled === true` → `body.start = lastEnd.toISOString()`
3. Különben → `body.start = now.toISOString()`

**Nem alkalmazódik:**

- `stopAndStart` (switch) esetén — a Stop `now`-kor történik, a gap 0, snap értelmetlen
- Manuális entry létrehozásakor — a user explicit időt ad meg

### Threshold / scope

- **15 perc** hardcode-olva, nem állítható Options-ból (egyszerűség)
- **Bármely entry** a user workspace-ében számít előzőnek (nemcsak az extension által létrehozott). Így a Clockify UI-ban kézzel felvett entry-hez is snap-el.

### UI — inline chip a Start gomb mellett

```
[▶ Start]  [↶ 10:30]      → snap aktív, 10:30-tól indul
[▶ Start]  [↶ off]        → user kikapcsolta
(csak)    [▶ Start]       → nincs snap-elhető entry
```

**Chip viselkedés:**

- A chip a timer gomb mellett jelenik meg (mind Linear floating header, mind Linear right-panel card, mind HS mindkét helyén).
- Kattintásra toggle: `snapEnabled` `true ↔ false` (storage-ba perzisztálva, egy közös flag az egész extension-re).
- Tooltip: `"Előző entry vége — kattintásra kikapcsolod"` / `"Kattintásra bekapcsolod a snap-et"`.
- Ha nincs snap-elhető entry (>15 perc gap vagy nincs entry), a chip **rejtve**.

**State refresh:**

- `updateButtonState` minden futásakor (storage change, URL change, manual refresh) lekéri `getSnapInfo`-t és frissíti a chip-et.
- A `snapTo` idő ISO-ból `HH:MM` formátumra konvertálódik a chip-en.

### Implementation

**`background.js`:**

```js
async function getSnapInfo() {
  const settings = await getSettings();
  const snapEnabled = settings.snapEnabled !== false; // default true
  const now = Date.now();
  const windowStart = new Date(now - 30 * 60 * 1000).toISOString();
  const windowEnd = new Date(now).toISOString();
  const entries = await getEntriesInRange(windowStart, windowEnd);

  let latestEnd = 0;
  for (const e of entries) {
    if (!e.timeInterval.end) continue;
    const end = new Date(e.timeInterval.end).getTime();
    if (end > latestEnd) latestEnd = end;
  }

  if (!latestEnd) return { snapTo: null, snapEnabled };
  const gap = now - latestEnd;
  if (gap <= 0 || gap >= 15 * 60 * 1000) return { snapTo: null, snapEnabled };

  return { snapTo: new Date(latestEnd).toISOString(), snapEnabled };
}

async function resolveStartTime() {
  const info = await getSnapInfo();
  if (info.snapEnabled && info.snapTo) return info.snapTo;
  return new Date().toISOString();
}
```

`startTimer` és `startHsTimer` az `body.start`-ot `resolveStartTime()`-ból veszi.

**Settings új mező:**

```js
snapEnabled: true   // default true
```

Toggle-t csak a UI chip állítja, Options-ban nincs külön beállítás.

### Edge case-ek

- **Futó timer van** (user oldja fel a tab-ot, nem állítja le): `getEntriesInRange` tartalmazza a futó entry-t is (`timeInterval.end === null`), de a snap-loop `continue`-zik rajta. Helyes.
- **Több entry 15 percen belül**: mindegyik közül a legkésőbbi `end`-et vesszük.
- **Race condition**: ha a user snap-elne, de közben valaki (pl. másik eszköz) indított egy timer-t — `startTimer` ugyanúgy működik, a Clockify eldönti hogy elfogadja-e. Nem kell külön kezelni.
- **Jövőbeli entry** (theoretikusan ha az óra eltolódna): `gap <= 0` → nem snap-elünk. Helyes.

## Popup / Options változások összefoglalva

- **`popup.js`** — `source === 'hs'` esetén `#{ticketNumber} — {issueTitle}` formátum
- **`options.html/js`** — új mező `hsProjectName` (default `"Lakások és Tulajok"`)
- Nincs új Options-mező a snap-hez

## Out of scope (most nem csináljuk)

- HelpScout API használata (OAuth2 setup, auth flow) — ha később kellene tag-ek / status lekérése, külön spec
- Mobile HelpScout UI — a HS web app nem igazán mobil-optimalizált
- Más HS oldal-típusok (inbox lista, reports, settings) — csak `/conversation/*`
- Snap threshold konfigurálhatóság — 15 perc hardcode
- Snap-et külön toggle Linear-re és HS-re — egy közös flag

## Sikerkritériumok

- HelpScout conversation oldalon megjelenik a Timer gomb és a Manuális rögzítés card
- Start gomb helyes description-t küld: `[HS: #43152] subject - customer`
- `Lakások és Tulajok` projekt automatikusan ki van választva
- External timer detection felismeri a HS-eredetű timer-eket
- Popup helyesen mutatja a HS timer-t
- Snap chip megjelenik mindkét platform-on (Linear + HS), state perzisztens
- Snap-nél a timer az előző entry végétől indul, ha ≤ 15 perc gap van
- Linear-es működés változatlan (regresszió nincs)
