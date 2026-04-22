// Linear → Clockify Timer — Content Script

const {
  parseTimeInput,
  formatHM,
  todayStr,
  localTimeToISO,
  dayBoundsISO,
  setStatus,
  clearStatus,
  createSettingsLink,
  buildManualEntryForm,
  attachManualEntrySubmit,
  buildSnapChip,
  buildStartEditor,
} = window.LCShared;

let mainSnapChip = null;
let cardSnapChip = null;
let mainStartEditor = null;
let cardStartEditor = null;

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
const RIGHT_PANEL_CARD_ID = 'lc-right-panel-card';

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

  const mobileEditBtn = document.createElement('button');
  mobileEditBtn.type = 'button';
  mobileEditBtn.id = 'lc-mobile-edit-btn';
  mobileEditBtn.className = 'lc-mobile-edit-btn';
  mobileEditBtn.textContent = '✎';
  mobileEditBtn.title = 'Manuális rögzítés';

  const mobileFormWrap = document.createElement('div');
  mobileFormWrap.id = 'lc-mobile-form-wrap';
  mobileFormWrap.className = 'lc-mobile-form-wrap';
  mobileFormWrap.style.display = 'none';

  const manualSubtitle = document.createElement('div');
  manualSubtitle.className = 'lc-card-subtitle';
  manualSubtitle.textContent = 'Manuális rögzítés';

  const { form: mobileForm, fields: mobileFields } = buildManualEntryForm();
  attachManualEntrySubmit(mobileForm, mobileFields, async ({ startISO, endISO, dayStart, dayEnd }) => {
    const issue = parseIssueFromUrl();
    const issueTitle = await getIssueTitle();
    return {
      action: 'createManualEntry',
      data: {
        issueKey: issue.issueKey,
        issueTitle,
        teamKey: issue.teamKey,
        start: startISO,
        end: endISO,
        dayStart,
        dayEnd,
      },
    };
  });

  mobileFormWrap.appendChild(manualSubtitle);
  mobileFormWrap.appendChild(mobileForm);

  mobileEditBtn.addEventListener('click', () => {
    const hidden = mobileFormWrap.style.display === 'none';
    mobileFormWrap.style.display = hidden ? 'block' : 'none';
    container.classList.toggle('lc-mobile-expanded', hidden);
  });

  container.appendChild(button);

  mainSnapChip = buildSnapChip();
  mainSnapChip.chip.id = 'lc-snap-chip';
  container.appendChild(mainSnapChip.chip);

  elapsed.addEventListener('click', async () => {
    if (!mainStartEditor) return;
    if (mainStartEditor.container.style.display !== 'none') {
      mainStartEditor.hide();
      return;
    }
    const { activeTimer } = await chrome.storage.local.get('activeTimer');
    if (activeTimer?.startedAt && !activeTimer.external) {
      mainStartEditor.show(activeTimer.startedAt);
    }
  });

  container.appendChild(elapsed);
  container.appendChild(info);
  container.appendChild(mobileEditBtn);
  container.appendChild(mobileFormWrap);

  mainStartEditor = buildStartEditor();
  mainStartEditor.container.id = 'lc-start-editor';
  container.appendChild(mainStartEditor.container);

  const insertionPoint = findInsertionPoint();
  if (insertionPoint) {
    insertionPoint.appendChild(container);
  }

  button.addEventListener('click', handleButtonClick);
  updateButtonState();
  mainSnapChip.refresh();
}

// ─── Right Panel Card ─────────────────────────────────────────────────────────

function findRightPanelInsertion() {
  // Prefer "Project" / "Projects" section header; fall back to "Labels", "Properties"
  const preferredHeaders = ['Project', 'Projects', 'Labels', 'Properties'];

  const headerButtons = document.querySelectorAll('button[aria-expanded]');
  const byLabel = new Map();
  for (const btn of headerButtons) {
    const label = btn.textContent?.trim();
    if (!label) continue;
    if (!byLabel.has(label)) byLabel.set(label, btn);
  }

  let anchorButton = null;
  for (const label of preferredHeaders) {
    if (byLabel.has(label)) {
      anchorButton = byLabel.get(label);
      break;
    }
  }
  if (!anchorButton) return null;

  // Walk up until we find a parent that contains 2+ siblings each hosting an
  // aria-expanded header button (the sidebar property-section container).
  let section = anchorButton;
  while (section?.parentElement) {
    const parent = section.parentElement;
    const sectionSiblings = Array.from(parent.children).filter((child) =>
      child.querySelector(':scope > * button[aria-expanded], :scope button[aria-expanded]')
    );
    if (sectionSiblings.length >= 2 && sectionSiblings.includes(section)) {
      return { parent, afterNode: section };
    }
    section = parent;
    if (section === document.body) break;
  }
  return null;
}

