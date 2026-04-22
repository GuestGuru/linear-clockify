# Linear → Clockify Timer — Telepítési útmutató

Ez a Chrome extension egy Clockify time tracker gombot tesz a Linear issue oldalakra. Indítja/leállítja a timert, automatikusan kitölti a projektet és a leírást.

## 1. Zip fájl kicsomagolása

Kaptál egy `linear-clockify.zip` fájlt. **Csomagold ki egy olyan mappába, ahol hosszú távon is lesz** — például:

- macOS: `~/Applications/linear-clockify/` vagy `~/Documents/chrome-extensions/linear-clockify/`
- Windows: `C:\ChromeExtensions\linear-clockify\`

> ⚠️ **Fontos:** a kicsomagolás után **ne mozgasd és ne töröld** ezt a mappát! A Chrome minden indításkor innen olvassa be az extensiont. Ha elmozdítod, az extension eltűnik és újra kell tölteni.

A kicsomagolás után a mappában ilyen fájloknak kell lenniük:

```
linear-clockify/
├── manifest.json
├── background.js
├── content.js
├── hs-content.js
├── popup.html
├── options.html
├── icons/
└── ...
```

## 2. Chrome Developer mode bekapcsolása

1. Nyisd meg a Chrome-ban ezt a címet: `chrome://extensions/`
2. A jobb felső sarokban kapcsold be a **Developer mode** (Fejlesztői mód) kapcsolót

## 3. Extension betöltése

1. Még mindig a `chrome://extensions/` oldalon: kattints a **Load unpacked** (Kicsomagolt bővítmény betöltése) gombra — bal felül jelent meg, miután bekapcsoltad a Developer mode-ot
2. Válaszd ki azt a mappát, ahová az 1. lépésben kicsomagoltad a zipet (pl. `linear-clockify/`)
3. Az extensionnek meg kell jelennie a listában **Linear → Clockify Timer** néven

Ha a pin ikonra (🧩 puzzle, jobb felső sarok) rákattintasz és kitűzöd az extensiont, látszik majd az eszköztáron.

## 4. API kulcsok beszerzése

Az extension két API kulcsot kér a beállításokban.

### Clockify API key

1. Menj ide: **https://app.clockify.me/manage-api-keys**
2. Ha még nincs aktív kulcsod: kattints **Generate** gombra
3. Másold ki a kulcsot (egyszer látszik, érdemes jelszókezelőbe menteni)

### Linear API key

1. Menj ide: **https://linear.app/gghq/settings/account/security**
2. Görgess a **Personal API keys** szekcióhoz
3. **New API key** → adj neki egy nevet (pl. `linear-clockify-extension`)
4. Másold ki a kulcsot (ez is csak egyszer látszik!)

## 5. API kulcsok megadása az extensionben

1. Kattints jobb gombbal az extension ikonjára → **Options**
   *(vagy: `chrome://extensions/` → **Linear → Clockify Timer** kártya → **Details** → **Extension options**)*
2. Illeszd be a **Clockify API key** és **Linear API key** mezőkbe a kulcsokat
3. **Mentés**

## 6. Használat

1. Nyiss egy Linear issue-t (pl. `https://linear.app/gghq/issue/...`)
2. Az issue fejlécén megjelenik egy **▶ Start** gomb
3. Kattints rá → elindul a Clockify timer a megfelelő projekttel és leírással
4. Ha újra rákattintasz **⏹ Stop** → leáll a timer
5. Ha másik issue-n is nyomsz Startot, az előző automatikusan leáll

A jobb oldali panelen megjelenik egy **Clockify card** is, ahol manuálisan (mettől-meddig) is rögzíthetsz időt.

## Gyakori hibák

**„This extension may have been corrupted" vagy „Load unpacked failed"**
→ Valószínűleg nem a megfelelő mappát választottad ki. Azt a mappát kell kiválasztani, amelyikben közvetlenül ott van a `manifest.json`.

**„Developer mode extensions" figyelmeztetés Chrome indításkor**
→ Ez normál, mert nem a Chrome Web Store-ból telepítettük. Nyugodtan nyomd meg a **Keep** / **Maradjon** gombot.

