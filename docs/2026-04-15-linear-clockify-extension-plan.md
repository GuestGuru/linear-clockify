# Linear → Clockify Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome extension that adds a Clockify timer button to Linear issue pages, auto-mapping Linear teams to Clockify projects.

**Architecture:** Manifest V3 Chrome extension with 4 layers: service worker (Clockify API + state), content script (Linear DOM integration), popup (toolbar timer view), options page (settings). Communication via `chrome.runtime.sendMessage` + `chrome.storage.onChanged`.

**Tech Stack:** Vanilla JavaScript, Chrome Extension Manifest V3, Clockify REST API, no build tools.

**Project location:** `~/dev/GG/linear-clockify`

**Security note:** All dynamic values rendered into HTML use `escapeHtml()` / `escapeAttr()` helpers. No raw user input is inserted via innerHTML.

---

## File Map

| File | Responsibility | Created in |
|---|---|---|
| `manifest.json` | Extension config, permissions, scripts | Task 1 |
| `background.js` | Service worker: Clockify API, timer state, badge, message handler | Task 2 |
| `content.js` | Linear page integration: URL parsing, button rendering, SPA navigation | Task 3 |
| `styles.css` | Timer button styles matching Linear UI | Task 3 |
| `popup.html` | Toolbar popup markup | Task 4 |
| `popup.js` | Toolbar popup logic: timer display, stop button | Task 4 |
| `options.html` | Settings page markup | Task 5 |
| `options.js` | Settings page logic: API key, mapping table | Task 5 |
| `icons/icon-*.png` | Extension icons (16, 32, 48, 128) | Task 1 |

---

## Task 1: Project scaffold — manifest + icons + git init

**Files:**
- Create: `manifest.json`
- Create: `icons/icon-16.png`, `icons/icon-32.png`, `icons/icon-48.png`, `icons/icon-128.png`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git repo**

```bash
cd ~/dev/GG/linear-clockify
git init
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
.DS_Store
*.crx
*.pem
```

- [ ] **Step 3: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Linear → Clockify Timer",
  "version": "1.0.0",
  "description": "Clockify time tracker button on Linear issue pages. Auto-maps Linear teams to Clockify projects.",
  "permissions": ["storage", "alarms"],
  "host_permissions": [
    "https://api.clockify.me/*",
    "https://linear.app/gghq/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://linear.app/gghq/issue/*"],
      "js": ["content.js"],
      "css": ["styles.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  },
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

- [ ] **Step 4: Create placeholder icons**

Generate simple colored square PNG icons at 16x16, 32x32, 48x48, 128x128 pixels. Use a clock/timer icon or a simple "LC" text. These are placeholders — can be replaced later with proper design.

Use a canvas-based generator script or download from an icon library. The icons should be visually distinguishable from other extensions.

- [ ] **Step 5: Create empty stub files so the extension loads without errors**

Create these empty files so Chrome can load the extension:

`background.js`:
```js
// Linear → Clockify Timer — Service Worker
// Handles Clockify API calls, timer state, and badge updates.

console.log('[LC] Service worker loaded');
```

`content.js`:
```js
// Linear → Clockify Timer — Content Script
// Renders timer button on Linear issue pages.

console.log('[LC] Content script loaded');
```

`styles.css`:
```css
/* Linear → Clockify Timer — Button Styles */
```

`popup.html`:
```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Clockify Timer</title></head>
<body><p>Loading...</p><script src="popup.js"></script></body>
</html>
```

`popup.js`:
```js
// Linear → Clockify Timer — Popup
console.log('[LC] Popup loaded');
```

`options.html`:
```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Linear → Clockify Beállítások</title></head>
<body><p>Loading...</p><script src="options.js"></script></body>
</html>
```

`options.js`:
```js
// Linear → Clockify Timer — Options
console.log('[LC] Options loaded');
```

- [ ] **Step 6: Verify — load extension in Chrome**

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `~/dev/GG/linear-clockify`
4. Extension should load without errors
5. Extension icon should appear in toolbar

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: project scaffold — manifest v3, icons, stub files"
```

---

## Task 2: Background service worker — Clockify API + timer state

**Files:**
- Rewrite: `background.js`

This is the core of the extension. It handles all Clockify API communication, timer state management, and badge updates.

- [ ] **Step 1: Implement Clockify API helper functions**

Write the following functions in `background.js`:

```js
const CLOCKIFY_BASE = 'https://api.clockify.me/api/v1';

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || {
    apiKey: '',
    workspaceId: '5ef305cdb6b6d1294b8a04c0',
    autoStop: false,
    teamMapping: {
      GG: 'Cég működése',
      MAN: 'Management',
      SAL: 'Sales',
      IT: 'IT',
      FIN: 'Pénzügy',
      HR: 'HR',
      KOM: 'Kommunikáció és Vendégek',
      LBE: 'Lakásbekerülés',
      TUL: 'Lakások és Tulajok',
      LM: 'LM Support',
    },
  };
}

