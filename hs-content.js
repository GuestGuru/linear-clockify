// HelpScout → Clockify Timer — Content Script

const {
  parseTimeInput, formatHM, todayStr, localTimeToISO, dayBoundsISO,
  setStatus, clearStatus, createSettingsLink,
  buildManualEntryForm, attachManualEntrySubmit,
  buildSnapChip, buildStartEditor,
  parseHsUrl, parseHsTitle,
} = window.LCShared;

const HS_BUTTON_CONTAINER_ID = 'lc-hs-timer-container';
let hsMainSnapChip = null;
let hsMainStartEditor = null;
let hsElapsedInterval = null;

function getConversationContext() {
  const url = parseHsUrl(window.location.pathname);
  if (!url) return null;
  const titleParsed = parseHsTitle(document.title);
  return {
    convId: url.convId,
    ticketNumber: url.ticketNumber,
    subject: titleParsed?.subject || '',
    customer: titleParsed?.customer || '',
  };
}

function findHsHeaderInsertion() {
  // Strategy: find the element holding the conversation subject heading, then
  // insert our UI as a sibling so it appears near the #ticketNumber line.
  const selectors = [
    '[data-cy="conversation-subject"]',
    '[data-cy="dashboardTitle"]',
    'h1',
    'h2',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) {
      return el.parentElement || el;
    }
  }
  return document.body;
}

function createHsTimerButton() {
  const existing = document.getElementById(HS_BUTTON_CONTAINER_ID);
  if (existing) existing.remove();

  const ctx = getConversationContext();
  if (!ctx) return;

  const container = document.createElement('div');
  container.id = HS_BUTTON_CONTAINER_ID;

  const button = document.createElement('button');
  button.id = 'lc-hs-timer-button';
  button.className = 'lc-btn lc-btn-start';
  button.textContent = '▶ Start';

  const elapsed = document.createElement('span');
  elapsed.id = 'lc-hs-elapsed';
  elapsed.className = 'lc-elapsed';
  elapsed.style.display = 'none';

  const info = document.createElement('span');
  info.id = 'lc-hs-info';
  info.className = 'lc-info';
  info.style.display = 'none';

  hsMainSnapChip = buildSnapChip();
  hsMainSnapChip.chip.id = 'lc-hs-snap-chip';

  hsMainStartEditor = buildStartEditor();
  hsMainStartEditor.container.id = 'lc-hs-start-editor';

  container.appendChild(button);
  container.appendChild(elapsed);
  container.appendChild(info);
  container.appendChild(hsMainSnapChip.chip);
  container.appendChild(hsMainStartEditor.container);

  elapsed.addEventListener('click', async () => {
    if (!hsMainStartEditor) return;
    if (hsMainStartEditor.container.style.display !== 'none') {
      hsMainStartEditor.hide();
      return;
    }
    const { activeTimer } = await chrome.storage.local.get('activeTimer');
    if (activeTimer?.startedAt && !activeTimer.external) {
      hsMainStartEditor.show(activeTimer.startedAt);
    }
  });

  const anchor = findHsHeaderInsertion();
  anchor.appendChild(container);

  button.addEventListener('click', handleHsButtonClick);
  updateHsButtonState();
  hsMainSnapChip.refresh();
}

async function handleHsButtonClick(event) {
  const ctx = getConversationContext();
  if (!ctx) return;

  const button = event?.currentTarget || document.getElementById('lc-hs-timer-button');
  button.disabled = true;

  try {
    const { activeTimer } = await chrome.storage.local.get('activeTimer');

    if (activeTimer && activeTimer.source === 'hs' &&
        activeTimer.ticketNumber === ctx.ticketNumber && !activeTimer.external) {
      const result = await chrome.runtime.sendMessage({ action: 'stopTimer' });
      if (result.error) showHsError(result.error);
    } else if (activeTimer && !activeTimer.external) {
      const result = await chrome.runtime.sendMessage({
        action: 'stopAndStartHsTimer',
        data: ctx,
      });
      if (result.error) showHsError(result.error);
      if (result.warning) showHsWarning(result.warning);
    } else {
      const result = await chrome.runtime.sendMessage({
        action: 'startHsTimer',
        data: ctx,
      });
      if (result.error) showHsError(result.error);
      if (result.warning) showHsWarning(result.warning);
    }
  } catch (err) {
    showHsError(err.message);
  } finally {
    button.disabled = false;
  }
}

function showHsError(message) {
  const info = document.getElementById('lc-hs-info');
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

function showHsWarning(message) {
  const info = document.getElementById('lc-hs-info');
  if (!info) return;
  info.style.display = 'inline';
  info.textContent = `⚠️ ${message}`;
  setTimeout(() => { info.style.display = 'none'; }, 5000);
}

function applyHsButtonState(button, elapsed, info, state, activeTimer) {
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

async function updateHsButtonState() {
  // Defensive clear (same race guard as content.js)
  if (hsElapsedInterval) {
    clearInterval(hsElapsedInterval);
    hsElapsedInterval = null;
  }

  const ctx = getConversationContext();
  if (!ctx) return;

  const button = document.getElementById('lc-hs-timer-button');
  const elapsed = document.getElementById('lc-hs-elapsed');
  const info = document.getElementById('lc-hs-info');
  if (!button) return;

  const { settings } = await chrome.storage.local.get('settings');
  if (!settings?.apiKey) {
    applyHsButtonState(button, elapsed, info, 'hidden');
    return;
  }

  const { activeTimer } = await chrome.storage.local.get('activeTimer');

  let state;
  if (!activeTimer || activeTimer.external) {
    state = 'start';
  } else if (activeTimer.source === 'hs' && activeTimer.ticketNumber === ctx.ticketNumber) {
    state = 'stop';
  } else {
    state = 'switch';
  }
  applyHsButtonState(button, elapsed, info, state, activeTimer);

  if (state === 'stop') startHsElapsedCounter(activeTimer.startedAt);
  if (state !== 'stop' && hsMainStartEditor) hsMainStartEditor.hide();

  if (hsMainSnapChip) hsMainSnapChip.refresh();
}

function startHsElapsedCounter(startedAt) {
  // Defensive: clear any existing interval before starting a new one.
  if (hsElapsedInterval) {
    clearInterval(hsElapsedInterval);
    hsElapsedInterval = null;
  }

  const el = document.getElementById('lc-hs-elapsed');
  if (!el) return;

  function update() {
    const diff = Date.now() - new Date(startedAt).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  update();
  hsElapsedInterval = setInterval(update, 1000);
}

console.log('[LC HS] loaded', getConversationContext());
