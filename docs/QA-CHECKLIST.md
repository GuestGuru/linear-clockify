# Manual QA checklist — Linear integráció

Ezt a listát release előtt (vagy Linear-érintő változtatás után) lehet végigfuttatni. Nem automatizált teszt — csak emberi kattintgatás.

## Setup

- [ ] Linear API key a `linear.app/settings/api`-ból generálva
- [ ] Options oldalon → Linear API key beírva → "🔎 Linear teszt" zöld visszajelzést ad
- [ ] TUL team kiválasztva a dropdown-ból
- [ ] Save → "Beállítások mentve"

## Happy path — új conversation

- [ ] Menj egy olyan HS conv-re, amire még nem indítottál timert
- [ ] Kattints ▶ Start
- [ ] Linear-ben: új issue a TUL-ban, In Progress, téged assignolt, title = `{subject} [HS: #{short}]`, description-ben partner név + HS link
- [ ] Linear issue sidebarján: Helpscout attachment a conv URL-jével
- [ ] Clockify-ban: futó timer `[LIN-xxx] {subject} — {customer}` leírással
- [ ] HS oldalon: a gomb Stop-ra vált

## Happy path — meglévő conversation

- [ ] Kattints ▶ Start újra ugyanazon a conv-n
- [ ] Linear-ben: **ugyanaz** az issue (nem új), a Clockify ugyanazt a LIN-xxx-t kapja

## Manuális rögzítés

- [ ] Friss HS conv, töltsd ki a "Mettől – Meddig" mezőket, kattints Rögzít
- [ ] Clockify-ban: historikus entry `[LIN-xxx] ...` leírással
- [ ] Linear-ben: az issue is létrejött (attachment-tel)

## Konfiguráció hiány

- [ ] Töröld a `linearDefaultTeamId`-t a DevTools-ból:
      `chrome.storage.local.get('settings').then(({settings}) => chrome.storage.local.set({settings: {...settings, linearDefaultTeamId: ''}}));`
- [ ] Start gombra → "Linear beállítás szükséges" + link az options-ra
- [ ] Clockify timer NEM indult
- [ ] Állítsd vissza, happy path újra működik

## Lezárt issue megőrzése

- [ ] Egy meglévő issue-t kézzel zárj le Linear-ben (state = Done)
- [ ] Kattints újra Start-ra a HS conv-n
- [ ] Linear-ben: az issue marad Done-ban (**nem** kerül vissza In Progress-be) — manuálisan kell reopen-elned

## Stop & Done gomb

- [ ] HS timer start A ticketen → navigálj B ticketre → `⏹ Stop` → timer leáll, A Linear issue marad `In Progress`-ben
- [ ] HS timer start A ticketen → navigálj B ticketre → `✓ Stop & Done` → timer leáll, A Linear issue `Done` state-re vált
- [ ] HS timer start A ticketen (ugyanazon a ticketen maradsz) → `✓ Stop & Done` → timer leáll, A Linear issue `Done`
- [ ] Extension popup: futó timer → `⏹ Stop` → leáll, issue változatlan
- [ ] Extension popup: futó timer → `✓ Stop & Done` → leáll, Linear issue Done
- [ ] Extension popup: külső (másik eszközön indított) timer → csak `⏹ Stop` látszik, `Stop & Done` nincs
- [ ] Ha Linear config hiányzik, HS-ben nincs timer gomb, popup-ban csak Stop (nem Done)
- [ ] Első Stop & Done lassabb (GraphQL lookup); második ugyanazon team-en gyors (cache)
