# Linear → Clockify Chrome Extension — Design Doc

> Dátum: 2026-04-15
> Státusz: Elfogadva
> Spec: [linear-clockify-extension-spec.md](../../AI/docs/specs/linear-clockify-extension-spec.md)

## Döntések

| Kérdés | Döntés | Indoklás |
|---|---|---|
| Kódbázis helye | `~/dev/GG/linear-clockify` | Önálló projekt, nem az AI sandbox része |
| Nyelv | Vanilla JavaScript | 6-7 fájl, nincs szükség build tool-ra, egyszerűbb debug |
| Build tool | Nincs | Manifest V3 közvetlenül betölti a fájlokat |
| Manifest verzió | V3 | Chrome aktuális szabvány |

## Architektúra

### Fájl struktúra

```
linear-clockify/
├── manifest.json          # Manifest V3 config
├── background.js          # Service worker — timer state, Clockify API
├── content.js             # Linear oldalba injektált — gomb renderelés
├── popup.html             # Toolbar popup markup
├── popup.js               # Toolbar popup logika
├── options.html           # Beállítások markup
├── options.js             # Beállítások logika
├── styles.css             # Gomb stílusok (Linear-hez illeszkedő)
├── icons/                 # Extension ikonok (16, 32, 48, 128)
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
└── docs/
    └── 2026-04-15-linear-clockify-extension-design.md
```

### 4 réteg

1. **Service Worker** (`background.js`) — Központi agy
   - Clockify API hívások (start/stop timer, projektek lekérése, user ID)
   - Timer állapot kezelés (`chrome.storage.local`)
   - Badge frissítés (`chrome.action.setBadgeText`)
   - Message handler a content script-től

2. **Content Script** (`content.js`) — Linear DOM integráció
   - Timer gomb renderelése a Linear issue oldalon
   - Issue adatok kiolvasása (URL parse: team key + issue number, `document.title` a címhez)
   - SPA navigáció figyelése (MutationObserver az URL-re)
   - Storage change listener → gomb állapot szinkron

3. **Popup** (`popup.html` + `popup.js`) — Toolbar ikon
   - Futó timer részletei (issue cím, projekt, eltelt idő)
   - Stop gomb
   - "Nincs aktív timer" állapot

4. **Options** (`options.html` + `options.js`) — Beállítások
   - Clockify API key input
   - Workspace ID (alapértelmezett: `5ef305cdb6b6d1294b8a04c0`)
   - Team → Projekt mapping tábla (szerkeszthető)
   - Auto-stop checkbox

## Adatáramlás

```
Linear DOM/URL → Content Script → chrome.runtime.sendMessage → Background (Service Worker)
                                                                    ↓
                                                              Clockify API
                                                                    ↓
                                                          chrome.storage.local
                                                                    ↓
                                                   Content Script + Popup (storage listener)
```

- Content script **nem hív közvetlenül API-t** — minden a background-on keresztül
- `chrome.storage.local` az egyetlen source of truth
- Minden UI (content script gomb, popup, badge) a `chrome.storage.onChanged` listener-en keresztül szinkronizálódik

## Kommunikáció

| Irány | Mechanizmus |
|---|---|
| Content → Background | `chrome.runtime.sendMessage({ action, data })` |
| Background → Content/Popup | `chrome.storage.local.set()` → `onChanged` listener |
| Background → Badge | `chrome.action.setBadgeText/setBadgeBackgroundColor` |

### Message típusok (Content → Background)

| Action | Data | Válasz |
|---|---|---|
| `startTimer` | `{ issueKey, issueTitle, teamKey }` | `{ success, error? }` |
| `stopTimer` | — | `{ success, error? }` |
| `getStatus` | — | `{ activeTimer }` |

## Storage séma