async function clockifyFetch(path, options = {}) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('NO_API_KEY');
  }
  const url = `${CLOCKIFY_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'X-Api-Key': settings.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Clockify API ${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function getUserId() {
  const { userId } = await chrome.storage.local.get('userId');
  if (userId) return userId;
  const user = await clockifyFetch('/user');
  await chrome.storage.local.set({ userId: user.id });
  return user.id;
}

async function resolveProjectId(projectName) {
  const { projectCache } = await chrome.storage.local.get('projectCache');
  const cache = projectCache || {};
  if (cache[projectName]) return cache[projectName];

  const settings = await getSettings();
  const projects = await clockifyFetch(
    `/workspaces/${settings.workspaceId}/projects?name=${encodeURIComponent(projectName)}`
  );
  const match = projects.find((p) => p.name === projectName);
  if (!match) return null;

  cache[projectName] = match.id;
  await chrome.storage.local.set({ projectCache: cache });
  return match.id;
}
```

- [ ] **Step 2: Implement timer start/stop functions**

Add these functions to `background.js`:

```js
async function startTimer(issueKey, issueTitle, teamKey) {
  const settings = await getSettings();
  const projectName = settings.teamMapping[teamKey];
  let projectId = null;
  let warning = null;

  if (projectName) {
    projectId = await resolveProjectId(projectName);
  } else {
    warning = `Ismeretlen team: ${teamKey}`;
  }

  const body = {
    start: new Date().toISOString(),
    description: `[${issueKey}] ${issueTitle}`,
  };
  if (projectId) {
    body.projectId = projectId;
  }

  const entry = await clockifyFetch(
    `/workspaces/${settings.workspaceId}/time-entries`,
    { method: 'POST', body: JSON.stringify(body) }
  );

  const activeTimer = {
    timeEntryId: entry.id,
    issueKey,
    issueTitle,
    projectName: projectName || null,
    startedAt: body.start,
  };
  await chrome.storage.local.set({ activeTimer });
  updateBadge(activeTimer);

  return { success: true, warning };
}

async function stopTimer() {
  const settings = await getSettings();
  const userId = await getUserId();

  await clockifyFetch(
    `/workspaces/${settings.workspaceId}/user/${userId}/time-entries`,
    { method: 'PATCH', body: JSON.stringify({ end: new Date().toISOString() }) }
  );

  await chrome.storage.local.remove('activeTimer');
  clearBadge();

  return { success: true };
}

async function checkRunningTimer() {
  const settings = await getSettings();
  if (!settings.apiKey) return;

  const userId = await getUserId();
  const entries = await clockifyFetch(
    `/workspaces/${settings.workspaceId}/user/${userId}/time-entries?in-progress=true`
  );

  if (!entries || entries.length === 0) {
    await chrome.storage.local.remove('activeTimer');
    clearBadge();
    return;
  }

  const entry = entries[0];
  const { activeTimer } = await chrome.storage.local.get('activeTimer');

  // If our tracked timer matches, keep it. Otherwise mark as external.
  if (activeTimer && activeTimer.timeEntryId === entry.id) {
    updateBadge(activeTimer);
    return;
  }

  // External timer — parse description to see if it's a Linear issue
  const match = entry.description?.match(/^\[([A-Z]+-\d+)\]\s*(.+)$/);
  if (match) {
    const externalTimer = {
      timeEntryId: entry.id,
      issueKey: match[1],
      issueTitle: match[2],
      projectName: null,
      startedAt: entry.timeInterval.start,
      external: true,
    };
    await chrome.storage.local.set({ activeTimer: externalTimer });
    updateBadge(externalTimer);
  } else {
    const externalTimer = {
      timeEntryId: entry.id,
      issueKey: null,
      issueTitle: entry.description || 'Külső timer',
      projectName: null,
      startedAt: entry.timeInterval.start,
      external: true,
    };
    await chrome.storage.local.set({ activeTimer: externalTimer });
    updateBadge(externalTimer);
  }
}
```

- [ ] **Step 3: Implement badge update functions**

Add these to `background.js`:

```js
function updateBadge(activeTimer) {
  if (!activeTimer) {
    clearBadge();
    return;
  }
  const elapsed = Date.now() - new Date(activeTimer.startedAt).getTime();
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const text = hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : `${minutes}m`;

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: '' });
}

// Refresh badge every minute
chrome.alarms.create('badge-refresh', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'badge-refresh') {
    chrome.storage.local.get('activeTimer', ({ activeTimer }) => {
      updateBadge(activeTimer);
    });
  }
});
```