function createRightPanelCard() {
  const existing = document.getElementById(RIGHT_PANEL_CARD_ID);
  if (existing) existing.remove();

  const issue = parseIssueFromUrl();
  if (!issue) return;

  const insertion = findRightPanelInsertion();
  if (!insertion) return;

  const card = document.createElement('div');
  card.id = RIGHT_PANEL_CARD_ID;
  card.className = 'lc-card';

  const title = document.createElement('div');
  title.className = 'lc-card-title';
  title.textContent = 'Clockify timer';

  const timerRow = document.createElement('div');
  timerRow.className = 'lc-card-timer-row';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'lc-card-timer-button';
  button.className = 'lc-btn lc-btn-start';
  button.textContent = '▶ Start';

  const elapsed = document.createElement('span');
  elapsed.id = 'lc-card-elapsed';
  elapsed.className = 'lc-elapsed';
  elapsed.style.display = 'none';

  const info = document.createElement('span');
  info.id = 'lc-card-info';
  info.className = 'lc-info';
  info.style.display = 'none';

  timerRow.appendChild(button);

  cardSnapChip = buildSnapChip();
  cardSnapChip.chip.id = 'lc-card-snap-chip';
  timerRow.appendChild(cardSnapChip.chip);

  elapsed.addEventListener('click', async () => {
    if (!cardStartEditor) return;
    if (cardStartEditor.container.style.display !== 'none') {
      cardStartEditor.hide();
      return;
    }
    const { activeTimer } = await chrome.storage.local.get('activeTimer');
    if (activeTimer?.startedAt && !activeTimer.external) {
      cardStartEditor.show(activeTimer.startedAt);
    }
  });

  timerRow.appendChild(elapsed);
  timerRow.appendChild(info);

  cardStartEditor = buildStartEditor();
  cardStartEditor.container.id = 'lc-card-start-editor';

  const divider = document.createElement('div');
  divider.className = 'lc-card-divider';

  const manualTitle = document.createElement('div');
  manualTitle.className = 'lc-card-subtitle';
  manualTitle.textContent = 'Manuális rögzítés';

  const { form, fields } = buildManualEntryForm();
  attachManualEntrySubmit(form, fields, async ({ startISO, endISO, dayStart, dayEnd }) => {
    const issue = parseIssueFromUrl();
    const issueTitle = await getIssueTitle();
    return {
      action: 'createManualEntry',
      data: {
        issueKey: issue.issueKey,
        issueTitle,
        teamKey: issue.teamKey,
        start: startISO,
        end: endISO,
        dayStart,
        dayEnd,
      },
    };
  });

  card.appendChild(title);
  card.appendChild(timerRow);
  card.appendChild(cardStartEditor.container);
  card.appendChild(divider);
  card.appendChild(manualTitle);
  card.appendChild(form);

  const { parent, afterNode } = insertion;
  parent.insertBefore(card, afterNode.nextSibling);

  button.addEventListener('click', handleButtonClick);
  cardSnapChip.refresh();
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

async function handleButtonClick(event) {
  const issue = parseIssueFromUrl();
  if (!issue) return;

  const button = event?.currentTarget || document.getElementById('lc-timer-button');
  button.disabled = true;

  try {
    const { activeTimer } = await chrome.storage.local.get('activeTimer');
    console.log('[LC] click', { buttonId: button.id, issueKey: issue.issueKey, activeTimer });

    if (activeTimer && activeTimer.issueKey === issue.issueKey && !activeTimer.external) {
      const result = await chrome.runtime.sendMessage({ action: 'stopTimer' });
      console.log('[LC] stopTimer ←', result);
      if (result.error) showError(result.error);
    } else if (activeTimer && !activeTimer.external) {
      const issueTitle = await getIssueTitle();
      const result = await chrome.runtime.sendMessage({
        action: 'stopAndStartTimer',
        data: { issueKey: issue.issueKey, issueTitle, teamKey: issue.teamKey },
      });
      console.log('[LC] stopAndStartTimer ←', result);
      if (result.error) showError(result.error);
      if (result.warning) showWarning(result.warning);
    } else {
      const issueTitle = await getIssueTitle();
      const result = await chrome.runtime.sendMessage({
        action: 'startTimer',
        data: { issueKey: issue.issueKey, issueTitle, teamKey: issue.teamKey },
      });
      console.log('[LC] startTimer ←', result);
      if (result.error) showError(result.error);
      if (result.warning) showWarning(result.warning);
    }
  } catch (err) {
    console.error('[LC] click error', err);
    showError(err.message);
  } finally {
    button.disabled = false;
  }
}

// ─── Error / Warning Display ──────────────────────────────────────────────────

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
  info.textContent = `❌ ${message}`;
  setTimeout(() => { info.style.display = 'none'; }, 5000);
}

