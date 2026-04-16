# Linear → Clockify Timer

Chrome extension ami a Linear issue oldalán megjelenít egy Clockify time tracker gombot. A gomb elindítja/leállítja a Clockify timert, automatikusan kitölti a projektet és a leírást a Linear issue adatai alapján.

## Telepítés

### Chrome Web Store (ajánlott)

1. Telepítsd az extensiont a [Chrome Web Store](https://chrome.google.com/webstore/detail/TODO) oldalról
2. Extension ikon → **Options** → Clockify és Linear API key megadása
3. Nyiss egy Linear issue-t → használd a timer gombot

### Kézi telepítés (fejlesztőknek)

1. `chrome://extensions/` → **Developer mode** bekapcsolása
2. **Load unpacked** → válaszd ki ezt a mappát (`linear-clockify/`)
3. Extension ikon → **Options** → Clockify és Linear API key megadása
4. Nyiss egy Linear issue-t → használd a timer gombot

## Funkciók

### Timer gomb a Linear issue oldalon

Minden `linear.app/gghq/issue/*` oldalon megjelenik:

| Állapot | Gomb | Szín |
|---|---|---|
| Nincs futó timer | ▶ Start | Zöld |
| Ezen az issue-n fut | ⏹ Stop + eltelt idő | Piros |
| Másik issue-n fut | ⏹ Stop & ▶ Start | Sárga |

### Manuális időrögzítés

A Linear issue jobb paneljén (desktop) megjelenik egy Clockify card a projektválasztó alatt. Tartalma:

- Duplikált Start/Stop gomb
- **Mettől / Meddig** input (pl. `1413` → `14:13`, Tab → `1500` → `15:00`)
- Dátumválasztó (alapból „Ma")
- **Rögzít** gomb → lezárt Clockify entry-t hoz létre (nem indít futó timert)

Átfedés-ellenőrzés: ha a megadott időtartamra már van Clockify entry (vagy fut egy timer), a mentés blokkolva, és megjelenik a konfliktus.

Mobilon a lebegő timer container mellett van egy **✎** gomb, ami kinyitja ugyanezt a formot.

### Toolbar popup

Az extension ikon kattintásra mutatja a futó timer részleteit (issue, projekt, eltelt idő) és egy Stop gombot.

### Automatikus Clockify mapping

A timer elindulásakor a Clockify entry automatikusan kitöltődik:

- **Leírás:** `[TEAM_KEY-123] Issue title` (pl. `[IT-1] Post booking automsg`)
- **Projekt:** Linear team → Clockify projekt mapping alapján (beállítható)

### Alapértelmezett team → projekt mapping

| Linear team | Clockify projekt |
|---|---|
| GG | Cég működése |
| MAN | Management |
| SAL | Sales |
| IT | IT |
| FIN | Pénzügy |
| HR | HR |
| KOM | Kommunikáció és Vendégek |
| LBE | Lakásindítás |
| TUL | Lakások és Tulajok |
| LM | Lakásmenedzserek |

A mapping szerkeszthető az Options oldalon.

## Beállítások

Az extension Options oldalán (`jobb klikk az ikonon → Options`):

- **Clockify API key** — kötelező ([itt találod](https://app.clockify.me/user/preferences#advanced))
- **Workspace ID** — alapértelmezett: `5ef305cdb6b6d1294b8a04c0`
- **Team → Projekt mapping** — szerkeszthető tábla
- **Auto-stop** — timer leállítása ha az összes Linear tab bezárul

## Technikai részletek

- Chrome Extension Manifest V3
- Vanilla JavaScript, nincs build step
- Clockify REST API (`https://api.clockify.me/api/v1`)
- Linear GraphQL API (`https://api.linear.app/graphql`)

### Fájl struktúra

```
manifest.json       Manifest V3 config
background.js       Service worker — Clockify API, timer state, badge
content.js          Linear oldalba injektált — gomb renderelés
styles.css          Gomb stílusok
popup.html/js       Toolbar popup
options.html/js     Beállítások
icons/              Extension ikonok
```