- [ ] **Step 4: Implement message handler**

Add the message listener that the content script and popup will call:

```js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    try {
      switch (message.action) {
        case 'startTimer': {
          const { issueKey, issueTitle, teamKey } = message.data;
          return await startTimer(issueKey, issueTitle, teamKey);
        }
        case 'stopTimer': {
          return await stopTimer();
        }
        case 'stopAndStartTimer': {
          await stopTimer();
          const { issueKey, issueTitle, teamKey } = message.data;
          return await startTimer(issueKey, issueTitle, teamKey);
        }
        case 'getStatus': {
          const { activeTimer } = await chrome.storage.local.get('activeTimer');
          return { activeTimer: activeTimer || null };
        }
        case 'openOptions': {
          chrome.runtime.openOptionsPage();
          return { success: true };
        }
        default:
          return { error: `Unknown action: ${message.action}` };
      }
    } catch (err) {
      if (err.message === 'NO_API_KEY') {
        return { error: 'NO_API_KEY' };
      }
      // Retry once on network error
      if (err.message.includes('Failed to fetch') && !message._retried) {
        message._retried = true;
        return handler();
      }
      return { error: err.message };
    }
  };

  handler().then(sendResponse);
  return true; // keep message channel open for async response
});

// On install/startup, check for running timer
chrome.runtime.onInstalled.addListener(() => checkRunningTimer());
chrome.runtime.onStartup.addListener(() => checkRunningTimer());
```

- [ ] **Step 5: Verify — reload extension, check service worker console**

1. Go to `chrome://extensions/` → click "Update" on the extension
2. Click "Service Worker" link under the extension to open its DevTools
3. No errors in console

- [ ] **Step 6: Commit**

```bash
git add background.js
git commit -m "feat: background service worker — Clockify API, timer state, badge, message handler"
```

---

## Task 3: Content script — timer button on Linear issue pages

**Files:**
- Rewrite: `content.js`
- Rewrite: `styles.css`

- [ ] **Step 1: Implement URL parsing and issue data extraction**

Write the URL parser and title extractor in `content.js`:

```js
function parseIssueFromUrl() {
  const match = window.location.pathname.match(/\/gghq\/issue\/([A-Z]+)-(\d+)/);
  if (!match) return null;
  return { teamKey: match[1], issueNumber: match[2], issueKey: `${match[1]}-${match[2]}` };
}

function getIssueTitle() {
  // Linear sets document.title to "Issue Title — Linear"
  const title = document.title.replace(/\s*[—–-]\s*Linear\s*$/, '').trim();
  return title || 'Untitled';
}
```

- [ ] **Step 2: Implement timer button rendering**

Add button creation and state management. Uses DOM methods (createElement, textContent) — no innerHTML with dynamic data:

```js
const BUTTON_CONTAINER_ID = 'lc-timer-container';

function createTimerButton() {
  const existing = document.getElementById(BUTTON_CONTAINER_ID);
  if (existing) existing.remove();

  const issue = parseIssueFromUrl();
  if (!issue) return;

  const container = document.createElement('div');
  container.id = BUTTON_CONTAINER_ID;

  const button = document.createElement('button');
  button.id = 'lc-timer-button';
  button.className = 'lc-btn lc-btn-start';
  button.textContent = '▶ Start';

  const elapsed = document.createElement('span');
  elapsed.id = 'lc-elapsed';
  elapsed.className = 'lc-elapsed';
  elapsed.style.display = 'none';

  const info = document.createElement('span');
  info.id = 'lc-info';
  info.className = 'lc-info';
  info.style.display = 'none';

  container.appendChild(button);
  container.appendChild(elapsed);
  container.appendChild(info);

  // Find insertion point — Linear's issue header area
  const insertionPoint = findInsertionPoint();
  if (insertionPoint) {
    insertionPoint.appendChild(container);
  }

  button.addEventListener('click', handleButtonClick);
  updateButtonState();
}

function findInsertionPoint() {
  // Try the issue identifier element (e.g. "IT-1") and insert after its parent row
  const identifiers = document.querySelectorAll('a[href*="/issue/"]');
  for (const el of identifiers) {
    if (el.textContent.match(/^[A-Z]+-\d+$/)) {
      const row = el.closest('div');
      if (row) return row.parentElement;
    }
  }

  // Fallback: insert before the main content area
  const main = document.querySelector('main') || document.querySelector('[data-view-id]');
  if (main) return main;

  return document.body;
}
```

- [ ] **Step 3: Implement button click handler**