function showWarning(message) {
  const info = document.getElementById('lc-info');
  if (!info) return;
  info.style.display = 'inline';
  info.textContent = `⚠️ ${message}`;
  setTimeout(() => { info.style.display = 'none'; }, 5000);
}

// ─── Button State & Elapsed Timer ────────────────────────────────────────────

let elapsedInterval = null;
let lastStateLogKey = null;

function applyButtonState(button, elapsed, info, state, activeTimer) {
  if (!button) return;
  if (state === 'hidden') {
    button.style.display = 'none';
    if (info) {
      info.style.display = 'inline';
      info.textContent = '';
      info.appendChild(createSettingsLink());
    }
    return;
  }
  button.style.display = '';
  if (state === 'start') {
    button.className = 'lc-btn lc-btn-start';
    button.textContent = '▶ Start';
    if (elapsed) elapsed.style.display = 'none';
    if (info) info.style.display = 'none';
  } else if (state === 'stop') {
    button.className = 'lc-btn lc-btn-stop';
    button.textContent = '⏹ Stop';
    if (elapsed) elapsed.style.display = 'inline';
    if (info) info.style.display = 'none';
  } else if (state === 'switch') {
    button.className = 'lc-btn lc-btn-switch';
    button.textContent = '⏹ Stop & ▶ Start';
    if (elapsed) elapsed.style.display = 'none';
    if (info) {
      info.style.display = 'inline';
      info.textContent = `Timer fut: ${activeTimer.issueTitle}`;
    }
  }
}

async function updateButtonState() {
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }

  const issue = parseIssueFromUrl();
  if (!issue) return;

  const buttons = [
    {
      button: document.getElementById('lc-timer-button'),
      elapsed: document.getElementById('lc-elapsed'),
      info: document.getElementById('lc-info'),
    },
    {
      button: document.getElementById('lc-card-timer-button'),
      elapsed: document.getElementById('lc-card-elapsed'),
      info: document.getElementById('lc-card-info'),
    },
  ].filter((b) => b.button);

  if (buttons.length === 0) return;

  const { settings } = await chrome.storage.local.get('settings');

  if (!settings?.apiKey || !settings?.linearApiKey) {
    buttons.forEach(({ button, elapsed, info }) => {
      applyButtonState(button, elapsed, info, 'hidden');
    });
    return;
  }

  const { activeTimer } = await chrome.storage.local.get('activeTimer');

  let state;
  if (!activeTimer || activeTimer.external) {
    state = 'start';
  } else if (activeTimer.issueKey === issue.issueKey) {
    state = 'stop';
  } else {
    state = 'switch';
  }

  buttons.forEach(({ button, elapsed, info }) => {
    applyButtonState(button, elapsed, info, state, activeTimer);
  });

  // Hide snap chip whenever a timer is already running (stop or switch).
  // In `stop` it re-appears inside the elapsed-click start-editor.
  // In `switch` there's nothing to snap to — the new timer starts the
  // instant the current one is stopped, so no gap exists.
  const hideSnap = state !== 'start';
  if (mainSnapChip) mainSnapChip.setForcedHidden(hideSnap);
  if (cardSnapChip) cardSnapChip.setForcedHidden(hideSnap);

  const stateKey = activeTimer
    ? `${state}|${activeTimer.issueKey || ''}|${!!activeTimer.external}`
    : state;
  if (stateKey !== lastStateLogKey) {
    lastStateLogKey = stateKey;
    console.log('[LC] state →', state, activeTimer ? { issueKey: activeTimer.issueKey, external: !!activeTimer.external } : null);
  }

  if (state === 'stop') {
    startElapsedCounter(activeTimer.startedAt);
  }

  // Snap chip refresh moved to storage listener + watchdog — see bottom.
  // Previously refreshed on every updateButtonState call, which fires
  // frequently from the SPA MutationObserver and produced unnecessary
  // Clockify API load.

  if (state !== 'stop') {
    if (mainStartEditor) mainStartEditor.hide();
    if (cardStartEditor) cardStartEditor.hide();
  }
}

