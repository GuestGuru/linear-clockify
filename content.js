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

// ─── Time Input Parsing ───────────────────────────────────────────────────────

function parseTimeInput(raw) {
  const str = String(raw || '').trim();
  if (!str) return null;

  const colonMatch = str.match(/^(\d{1,2}):(\d{2})$/);
  if (colonMatch) {
    const h = Number(colonMatch[1]);
    const m = Number(colonMatch[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return { h, m };
  }

  const digits = str.replace(/\D/g, '');
  if (digits.length < 1 || digits.length > 4) return null;

  let h, m;
  if (digits.length <= 2) {
    h = Number(digits);
    m = 0;
  } else if (digits.length === 3) {
    h = Number(digits.slice(0, 1));
    m = Number(digits.slice(1));
  } else {
    h = Number(digits.slice(0, 2));
    m = Number(digits.slice(2));
  }

  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function formatHM({ h, m }) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localTimeToISO(dateStr, h, m) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0).toISOString();
}

function dayBoundsISO(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const start = new Date(y, mo - 1, d, 0, 0, 0, 0);
  const end = new Date(y, mo - 1, d + 1, 0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

// ─── Manual Entry Form ────────────────────────────────────────────────────────

function buildManualEntryForm() {
  const form = document.createElement('form');
  form.className = 'lc-manual-form';

  const row = document.createElement('div');
  row.className = 'lc-form-row';

  const from = document.createElement('input');
  from.type = 'text';
  from.className = 'lc-time-input';
  from.placeholder = 'mettől';
  from.inputMode = 'numeric';
  from.autocomplete = 'off';
  from.maxLength = 5;

  const dash = document.createElement('span');
  dash.className = 'lc-dash';
  dash.textContent = '–';

  const to = document.createElement('input');
  to.type = 'text';
  to.className = 'lc-time-input';
  to.placeholder = 'meddig';
  to.inputMode = 'numeric';
  to.autocomplete = 'off';
  to.maxLength = 5;

  const dateChip = document.createElement('button');
  dateChip.type = 'button';
  dateChip.className = 'lc-date-chip';
  dateChip.textContent = '📅 Ma';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'lc-date-input';
  dateInput.value = todayStr();
  dateInput.style.display = 'none';

  const updateDateChip = () => {
    const today = todayStr();
    if (dateInput.value === today) {
      dateChip.textContent = '📅 Ma';
    } else {
      dateChip.textContent = `📅 ${dateInput.value}`;
    }
  };

  dateChip.addEventListener('click', () => {
    const wasHidden = dateInput.style.display === 'none';
    dateInput.style.display = wasHidden ? 'inline-block' : 'none';
    if (wasHidden) dateInput.focus();
  });
  dateInput.addEventListener('change', () => {
    updateDateChip();
    dateInput.style.display = 'none';
  });

  [from, to].forEach((input) => {
    input.addEventListener('blur', () => {
      if (!input.value) return;
      const parsed = parseTimeInput(input.value);
      if (parsed) input.value = formatHM(parsed);
    });
  });

  row.appendChild(from);
  row.appendChild(dash);
  row.appendChild(to);
  row.appendChild(dateChip);
  row.appendChild(dateInput);

  const submitRow = document.createElement('div');
  submitRow.className = 'lc-form-submit-row';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'lc-submit-btn';
  submit.textContent = 'Rögzít';

  const status = document.createElement('div');
  status.className = 'lc-status';
  status.style.display = 'none';

  submitRow.appendChild(submit);

  form.appendChild(row);
  form.appendChild(submitRow);
  form.appendChild(status);

  return { form, fields: { from, to, dateInput, submit, status } };
}

function setStatus(el, kind, text) {
  el.style.display = 'block';
  el.className = `lc-status lc-status-${kind}`;
  el.textContent = text;
}

function clearStatus(el) {
  el.style.display = 'none';
  el.textContent = '';
}

function attachManualEntrySubmit(form, fields) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const issue = parseIssueFromUrl();
    if (!issue) return;

    const { from, to, dateInput, submit, status } = fields;
    clearStatus(status);

    const parsedFrom = parseTimeInput(from.value);
    const parsedTo = parseTimeInput(to.value);

    if (!parsedFrom || !parsedTo) {
      setStatus(status, 'error', 'Érvénytelen időformátum (pl. 1413 → 14:13)');
      return;
    }
    from.value = formatHM(parsedFrom);
    to.value = formatHM(parsedTo);

    const fromMin = parsedFrom.h * 60 + parsedFrom.m;
    const toMin = parsedTo.h * 60 + parsedTo.m;
    if (fromMin >= toMin) {
      setStatus(status, 'error', 'A „Meddig" nagyobb kell legyen, mint a „Mettől"');
      return;
    }

    const dateStr = dateInput.value || todayStr();
    const startISO = localTimeToISO(dateStr, parsedFrom.h, parsedFrom.m);
    const endISO = localTimeToISO(dateStr, parsedTo.h, parsedTo.m);
    const { start: dayStart, end: dayEnd } = dayBoundsISO(dateStr);

    submit.disabled = true;
    setStatus(status, 'info', 'Mentés…');

    try {
      const issueTitle = await getIssueTitle();
      const result = await chrome.runtime.sendMessage({
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
      });

      if (result?.error === 'OVERLAP') {
        setStatus(status, 'error', `Átfedés: ${result.conflictWith}`);
      } else if (result?.error === 'NO_API_KEY') {
        setStatus(status, 'error', 'Beállítás szükséges');
      } else if (result?.error) {
        setStatus(status, 'error', result.error);
      } else {
        const msg = result?.warning ? `Rögzítve ✓ — ${result.warning}` : 'Rögzítve ✓';
        setStatus(status, 'success', msg);
        from.value = '';
        to.value = '';
        setTimeout(() => clearStatus(status), 4000);
      }
    } catch (err) {
      setStatus(status, 'error', err.message);
    } finally {
      submit.disabled = false;
    }
  });
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
  attachManualEntrySubmit(mobileForm, mobileFields);

  mobileFormWrap.appendChild(manualSubtitle);
  mobileFormWrap.appendChild(mobileForm);

  mobileEditBtn.addEventListener('click', () => {
    const hidden = mobileFormWrap.style.display === 'none';
    mobileFormWrap.style.display = hidden ? 'block' : 'none';
    container.classList.toggle('lc-mobile-expanded', hidden);
  });

  container.appendChild(button);
  container.appendChild(elapsed);
  container.appendChild(info);
  container.appendChild(mobileEditBtn);
  container.appendChild(mobileFormWrap);

  const insertionPoint = findInsertionPoint();
  if (insertionPoint) {
    insertionPoint.appendChild(container);
  }

  button.addEventListener('click', handleButtonClick);
  updateButtonState();
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
  timerRow.appendChild(elapsed);
  timerRow.appendChild(info);

  const divider = document.createElement('div');
  divider.className = 'lc-card-divider';

  const manualTitle = document.createElement('div');
  manualTitle.className = 'lc-card-subtitle';
  manualTitle.textContent = 'Manuális rögzítés';

  const { form, fields } = buildManualEntryForm();
  attachManualEntrySubmit(form, fields);

  card.appendChild(title);
  card.appendChild(timerRow);
  card.appendChild(divider);
  card.appendChild(manualTitle);
  card.appendChild(form);

  const { parent, afterNode } = insertion;
  parent.insertBefore(card, afterNode.nextSibling);

  button.addEventListener('click', handleButtonClick);
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

  if (state === 'stop') {
    startElapsedCounter(activeTimer.startedAt);
  }
}

function startElapsedCounter(startedAt) {
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
    updateButtonState();
  }
});

if (parseIssueFromUrl()) {
  waitForDomAndInit();
}