```js
async function handleButtonClick() {
  const issue = parseIssueFromUrl();
  if (!issue) return;

  const button = document.getElementById('lc-timer-button');
  button.disabled = true;

  try {
    const { activeTimer } = await chrome.storage.local.get('activeTimer');

    if (activeTimer && activeTimer.issueKey === issue.issueKey && !activeTimer.external) {
      // Stop timer on current issue
      const result = await chrome.runtime.sendMessage({ action: 'stopTimer' });
      if (result.error) showError(result.error);
    } else if (activeTimer && !activeTimer.external) {
      // Stop other timer, start new one
      const result = await chrome.runtime.sendMessage({
        action: 'stopAndStartTimer',
        data: { issueKey: issue.issueKey, issueTitle: getIssueTitle(), teamKey: issue.teamKey },
      });
      if (result.error) showError(result.error);
      if (result.warning) showWarning(result.warning);
    } else {
      // No timer running (or external) — start new
      const result = await chrome.runtime.sendMessage({
        action: 'startTimer',
        data: { issueKey: issue.issueKey, issueTitle: getIssueTitle(), teamKey: issue.teamKey },
      });
      if (result.error) showError(result.error);
      if (result.warning) showWarning(result.warning);
    }
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
  }
}

function showError(message) {
  const info = document.getElementById('lc-info');
  if (!info) return;

  if (message === 'NO_API_KEY') {
    info.style.display = 'inline';
    info.textContent = '';
    const link = document.createElement('a');
    link.href = '#';
    link.className = 'lc-settings-link';
    link.textContent = '⚙️ Beállítás szükséges';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: 'openOptions' });
    });
    info.appendChild(link);
    return;
  }

  info.style.display = 'inline';
  info.textContent = '❌ ' + message;
  setTimeout(() => { info.style.display = 'none'; }, 5000);
}

function showWarning(message) {
  const info = document.getElementById('lc-info');
  if (!info) return;
  info.style.display = 'inline';
  info.textContent = '⚠️ ' + message;
  setTimeout(() => { info.style.display = 'none'; }, 5000);
}
```

- [ ] **Step 4: Implement button state updater and elapsed time display**

```js
let elapsedInterval = null;

async function updateButtonState() {
  const issue = parseIssueFromUrl();
  if (!issue) return;

  const button = document.getElementById('lc-timer-button');
  const elapsed = document.getElementById('lc-elapsed');
  const info = document.getElementById('lc-info');
  if (!button) return;

  const { settings } = await chrome.storage.local.get('settings');

  // No API key configured
  if (!settings?.apiKey) {
    button.style.display = 'none';
    if (info) {
      info.style.display = 'inline';
      info.textContent = '';
      const link = document.createElement('a');
      link.href = '#';
      link.className = 'lc-settings-link';
      link.textContent = '⚙️ Beállítás szükséges';
      link.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ action: 'openOptions' });
      });
      info.appendChild(link);
    }
    return;
  }

  button.style.display = '';
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }

  const { activeTimer } = await chrome.storage.local.get('activeTimer');

  if (!activeTimer || activeTimer.external) {
    // No timer or external timer — show Start
    button.className = 'lc-btn lc-btn-start';
    button.textContent = '▶ Start';
    elapsed.style.display = 'none';
    info.style.display = 'none';
  } else if (activeTimer.issueKey === issue.issueKey) {
    // Timer on THIS issue — show Stop + elapsed
    button.className = 'lc-btn lc-btn-stop';
    button.textContent = '⏹ Stop';
    elapsed.style.display = 'inline';
    startElapsedCounter(activeTimer.startedAt);
    info.style.display = 'none';
  } else {
    // Timer on ANOTHER issue — show Switch
    button.className = 'lc-btn lc-btn-switch';
    button.textContent = '⏹ Stop & ▶ Start';
    elapsed.style.display = 'none';
    info.style.display = 'inline';
    info.textContent = 'Timer fut: ' + activeTimer.issueTitle;
  }
}

function startElapsedCounter(startedAt) {
  const elapsed = document.getElementById('lc-elapsed');
  if (!elapsed) return;

  function update() {
    const diff = Date.now() - new Date(startedAt).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    elapsed.textContent =
      String(h).padStart(2, '0') + ':' +
      String(m).padStart(2, '0') + ':' +
      String(s).padStart(2, '0');
  }

  update();
  elapsedInterval = setInterval(update, 1000);
}
```

- [ ] **Step 5: Implement SPA navigation observer and storage sync**

```js
// Watch for URL changes (Linear is an SPA)
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    // Small delay to let Linear render the new page
    setTimeout(createTimerButton, 500);
  }
});
urlObserver.observe(document.body, { childList: true, subtree: true });

// Sync button state when storage changes (e.g. timer started from another tab)
chrome.storage.onChanged.addListener((changes) => {
  if (changes.activeTimer || changes.settings) {
    updateButtonState();
  }
});

// Initial render — wait for Linear to finish rendering
if (parseIssueFromUrl()) {
  setTimeout(createTimerButton, 1000);
}
```