function refreshSnapChips() {
  if (mainSnapChip) mainSnapChip.refresh();
  if (cardSnapChip) cardSnapChip.refresh();
}

function startElapsedCounter(startedAt) {
  // Defensive: if a concurrent updateButtonState invocation already set an
  // interval, clear it first so we don't end up with two intervals writing
  // conflicting times into the same .lc-elapsed elements.
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }

  const elements = document.querySelectorAll('.lc-elapsed');
  if (elements.length === 0) return;

  function update() {
    const diff = Date.now() - new Date(startedAt).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const text = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    elements.forEach((el) => { el.textContent = text; });
  }

  update();
  elapsedInterval = setInterval(update, 1000);
}

// ─── SPA Navigation Observer & Storage Sync ──────────────────────────────────

function tryInsertUI() {
  createTimerButton();
  createRightPanelCard();
  updateButtonState();

  const container = document.getElementById(BUTTON_CONTAINER_ID);
  const card = document.getElementById(RIGHT_PANEL_CARD_ID);
  const inlineBad = container && container.parentElement === document.body;
  return container && !inlineBad && card;
}

// Watch DOM until our UI elements land in the right place.
// Linear is an SPA — on a fresh tab the issue DOM may take seconds to render.
let initObserver = null;

function waitForDomAndInit() {
  if (initObserver) {
    initObserver.disconnect();
    initObserver = null;
  }

  // Try immediately — may already be ready (e.g. reload)
  if (tryInsertUI()) return;

  let debounceTimer = null;
  initObserver = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (tryInsertUI()) {
        initObserver.disconnect();
        initObserver = null;
      }
    }, 200);
  });
  initObserver.observe(document.body, { childList: true, subtree: true });

  // Safety: stop watching after 30s
  setTimeout(() => {
    if (initObserver) {
      initObserver.disconnect();
      initObserver = null;
    }
  }, 30000);
}

let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    if (parseIssueFromUrl()) {
      waitForDomAndInit();
    }
  }
});
urlObserver.observe(document.body, { childList: true, subtree: true });

chrome.storage.onChanged.addListener((changes) => {
  if (changes.activeTimer || changes.settings) {
    console.log('[LC] storage change', Object.keys(changes));
    updateButtonState();
    refreshSnapChips();
  }
});

// Popup → content script: return the current Linear page context so the
// popup can offer Start / Start&snap / manual entry without duplicating
// the URL + title parsing logic.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'getPageContext') return false;
  (async () => {
    const issue = parseIssueFromUrl();
    if (!issue) {
      sendResponse({ source: null });
      return;
    }
    const issueTitle = await getIssueTitle();
    sendResponse({
      source: 'linear',
      issueKey: issue.issueKey,
      teamKey: issue.teamKey,
      issueTitle,
    });
  })();
  return true;
});

if (parseIssueFromUrl()) {
  console.log('[LC] init', parseIssueFromUrl());
  waitForDomAndInit();
  // Watchdog: keep the chip honest as the 30-min snap window rolls forward.
  setInterval(refreshSnapChips, 60000);
}
