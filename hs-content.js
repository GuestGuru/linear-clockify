// HelpScout → Clockify Timer — Content Script

const {
  parseTimeInput, formatHM, todayStr, localTimeToISO, dayBoundsISO,
  setStatus, clearStatus, createSettingsLink,
  buildManualEntryForm, attachManualEntrySubmit,
  buildSnapChip, buildStartEditor,
  parseHsUrl, parseHsTitle,
} = window.LCShared;

const HS_BUTTON_CONTAINER_ID = 'lc-hs-timer-container';
const HS_CARD_ID = 'lc-hs-right-card';
let hsMainSnapChip = null;
let hsMainStartEditor = null;
let hsElapsedInterval = null;
let hsCardSnapChip = null;
let hsCardStartEditor = null;

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
  // The conversation header bar (top of the conversation view) wraps the
  // subject and action buttons. We append our container as its child.
  const header = document.querySelector('[data-testid="conversation-header"]');
  if (header && header.offsetParent !== null) return header;
  return null;
}

function createHsTimerButton() {
  const existing = document.getElementById(HS_BUTTON_CONTAINER_ID);
  if (existing) existing.remove();

  const ctx = getConversationContext();
  if (!ctx) return;

  // Check anchor first — many HS conversations (Messenger threads, certain
  // email layouts) don't expose [data-testid="conversation-header"]. The
  // floating card handles those — just skip the header button here.
  const anchor = findHsHeaderInsertion();
  if (!anchor) return;

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
  // Defensive: clear any running elapsed interval.
  if (hsElapsedInterval) {
    clearInterval(hsElapsedInterval);
    hsElapsedInterval = null;
  }

  const ctx = getConversationContext();
  if (!ctx) return;

  const buttons = [
    {
      button: document.getElementById('lc-hs-timer-button'),
      elapsed: document.getElementById('lc-hs-elapsed'),
      info: document.getElementById('lc-hs-info'),
    },
    {
      button: document.getElementById('lc-hs-card-timer-button'),
      elapsed: document.getElementById('lc-hs-card-elapsed'),
      info: document.getElementById('lc-hs-card-info'),
    },
  ].filter((b) => b.button);
  if (buttons.length === 0) return;

  const { settings } = await chrome.storage.local.get('settings');
  if (!settings?.apiKey) {
    buttons.forEach(({ button, elapsed, info }) => { applyHsButtonState(button, elapsed, info, 'hidden'); });
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
  buttons.forEach(({ button, elapsed, info }) => { applyHsButtonState(button, elapsed, info, state, activeTimer); });

  if (state === 'stop') startHsElapsedCounter(activeTimer.startedAt);

  if (state !== 'stop') {
    if (hsMainStartEditor) hsMainStartEditor.hide();
    if (hsCardStartEditor) hsCardStartEditor.hide();
  }

  if (hsMainSnapChip) hsMainSnapChip.refresh();
  if (hsCardSnapChip) hsCardSnapChip.refresh();
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

function createHsRightPanelCard() {
  const existing = document.getElementById(HS_CARD_ID);
  if (existing) existing.remove();

  const ctx = getConversationContext();
  if (!ctx) return;

  const card = document.createElement('div');
  card.id = HS_CARD_ID;
  card.className = 'lc-card';

  const title = document.createElement('div');
  title.className = 'lc-card-title';
  title.textContent = 'Clockify timer';

  const timerRow = document.createElement('div');
  timerRow.className = 'lc-card-timer-row';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'lc-hs-card-timer-button';
  button.className = 'lc-btn lc-btn-start';
  button.textContent = '▶ Start';

  const elapsed = document.createElement('span');
  elapsed.id = 'lc-hs-card-elapsed';
  elapsed.className = 'lc-elapsed';
  elapsed.style.display = 'none';

  const info = document.createElement('span');
  info.id = 'lc-hs-card-info';
  info.className = 'lc-info';
  info.style.display = 'none';

  hsCardSnapChip = buildSnapChip();
  hsCardSnapChip.chip.id = 'lc-hs-card-snap-chip';

  hsCardStartEditor = buildStartEditor();
  hsCardStartEditor.container.id = 'lc-hs-card-start-editor';

  const manualToggleBtn = document.createElement('button');
  manualToggleBtn.type = 'button';
  manualToggleBtn.className = 'lc-hs-manual-toggle';
  manualToggleBtn.textContent = '✎';
  manualToggleBtn.title = 'Manuális rögzítés';

  timerRow.appendChild(button);
  timerRow.appendChild(elapsed);
  timerRow.appendChild(info);
  timerRow.appendChild(hsCardSnapChip.chip);
  timerRow.appendChild(manualToggleBtn);

  elapsed.addEventListener('click', async () => {
    if (!hsCardStartEditor) return;
    if (hsCardStartEditor.container.style.display !== 'none') {
      hsCardStartEditor.hide();
      return;
    }
    const { activeTimer } = await chrome.storage.local.get('activeTimer');
    if (activeTimer?.startedAt && !activeTimer.external) {
      hsCardStartEditor.show(activeTimer.startedAt);
    }
  });

  const manualWrap = document.createElement('div');
  manualWrap.className = 'lc-hs-manual-wrap';
  manualWrap.style.display = 'none';

  const manualTitle = document.createElement('div');
  manualTitle.className = 'lc-card-subtitle';
  manualTitle.textContent = 'Manuális rögzítés';

  const { form, fields } = buildManualEntryForm();
  attachManualEntrySubmit(form, fields, async ({ startISO, endISO, dayStart, dayEnd }) => {
    const live = getConversationContext();
    return {
      action: 'createHsManualEntry',
      data: {
        ticketNumber: live?.ticketNumber || ctx.ticketNumber,
        subject: live?.subject || ctx.subject,
        customer: live?.customer || ctx.customer,
        startISO,
        endISO,
        dayStartISO: dayStart,
        dayEndISO: dayEnd,
      },
    };
  });

  manualWrap.appendChild(manualTitle);
  manualWrap.appendChild(form);

  manualToggleBtn.addEventListener('click', () => {
    const hidden = manualWrap.style.display === 'none';
    manualWrap.style.display = hidden ? 'block' : 'none';
    manualToggleBtn.classList.toggle('lc-hs-manual-toggle-active', hidden);
  });

  card.appendChild(title);
  card.appendChild(timerRow);
  card.appendChild(hsCardStartEditor.container);
  card.appendChild(manualWrap);

  // Append to body with position:fixed so HS's dynamic DOM can't remove us.
  document.body.appendChild(card);

  button.addEventListener('click', handleHsButtonClick);
  hsCardSnapChip.refresh();
}

// Keep-alive check: HS re-renders its conversation view on navigation or
// other interactions. If our UI goes missing, re-insert it. Running every
// second is cheap (two getElementById checks) and avoids the fragility of
// a one-shot MutationObserver that disconnects after first success.
let hsKeepAliveInterval = null;

function ensureHsUI() {
  if (!parseHsUrl(window.location.pathname)) return;
  // Run the two inserts independently — header may succeed while the sidebar
  // is still loading, or vice versa. Each create-* is idempotent (removes
  // existing element of its own ID before re-adding) but only does DOM work
  // when its anchor is actually found.
  if (!document.getElementById(HS_BUTTON_CONTAINER_ID)) createHsTimerButton();
  if (!document.getElementById(HS_CARD_ID)) createHsRightPanelCard();
  updateHsButtonState();
}

function startHsKeepAlive() {
  if (hsKeepAliveInterval) return;
  hsKeepAliveInterval = setInterval(ensureHsUI, 500);
}

// DOM observer — fires ensureHsUI on any document.body mutation, lightly
// debounced so we don't run the insert logic hundreds of times per second.
// 50ms feels immediate but keeps overhead low.
let hsLastUrl = window.location.href;
let hsDomDebounce = null;
const hsDomObserver = new MutationObserver(() => {
  if (window.location.href !== hsLastUrl) {
    hsLastUrl = window.location.href;
  }
  if (hsDomDebounce) return;
  hsDomDebounce = setTimeout(() => {
    hsDomDebounce = null;
    ensureHsUI();
  }, 50);
});
hsDomObserver.observe(document.body, { childList: true, subtree: true });

chrome.storage.onChanged.addListener((changes) => {
  if (changes.activeTimer || changes.settings) {
    updateHsButtonState();
  }
});

if (parseHsUrl(window.location.pathname)) {
  ensureHsUI();
  startHsKeepAlive();
}

console.log('[LC HS] content script initialized');