- [ ] **Step 6: Write the CSS styles**

Write `styles.css` with Linear-matching design:

```css
#lc-timer-container {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 12px;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 13px;
}

.lc-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  color: #fff;
}

.lc-btn:hover {
  opacity: 0.9;
}

.lc-btn:active {
  transform: scale(0.97);
}

.lc-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.lc-btn-start {
  background-color: #22c55e;
}

.lc-btn-stop {
  background-color: #ef4444;
}

.lc-btn-switch {
  background-color: #eab308;
  color: #1a1a1a;
}

.lc-elapsed {
  font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  color: #ef4444;
  font-weight: 600;
}

.lc-info {
  font-size: 12px;
  color: #888;
}

.lc-settings-link {
  color: #6366f1;
  text-decoration: none;
  font-size: 12px;
}

.lc-settings-link:hover {
  text-decoration: underline;
}
```

- [ ] **Step 7: Verify — load a Linear issue page**

1. Reload extension at `chrome://extensions/`
2. Navigate to any Linear issue page (e.g. `linear.app/gghq/issue/IT-1/...`)
3. Timer button should appear on the page
4. Button should show "▶ Start" (green) if no timer running
5. If API key is not set, should show "⚙️ Beállítás szükséges"

- [ ] **Step 8: Commit**

```bash
git add content.js styles.css
git commit -m "feat: content script — timer button on Linear issue pages with SPA navigation support"
```

---

## Task 4: Popup — toolbar timer view

**Files:**
- Rewrite: `popup.html`
- Rewrite: `popup.js`

