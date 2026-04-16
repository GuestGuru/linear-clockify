# Chrome Web Store Listing

## Rövid leírás (max 132 karakter)

Clockify time tracker button on Linear issue pages. Auto-maps Linear teams to Clockify projects.

## Részletes leírás

Track time on Linear issues directly in Clockify — no tab switching needed.

This extension adds a Clockify timer button to every Linear issue page. When you start a timer, it automatically fills in the Clockify entry with the issue identifier, title, and maps your Linear team to the correct Clockify project.

Features:
- Start/Stop timer button on every Linear issue page
- Manual time entry with from/to inputs and overlap detection
- Toolbar popup showing running timer details
- Automatic team → project mapping (configurable)
- Auto-stop timer when all Linear tabs are closed

Setup:
1. Get your Clockify API key from Settings → Profile → API
2. Get your Linear API key from Settings → API → Personal API keys
3. Open extension options and paste both keys
4. Navigate to a Linear issue and start tracking

This extension is designed for teams using both Linear (project management) and Clockify (time tracking) who want a seamless workflow between the two tools.

## Kategória

Productivity

## Nyelv

English

## Privacy policy URL

https://guestguru.github.io/linear-clockify/privacy-policy.html

---

## Screenshot

Kész: `docs/screenshot-store.png` (1280x800)

---

## Publikálás checklist

- [x] GitHub repo publikus (GuestGuru/linear-clockify)
- [x] Privacy policy elérhető (GitHub Pages)
- [x] Screenshot kész (1280x800 PNG)
- [ ] Chrome Web Store Developer account ($5 egyszeri díj): https://chrome.google.com/webstore/devconsole
- [ ] ZIP feltöltés (lásd parancs lent)
- [ ] Visibility: **Unlisted** (csak linkkel elérhető — belső eszközhöz ideális)
- [ ] Submit review-ra → általában 1-3 munkanap

### ZIP készítés

```bash
cd /path/to/linear-clockify
zip -r linear-clockify.zip manifest.json background.js content.js styles.css popup.html popup.js options.html options.js icons/ privacy-policy.html
```
