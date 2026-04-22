# Linear → Clockify Timer

Chrome extension Clockify time-trackerhez, Linear + HelpScout integrációval. Az extension ikonjára kattintva nyíló popupból indítasz/leállítasz timert a jelenlegi Linear issue vagy HelpScout conversation alapján, automatikusan kitöltött projekttel és leírással.

## Telepítés

Az extension még nincs fent a Chrome Web Store-on, ezért letöltött zip fájlból kell telepíteni.

**→ Letöltés + részletes útmutató: [docs/TELEPITES.md](docs/TELEPITES.md)**

Rövid verzió:

1. Töltsd le a zipet: https://guestguru.github.io/linear-clockify/ (vagy közvetlenül a [legfrissebb release](https://github.com/GuestGuru/linear-clockify/releases/latest))
2. Csomagold ki egy állandó mappába (ne mozgasd utána!)
3. `chrome://extensions/` → **Developer mode** ON → **Load unpacked** → válaszd a mappát
4. Extension ikon → **Options** → Clockify és Linear API key megadása
5. Nyiss egy Linear issue-t vagy HelpScout conversationt → kattints az extension ikonjára

### Fejlesztőknek

Ha a repót klónozod (nem zipet töltesz le): `chrome://extensions/` → Developer mode ON → Load unpacked → válaszd ki a repo gyökerét.

## Funkciók

Minden UI a **toolbar popupban** él (extension ikonra kattintás). Az oldalakba nem injektálunk widgetet — a content script csak annyit csinál, hogy a popup kérésére visszaadja a jelenlegi oldal kontextusát (Linear issue key/team/title, HelpScout conv id/subject/customer/emails).

### Popup — Start szekció

Ha a jelenlegi tab Linear issue vagy HelpScout conversation, és nem fut timer, a popup tetején megjelenik egy Start szekció:

- **Context sor** — issue key / HS ticket szám + cím
- **▶ Start** — timer indítása most
- **↶ HH:MM Start** (snap gomb) — ha az előző entry vége 30 percen belül volt, az exact lezárás időpontjától indít (nincs lyuk); kikapcsolható a Clockify oldalán
- **✎ Manuális** — mettől/meddig + dátumválasztó; lezárt Clockify entry-t rögzít (nem indít futó timert), átfedés-ellenőrzéssel

### Popup — Futó timer

Ha fut egy timer, a Legutóbbi bejegyzések listában a top sor pirossal kiemelve, a végidő mezőben élő eltelt időt mutat (`MM:SS` 60 perc alatt, `HH:MM` felett), alatta:

- **⏹ Stop** — timer leállítása
- **✓ Stop & Done** (csak Linear-alapú timerre, ha van teljes Linear config) — timer stop + a Linear issue `Done` state-re állítva

HelpScout-ból indított timernél: ha nincs még Linear issue a conversationhöz, az első Start automatikusan létrehoz egyet (attachment linkkel), így a Stop & Done működik.

### Popup — Legutóbbi bejegyzések

A popup alján a legutóbbi Clockify entry-k (alapból 3, Options-ben 1–20). Soronként:

- Linear link (`TEAM-123`) és/vagy `HS` link — közvetlen ugrás az issue / conversation oldalra
- Leírás, start/end idő inline szerkeszthető (pl. `1413` → `14:13`), Tab/blur ment
- Időtartam, **▶** (timer indítása ugyanezekkel az adatokkal) és **×** (törlés kétlépcsős megerősítéssel)

### Automatikus Clockify mapping

A timer elindulásakor a Clockify entry automatikusan kitöltődik:

- **Leírás:** `[TEAM_KEY-123] Issue title` (pl. `[IT-1] Post booking automsg`)
- **HelpScout-ból indított timer:** `[LIN-123] Subject — Customer [HS: 3259965890]` — a záró `[HS: LONGID]` a HelpScout conversation long id-ja, így az entry-ről közvetlenül linkelhető a ticket.
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
- **Legutóbbi bejegyzések száma** — hány Clockify entry jelenjen meg a popupban (1–20, alapból 3)

## Technikai részletek

- Chrome Extension Manifest V3
- Vanilla JavaScript, nincs build step
- Clockify REST API (`https://api.clockify.me/api/v1`)
- Linear GraphQL API (`https://api.linear.app/graphql`)

### Fájl struktúra

```
manifest.json       Manifest V3 config
background.js       Service worker — Clockify/Linear API, timer state, badge
content.js          Linear oldalba injektált — page context resolver (popup kérésére)
hs-content.js       HelpScout oldalba injektált — page context resolver (popup kérésére)
shared.js           Közös helperek (background + hs-content + popup)
popup.html/js       Toolbar popup — teljes UI
options.html/js     Beállítások
icons/              Extension ikonok
build-zip.sh        Terjeszthető zip generálása
scripts/release.sh  Verzió bump + git tag helper
.github/workflows/  CI — tag-push triggerre release + zip upload
docs/index.html     GitHub Pages landing (letöltő oldal)
docs/TELEPITES.md   Végfelhasználói telepítési útmutató
docs/QA-CHECKLIST.md Manual QA lista release előtt
```

## Release kiadás

Új verzió kiadása:

```bash
./scripts/release.sh patch   # 1.0.0 -> 1.0.1 (patch/minor/major vagy X.Y.Z)
git push && git push origin vX.Y.Z
```

Mi történik:

1. A script bumpolja a `manifest.json` `version` mezőt, commitolja és létrehozza a `vX.Y.Z` taget (push még nem).
2. A tag pusholása után a `.github/workflows/release.yml` lefut: ellenőrzi hogy a tag és a manifest verzió egyezik-e, lefuttatja a `build-zip.sh`-t, létrehozza a GitHub Release-t és feltölti a `linear-clockify.zip`-et asset-ként.
3. A `https://guestguru.github.io/linear-clockify/` landing page letöltő gombja automatikusan az új release zipjére mutat (`releases/latest/download/linear-clockify.zip`).

Fejlesztés közbeni gyors zip builderhez workflow nélkül: `./build-zip.sh`.
