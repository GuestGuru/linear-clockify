// Linear → Clockify Timer — Content Script

// ─── URL & Issue Parsing ──────────────────────────────────────────────────────

function parseIssueFromUrl() {
  const match = window.location.pathname.match(/\/gghq\/issue\/([A-Z]+)-(\d+)/);
  if (!match) return null;
  return { teamKey: match[1], issueNumber: match[2], issueKey: `${match[1]}-${match[2]}` };
}

function getFallbackTitle() {
  const issue = parseIssueFromUrl();
  let title = document.title.replace(/\s*[—–-]\s*Linear\s*$/, '').trim();
  if (issue) {
    title = title.replace(new RegExp(`^${issue.issueKey}\\s+`), '');
  }
  return title || 'Untitled';
}

async function getIssueTitle() {
  const issue = parseIssueFromUrl();
  if (!issue) return 'Untitled';

  // Try Linear API via background
  const result = await chrome.runtime.sendMessage({
    action: 'getIssueDetails',
    data: { teamKey: issue.teamKey, issueNumber: issue.issueNumber },
  });

  if (result?.details?.title) return result.details.title;

  // Fallback to document.title if API unavailable
  return getFallbackTitle();
}

// ─── Timer Button Rendering ───────────────────────────────────────────────────

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

  const insertionPoint = findInsertionPoint();
  if (insertionPoint) {
    insertionPoint.appendChild(container);
  }

  button.addEventListener('click', handleButtonClick);
  updateButtonState();
}

function findInsertionPoint() {
  const issue = parseIssueFromUrl();
  if (!issue) return document.body;

  // Strategy 1: Find the inner span with just the issue key (e.g. "IT-2")
  // Linear wraps the key in a child span inside the breadcrumb link
  const links = document.querySelectorAll(`a[href*="/issue/${issue.issueKey}/"]`);
  for (const link of links) {
    const headerRow = link.closest('[data-contextual-menu]')?.parentElement;
    if (headerRow) return headerRow;
  }

  // Strategy 2: Find any link matching the issue and go up
  for (const link of links) {
    const row = link.closest('div')?.parentElement;
    if (row) return row;
  }

  return document.body;
}

// ─── Button Click Handler ─────────────────────────────────────────────────────

async function handleButtonClick() {
  const issue = parseIssueFromUrl();
  if (!issue) return;

  const button = document.getElementById('lc-timer-button');
  button.disabled = true;

  try {
    const { activeTimer } = await chrome.storage.local.get('activeTimer');

    if (activeTimer && activeTimer.issueKey === issue.issueKey && !activeTimer.external) {
      const result = await chrome.runtime.sendMessage({ action: 'stopTimer' });
      if (result.error) showError(result.error);
    } else if (activeTimer && !activeTimer.external) {
      const issueTitle = await getIssueTitle();
      const result = await chrome.runtime.sendMessage({
        action: 'stopAndStartTimer',
        data: { issueKey: issue.issueKey, issueTitle, teamKey: issue.teamKey },
      });
      if (result.error) showError(result.error);
      if (result.warning) showWarning(result.warning);
    } else {
      const issueTitle = await getIssueTitle();
      const result = await chrome.runtime.sendMessage({
        action: 'startTimer',
        data: { issueKey: issue.issueKey, issueTitle, teamKey: issue.teamKey },
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

// ─── Error / Warning Display ──────────────────────────────────────────────────

function createSettingsLink() {
  const link = document.createElement('a');
  link.href = '#';
  link.className = 'lc-settings-link';
  link.textContent = '⚙️ Beállítás szükséges';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'openOptions' });
  });
  return link;
}

function showError(message) {
  const info = document.getElementById('lc-info');
  if (!info) return;

  if (message === 'NO_API_KEY') {
    info.style.display = 'inline';
    info.textContent = '';
    info.appendChild(createSettingsLink());
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

// ─── Button State & Elapsed Timer ────────────────────────────────────────────

let elapsedInterval = null;

async function updateButtonState() {
  // Always clear interval first, even if we bail early
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }

  const issue = parseIssueFromUrl();
  if (!issue) return;

  const button = document.getElementById('lc-timer-button');
  const elapsed = document.getElementById('lc-elapsed');
  const info = document.getElementById('lc-info');
  if (!button) return;

  const { settings } = await chrome.storage.local.get('settings');

  if (!settings?.apiKey) {
    button.style.display = 'none';
    if (info) {
      info.style.display = 'inline';
      info.textContent = '';
      info.appendChild(createSettingsLink());
    }
    return;
  }

  button.style.display = '';

  const { activeTimer } = await chrome.storage.local.get('activeTimer');

  if (!activeTimer || activeTimer.external) {
    button.className = 'lc-btn lc-btn-start';
    button.textContent = '▶ Start';
    elapsed.style.display = 'none';
    info.style.display = 'none';
  } else if (activeTimer.issueKey === issue.issueKey) {
    button.className = 'lc-btn lc-btn-stop';
    button.textContent = '⏹ Stop';
    elapsed.style.display = 'inline';
    startElapsedCounter(activeTimer.startedAt);
    info.style.display = 'none';
  } else {
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

// ─── SPA Navigation Observer & Storage Sync ──────────────────────────────────

function createTimerButtonWithRetry(attempts = 3, delay = 300) {
  createTimerButton();
  // If button ended up on document.body (fallback), retry to find a better spot
  const container = document.getElementById(BUTTON_CONTAINER_ID);
  if (container && container.parentElement === document.body && attempts > 1) {
    setTimeout(() => createTimerButtonWithRetry(attempts - 1, delay), delay);
  }
}

let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    setTimeout(() => createTimerButtonWithRetry(), 500);
  }
});
urlObserver.observe(document.body, { childList: true, subtree: true });

chrome.storage.onChanged.addListener((changes) => {
  if (changes.activeTimer || changes.settings) {
    updateButtonState();
  }
});

if (parseIssueFromUrl()) {
  setTimeout(() => createTimerButtonWithRetry(), 1000);
}