**Eltűnt az extension Chrome újraindítás után**
→ A kicsomagolt mappát valaki/valami elmozdította vagy törölte. Csomagold ki újra egy stabil helyre és töltsd be újra (Load unpacked).

**„Invalid API key" hiba**
→ Ellenőrizd az Options oldalon, hogy a helyes kulcsot másoltad-e be, szóközök nélkül. Ha kétséges, generálj újat.

**Nem jelenik meg a timer gomb a Linear issue-n**
→ Frissítsd az oldalt (Cmd/Ctrl + R). Ha továbbra sem látszik, ellenőrizd, hogy az URL `https://linear.app/gghq/...` alatt van-e.

## Frissítés új verzióra

Amikor új zip fájlt kapsz:

1. Csomagold ki **ugyanabba a mappába**, felülírva a régi fájlokat
   *(vagy törölheted a régi mappa tartalmát és kicsomagolod oda az újat)*
2. `chrome://extensions/` → **Linear → Clockify Timer** kártyán a **🔄 Reload** gomb
3. Az új verzió azonnal aktív

## Linear integráció tesztelés (manual QA)

### Setup
- [ ] Linear API key a `linear.app/settings/api`-ból generálva
- [ ] Options oldalon → Linear API key beírva → "🔎 Linear teszt" zöld visszajelzést ad
- [ ] TUL team kiválasztva a dropdown-ból
- [ ] Save → "Beállítások mentve"

### Happy path — új conversation
- [ ] Menj egy olyan HS conv-re, amire még nem indítottál timert
- [ ] Kattints ▶ Start
- [ ] Linear-ben: új issue a TUL-ban, In Progress, téged assignolt, title = `{subject} [HS: #{short}]`, description-ben partner név + HS link
- [ ] Linear issue sidebarján: Helpscout attachment a conv URL-jével
- [ ] Clockify-ban: futó timer `[LIN-xxx] {subject} — {customer}` leírással
- [ ] HS oldalon: a gomb Stop-ra vált

### Happy path — meglévő conversation
- [ ] Kattints ▶ Start újra ugyanazon a conv-n
- [ ] Linear-ben: **ugyanaz** az issue (nem új), a Clockify ugyanazt a LIN-xxx-t kapja

### Manuális rögzítés
- [ ] Friss HS conv, töltsd ki a "Mettől – Meddig" mezőket, kattints Rögzít
- [ ] Clockify-ban: historikus entry `[LIN-xxx] ...` leírással
- [ ] Linear-ben: az issue is létrejött (attachment-tel)

### Konfiguráció hiány
- [ ] Töröld a `linearDefaultTeamId`-t a DevTools-ból:
      `chrome.storage.local.get('settings').then(({settings}) => chrome.storage.local.set({settings: {...settings, linearDefaultTeamId: ''}}));`
- [ ] Start gombra → "Linear beállítás szükséges" + link az options-ra
- [ ] Clockify timer NEM indult
- [ ] Állítsd vissza, happy path újra működik

### Lezárt issue megőrzése
- [ ] Egy meglévő issue-t kézzel zárj le Linear-ben (state = Done)
- [ ] Kattints újra Start-ra a HS conv-n
- [ ] Linear-ben: az issue marad Done-ban (**nem** kerül vissza In Progress-be) — manuálisan kell reopen-elned

### Stop & Done gomb
- [ ] HS timer start A ticketen → navigálj B ticketre → `⏹ Stop` → timer leáll, A Linear issue marad `In Progress`-ben
- [ ] HS timer start A ticketen → navigálj B ticketre → `✓ Stop & Done` → timer leáll, A Linear issue `Done` state-re vált
- [ ] HS timer start A ticketen (ugyanazon a ticketen maradsz) → `✓ Stop & Done` → timer leáll, A Linear issue `Done`
- [ ] Extension popup: futó timer → `⏹ Stop` → leáll, issue változatlan
- [ ] Extension popup: futó timer → `✓ Stop & Done` → leáll, Linear issue Done
- [ ] Extension popup: külső (másik eszközön indított) timer → csak `⏹ Stop` látszik, `Stop & Done` nincs
- [ ] Ha Linear config hiányzik, HS-ben nincs timer gomb, popup-ban csak Stop (nem Done)
- [ ] Első Stop & Done lassabb (GraphQL lookup); második ugyanazon team-en gyors (cache)