```json
{
  "activeTimer": {
    "timeEntryId": "clockify-entry-id",
    "issueKey": "IT-1",
    "issueTitle": "Post booking automsg",
    "projectName": "IT",
    "startedAt": "2026-04-15T10:30:00Z"
  },
  "projectCache": {
    "IT": "clockify-project-id-123",
    "Sales": "clockify-project-id-456"
  },
  "settings": {
    "apiKey": "",
    "workspaceId": "5ef305cdb6b6d1294b8a04c0",
    "autoStop": false,
    "teamMapping": {
      "GG": "Cég működése",
      "MAN": "Management",
      "SAL": "Sales",
      "IT": "IT",
      "FIN": "Pénzügy",
      "HR": "HR",
      "KOM": "Kommunikáció és Vendégek",
      "LBE": "Lakásbekerülés",
      "TUL": "Lakások és Tulajok",
      "LM": "LM Support"
    }
  }
}
```

## Clockify API

Base URL: `https://api.clockify.me/api/v1`
Auth: `X-Api-Key: {apiKey}` header

| Művelet | Endpoint | Method |
|---|---|---|
| Saját user ID | `/user` | GET |
| Futó timer | `/workspaces/{wId}/user/{userId}/time-entries?in-progress=true` | GET |
| Timer indítás | `/workspaces/{wId}/time-entries` | POST |
| Timer leállítás | `/workspaces/{wId}/user/{userId}/time-entries` | PATCH |
| Projekt keresés | `/workspaces/{wId}/projects?name={name}` | GET |

## Linear adatok kiolvasása

Nincs API — DOM/URL alapú:
- **URL pattern:** `linear.app/gghq/issue/{TEAM_KEY}-{NUMBER}/...`
- **Team key:** URL-ből parse (`/issue/IT-1/...` → `IT`)
- **Issue number:** URL-ből parse (`/issue/IT-1/...` → `1`)
- **Issue cím:** `document.title` (Linear a címet teszi a title-be)
- **Clockify leírás formátum:** `[IT-1] Post booking automsg`

## Timer gomb UI

### Állapotok

| Állapot | Gomb | Szín | Extra |
|---|---|---|---|
| Nincs futó timer | ▶ Start | Zöld (#22c55e) | — |
| Ezen az issue-n fut | ⏹ Stop | Piros (#ef4444) | HH:MM:SS eltelt idő (mp-enként frissül) |
| Másik issue-n fut | ⏹ Stop & ▶ Start | Sárga (#eab308) | "Timer fut: [másik issue címe]" |

### Vizuális stílus

- Font: Inter (Linear-rel megegyező)
- Lekerekített sarkok, enyhe árnyék
- Eltelt idő: monospace font
- Elhelyezés: issue header mellé (cím sorába vagy jobb oldali panel tetejére)

## Edge case-ek

| Eset | Kezelés |
|---|---|
| Oldal újratöltés | Content script ellenőrzi `chrome.storage` → megfelelő gomb állapot |
| Több Linear tab | `chrome.storage.onChanged` listener → automatikus szinkron |
| Külső timer (Clockify-ban kézzel indított) | "Külső timer fut" állapot, nem nyúl hozzá |
| SPA navigáció | MutationObserver az URL-re → gomb újrarenderelés |
| Hálózati hiba | 1x retry, utána hibaüzenet a gomb mellett |
| API key nincs beállítva | Gomb helyett "⚙️ Beállítás szükséges" link az options page-re |
| Ismeretlen team | Timer elindul projekt nélkül + figyelmeztetés |
| Auto-stop (opcionális) | Linear tab bezárásakor timer leállítás (ha be van kapcsolva) |

## Chrome permissions

```json
{
  "permissions": ["activeTab", "storage", "alarms"],
  "host_permissions": [
    "https://api.clockify.me/*",
    "https://linear.app/gghq/*"
  ]
}
```

## Nem scope

- Clockify task kezelés
- Linear API integráció (DOM/URL elég)
- Riporting
- Offline support
- Firefox (csak Chrome, later Firefox)
- TypeScript / build tool