- [ ] **Step 1: Write popup HTML**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Clockify Timer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 300px;
      padding: 16px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      color: #e8e8e8;
      background: #1a1a2e;
    }
    .header {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      margin-bottom: 12px;
    }
    .timer-info { margin-bottom: 12px; }
    .issue-key {
      font-weight: 600;
      color: #a78bfa;
      font-size: 14px;
    }
    .issue-title { margin-top: 4px; color: #ccc; }
    .project-name { margin-top: 4px; font-size: 12px; color: #888; }
    .elapsed {
      font-family: 'SF Mono', 'Consolas', monospace;
      font-size: 24px;
      font-weight: 600;
      color: #ef4444;
      margin: 12px 0;
    }
    .stop-btn {
      width: 100%;
      padding: 8px 16px;
      background: #ef4444;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    .stop-btn:hover { opacity: 0.9; }
    .stop-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .no-timer { color: #888; text-align: center; padding: 20px 0; }
    .external-badge {
      display: inline-block;
      font-size: 10px;
      background: #333;
      color: #888;
      padding: 2px 6px;
      border-radius: 4px;
      margin-left: 6px;
    }
    .error { color: #ef4444; margin-top: 8px; font-size: 12px; display: none; }
    .settings-link {
      display: block;
      text-align: center;
      margin-top: 12px;
      color: #6366f1;
      text-decoration: none;
      font-size: 12px;
    }
    .settings-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="header">Clockify Timer</div>
  <div id="content">Loading...</div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write popup logic**

Uses DOM methods (createElement, textContent) — no innerHTML with dynamic data:

```js
const content = document.getElementById('content');
let elapsedInterval = null;

async function render() {
  const { activeTimer } = await chrome.storage.local.get('activeTimer');
  const { settings } = await chrome.storage.local.get('settings');

  // Clear previous content
  content.textContent = '';
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }

  if (!settings?.apiKey) {
    const msg = document.createElement('div');
    msg.className = 'no-timer';
    msg.textContent = 'API key nincs beállítva';
    content.appendChild(msg);

    const link = document.createElement('a');
    link.href = '#';
    link.className = 'settings-link';
    link.textContent = '⚙️ Beállítások megnyitása';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    content.appendChild(link);
    return;
  }

  if (!activeTimer) {
    const msg = document.createElement('div');
    msg.className = 'no-timer';
    msg.textContent = 'Nincs aktív timer';
    content.appendChild(msg);
    return;
  }

  // Timer info
  const timerInfo = document.createElement('div');
  timerInfo.className = 'timer-info';

  const issueKeyEl = document.createElement('div');
  issueKeyEl.className = 'issue-key';
  issueKeyEl.textContent = activeTimer.issueKey || 'Ismeretlen';
  if (activeTimer.external) {
    const badge = document.createElement('span');
    badge.className = 'external-badge';
    badge.textContent = 'külső';
    issueKeyEl.appendChild(badge);
  }
  timerInfo.appendChild(issueKeyEl);

  const titleEl = document.createElement('div');
  titleEl.className = 'issue-title';
  titleEl.textContent = activeTimer.issueTitle;
  timerInfo.appendChild(titleEl);

  if (activeTimer.projectName) {
    const projectEl = document.createElement('div');
    projectEl.className = 'project-name';
    projectEl.textContent = '📁 ' + activeTimer.projectName;
    timerInfo.appendChild(projectEl);
  }
  content.appendChild(timerInfo);

  // Elapsed time
  const elapsedEl = document.createElement('div');
  elapsedEl.className = 'elapsed';
  elapsedEl.id = 'popup-elapsed';
  elapsedEl.textContent = '00:00:00';
  content.appendChild(elapsedEl);
  startElapsed(activeTimer.startedAt);

  // Stop button (not for external timers)
  if (!activeTimer.external) {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'stop-btn';
    stopBtn.textContent = '⏹ Stop';
    stopBtn.addEventListener('click', async () => {
      stopBtn.disabled = true;
      const result = await chrome.runtime.sendMessage({ action: 'stopTimer' });
      if (result.error) {
        const errEl = document.createElement('div');
        errEl.className = 'error';
        errEl.style.display = 'block';
        errEl.textContent = result.error;
        content.appendChild(errEl);
        stopBtn.disabled = false;
      } else {
        render();
      }
    });
    content.appendChild(stopBtn);
  }
}

function startElapsed(startedAt) {
  if (elapsedInterval) clearInterval(elapsedInterval);
  const el = document.getElementById('popup-elapsed');
  if (!el) return;

  function update() {
    const diff = Date.now() - new Date(startedAt).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent =
      String(h).padStart(2, '0') + ':' +
      String(m).padStart(2, '0') + ':' +
      String(s).padStart(2, '0');
  }

  update();
  elapsedInterval = setInterval(update, 1000);
}

// Listen for storage changes to re-render
chrome.storage.onChanged.addListener(() => render());

// Initial render
render();
```

- [ ] **Step 3: Verify — click extension icon in toolbar**

1. Reload extension
2. Click the extension icon in Chrome toolbar
3. Should show "Nincs aktív timer" or "API key nincs beállítva"
4. If a timer is running, popup should show timer details + stop button

- [ ] **Step 4: Commit**

```bash
git add popup.html popup.js
git commit -m "feat: popup — toolbar timer view with stop button"
```

---

## Task 5: Options page — settings

**Files:**
- Rewrite: `options.html`
- Rewrite: `options.js`

- [ ] **Step 1: Write options HTML**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Linear → Clockify Beállítások</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      max-width: 600px;
      margin: 40px auto;
      padding: 0 20px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      color: #333;
      background: #f9fafb;
    }
    h1 { font-size: 20px; margin-bottom: 24px; color: #111; }
    .section {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .section h2 { font-size: 14px; font-weight: 600; margin-bottom: 12px; color: #111; }
    label { display: block; font-size: 12px; font-weight: 500; color: #555; margin-bottom: 4px; }
    input[type="text"], input[type="password"] {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      font-family: inherit;
      margin-bottom: 12px;
    }
    input[type="text"]:focus, input[type="password"]:focus {
      outline: none;
      border-color: #6366f1;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
    }
    .checkbox-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .checkbox-row input[type="checkbox"] { width: 16px; height: 16px; }
    .checkbox-row label { margin-bottom: 0; font-size: 14px; color: #333; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th {
      text-align: left; padding: 8px;
      border-bottom: 2px solid #e5e7eb;
      font-weight: 600; color: #555; font-size: 12px;
    }
    td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; }
    td input {
      width: 100%;
      padding: 4px 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 13px;
      font-family: inherit;
    }
    .btn-row { display: flex; gap: 8px; margin-top: 16px; }
    .btn {
      padding: 8px 20px; border: none; border-radius: 6px;
      font-size: 14px; font-weight: 500; cursor: pointer;
    }
    .btn-primary { background: #6366f1; color: #fff; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-secondary { background: #e5e7eb; color: #333; }
    .btn-secondary:hover { background: #d1d5db; }
    .btn-danger { background: #fee2e2; color: #dc2626; }
    .btn-danger:hover { background: #fecaca; }
    .status { margin-top: 12px; font-size: 13px; color: #22c55e; display: none; }
    .status.error { color: #ef4444; }
    .hint { font-size: 11px; color: #888; margin-top: -8px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>Linear → Clockify Beállítások</h1>

  <div class="section">
    <h2>Clockify API</h2>
    <label for="apiKey">API Key</label>
    <input type="password" id="apiKey" placeholder="Clockify API key (Settings → API)">
    <label for="workspaceId">Workspace ID</label>
    <input type="text" id="workspaceId" placeholder="5ef305cdb6b6d1294b8a04c0">
    <div class="hint">Alapértelmezett: 5ef305cdb6b6d1294b8a04c0</div>
  </div>

  <div class="section">
    <h2>Általános</h2>
    <div class="checkbox-row">
      <input type="checkbox" id="autoStop">
      <label for="autoStop">Timer automatikus leállítása ha bezárom a Linear tabot</label>
    </div>
  </div>

  <div class="section">
    <h2>Linear Team → Clockify Projekt Mapping</h2>
    <table>
      <thead>
        <tr><th>Linear Team Key</th><th>Clockify Projekt Név</th></tr>
      </thead>
      <tbody id="mappingTable"></tbody>
    </table>
    <button class="btn btn-secondary" id="addRow" style="margin-top: 8px;">+ Sor hozzáadása</button>
  </div>

  <div class="btn-row">
    <button class="btn btn-primary" id="save">Mentés</button>
    <button class="btn btn-secondary" id="reset">Alapértelmezés visszaállítása</button>
  </div>
  <div class="status" id="status"></div>

  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write options logic**

Uses DOM methods — no innerHTML with dynamic data:

```js
const DEFAULT_SETTINGS = {
  apiKey: '',
  workspaceId: '5ef305cdb6b6d1294b8a04c0',
  autoStop: false,
  teamMapping: {
    GG: 'Cég működése',
    MAN: 'Management',
    SAL: 'Sales',
    IT: 'IT',
    FIN: 'Pénzügy',
    HR: 'HR',
    KOM: 'Kommunikáció és Vendégek',
    LBE: 'Lakásbekerülés',
    TUL: 'Lakások és Tulajok',
    LM: 'LM Support',
  },
};

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || { ...DEFAULT_SETTINGS };
}

async function render() {
  const settings = await loadSettings();

  document.getElementById('apiKey').value = settings.apiKey || '';
  document.getElementById('workspaceId').value = settings.workspaceId || DEFAULT_SETTINGS.workspaceId;
  document.getElementById('autoStop').checked = settings.autoStop || false;

  renderMappingTable(settings.teamMapping || DEFAULT_SETTINGS.teamMapping);
}

function renderMappingTable(mapping) {
  const tbody = document.getElementById('mappingTable');
  tbody.textContent = '';

  for (const [teamKey, projectName] of Object.entries(mapping)) {
    addMappingRow(teamKey, projectName);
  }
}

function addMappingRow(teamKey, projectName) {
  const tbody = document.getElementById('mappingTable');
  const tr = document.createElement('tr');

  const tdTeam = document.createElement('td');
  const inputTeam = document.createElement('input');
  inputTeam.type = 'text';
  inputTeam.className = 'map-team';
  inputTeam.value = teamKey || '';
  inputTeam.placeholder = 'IT';
  tdTeam.appendChild(inputTeam);

  const tdProject = document.createElement('td');
  tdProject.style.display = 'flex';
  tdProject.style.gap = '4px';
  tdProject.style.alignItems = 'center';

  const inputProject = document.createElement('input');
  inputProject.type = 'text';
  inputProject.className = 'map-project';
  inputProject.value = projectName || '';
  inputProject.placeholder = 'IT';
  inputProject.style.flex = '1';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-danger';
  removeBtn.style.padding = '4px 8px';
  removeBtn.style.fontSize = '12px';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => tr.remove());

  tdProject.appendChild(inputProject);
  tdProject.appendChild(removeBtn);

  tr.appendChild(tdTeam);
  tr.appendChild(tdProject);
  tbody.appendChild(tr);
}

function collectMapping() {
  const mapping = {};
  const rows = document.querySelectorAll('#mappingTable tr');
  for (const row of rows) {
    const team = row.querySelector('.map-team').value.trim();
    const project = row.querySelector('.map-project').value.trim();
    if (team && project) {
      mapping[team] = project;
    }
  }
  return mapping;
}

function showStatus(message, isError) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = isError ? 'status error' : 'status';
  status.style.display = 'block';
  setTimeout(() => { status.style.display = 'none'; }, 3000);
}

// Save
document.getElementById('save').addEventListener('click', async () => {
  const settings = {
    apiKey: document.getElementById('apiKey').value.trim(),
    workspaceId: document.getElementById('workspaceId').value.trim() || DEFAULT_SETTINGS.workspaceId,
    autoStop: document.getElementById('autoStop').checked,
    teamMapping: collectMapping(),
  };

  await chrome.storage.local.set({ settings });
  // Clear caches when settings change
  await chrome.storage.local.remove(['projectCache', 'userId']);
  showStatus('✅ Beállítások mentve');
});

// Reset
document.getElementById('reset').addEventListener('click', async () => {
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
  await chrome.storage.local.remove(['projectCache', 'userId']);
  render();
  showStatus('Alapértelmezés visszaállítva');
});

// Add row
document.getElementById('addRow').addEventListener('click', () => addMappingRow('', ''));

// Initial render
render();
```

- [ ] **Step 3: Verify — open options page**

1. Reload extension
2. Right-click extension icon → "Options"
3. Should show settings form with API key, workspace ID, mapping table
4. Enter a Clockify API key, click Save
5. Should show "✅ Beállítások mentve"
6. Reload options page — settings should persist

- [ ] **Step 4: Commit**

```bash
git add options.html options.js
git commit -m "feat: options page — API key, workspace ID, team mapping settings"
```

---

## Task 6: Auto-stop on tab close + end-to-end verification

**Files:**
- Modify: `background.js` (add tab close listener)

- [ ] **Step 1: Add `tabs` permission to `manifest.json`**

The `tabs.onRemoved` listener requires the `tabs` permission. Add it to the permissions array in `manifest.json`:

```json
"permissions": ["storage", "alarms", "tabs"],
```

- [ ] **Step 2: Add auto-stop on tab close to `background.js`**

Add at the end of `background.js`:

```js
// Auto-stop timer when Linear tab is closed (if enabled in settings)
chrome.tabs.onRemoved.addListener(async () => {
  const settings = await getSettings();
  if (!settings.autoStop) return;

  const { activeTimer } = await chrome.storage.local.get('activeTimer');
  if (!activeTimer || activeTimer.external) return;

  // Check if any remaining Linear tabs are open
  const tabs = await chrome.tabs.query({ url: 'https://linear.app/gghq/*' });
  if (tabs.length === 0) {
    await stopTimer();
  }
});
```

- [ ] **Step 3: End-to-end manual verification**

Test the full flow:

1. **Setup:** Open options → enter Clockify API key → Save
2. **Start timer:** Go to a Linear issue page → click "▶ Start" → button should turn red with elapsed time
3. **Badge:** Check Chrome toolbar — extension icon should show elapsed time badge
4. **Popup:** Click extension icon → should show timer details + Stop button
5. **Navigate to another issue:** Button should turn yellow "⏹ Stop & ▶ Start" → click → old timer stops, new starts
6. **Stop timer:** Click "⏹ Stop" → button returns to green, badge clears
7. **Multiple tabs:** Open same issue in 2 tabs → both buttons should be in sync
8. **Verify in Clockify:** Check Clockify web → time entries should appear with correct `[TEAM-123] Title` format and correct project

- [ ] **Step 4: Commit**

```bash
git add manifest.json background.js
git commit -m "feat: auto-stop timer on Linear tab close"
```

---

## Task 7: Icons + final polish

**Files:**
- Create/replace: `icons/icon-16.png`, `icons/icon-32.png`, `icons/icon-48.png`, `icons/icon-128.png`

- [ ] **Step 1: Generate proper extension icons**

Create simple, clear icons using an SVG-to-PNG pipeline. The icon should convey "timer" or "clock". Use the Clockify blue (#03A9F4) as the primary color.

SVG source:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <circle cx="64" cy="64" r="56" fill="#03A9F4" />
  <circle cx="64" cy="64" r="48" fill="#fff" />
  <line x1="64" y1="64" x2="64" y2="28" stroke="#333" stroke-width="6" stroke-linecap="round" />
  <line x1="64" y1="64" x2="88" y2="64" stroke="#333" stroke-width="4" stroke-linecap="round" />
  <circle cx="64" cy="64" r="4" fill="#333" />
</svg>
```

Convert to PNG at 16x16, 32x32, 48x48, 128x128 using:
```bash
# Using rsvg-convert (brew install librsvg) or ImageMagick
for size in 16 32 48 128; do
  rsvg-convert -w $size -h $size icon.svg -o icons/icon-${size}.png
done
```

Or use any PNG icon editor / online converter.

- [ ] **Step 2: Verify icons load correctly**

1. Reload extension
2. Check icon in toolbar, `chrome://extensions/` page
3. Icons should be crisp at all sizes

- [ ] **Step 3: Final commit**

```bash
git add icons/
git commit -m "feat: extension icons"
```

---

## Summary

| Task | What | Key files |
|---|---|---|
| 1 | Project scaffold | `manifest.json`, stubs, `.gitignore` |
| 2 | Background service worker | `background.js` |
| 3 | Content script + styles | `content.js`, `styles.css` |
| 4 | Popup | `popup.html`, `popup.js` |
| 5 | Options page | `options.html`, `options.js` |
| 6 | Auto-stop + integration test | `manifest.json`, `background.js` |
| 7 | Icons + polish | `icons/` |
