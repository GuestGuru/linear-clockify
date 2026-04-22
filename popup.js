// Linear → Clockify Timer — Popup
const { parseTimeInput, formatHM } = window.LCShared;
const LINEAR_WORKSPACE = 'gghq';

const content = document.getElementById('content');
let elapsedInterval = null;

document.getElementById('settings-link').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function sectionHeader(text) {
  const el = document.createElement('div');
  el.className = 'section-header';
  el.textContent = text;
  return el;
}

function parseIssueKey(description) {
  const str = String(description || '');
  // Match [TEAM-N] but NOT [HS: ...]
  const linMatch = str.match(/\[([A-Z]+-\d+)\]/);
  // Trailing long-id HS suffix. The legacy [HS: #12345] format uses a # prefix
  // and the short ticket number — we skip that on purpose, since it has no
  // linkable long conversation id.
  const hsMatch = str.match(/\[HS:\s*(\d+)\]/);

  let cleanDesc = str;
  if (linMatch) cleanDesc = cleanDesc.replace(linMatch[0], '');
  if (hsMatch) cleanDesc = cleanDesc.replace(hsMatch[0], '');
  cleanDesc = cleanDesc.replace(/\s+/g, ' ').trim();

  return {
    issueKey: linMatch ? linMatch[1] : null,
    hsConvIdLong: hsMatch ? hsMatch[1] : null,
    cleanDesc,
  };
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDuration(ms) {
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function isoFromEntryDate(originalISO, parsedTime) {
  const base = new Date(originalISO);
  return new Date(
    base.getFullYear(), base.getMonth(), base.getDate(),
    parsedTime.h, parsedTime.m, 0, 0
  ).toISOString();
}

function buildRecentRow(entry) {
  const row = document.createElement('div');
  row.className = 'recent-row';
  const isRunning = !entry.timeInterval?.end;
  if (isRunning) row.classList.add('running');

  const top = document.createElement('div');
  top.className = 'recent-row-top';

  const { issueKey, cleanDesc, hsConvIdLong } = parseIssueKey(entry.description);
  if (issueKey) {
    const link = document.createElement('a');
    link.className = 'recent-issue-link';
    link.href = `https://linear.app/${LINEAR_WORKSPACE}/issue/${issueKey}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = issueKey;
    top.appendChild(link);
  }

  if (hsConvIdLong) {
    const hsLink = document.createElement('a');
    hsLink.className = 'recent-hs-link';
    hsLink.href = `https://secure.helpscout.net/conversation/${hsConvIdLong}`;
    hsLink.target = '_blank';
    hsLink.rel = 'noopener noreferrer';
    hsLink.textContent = 'HS';
    hsLink.title = `HelpScout #${hsConvIdLong}`;
    top.appendChild(hsLink);
  }

  const desc = document.createElement('div');
  desc.className = 'recent-desc';
  desc.textContent = cleanDesc || '(leírás nélkül)';
  desc.title = entry.description || '';
  top.appendChild(desc);

  row.appendChild(top);

  const bottom = document.createElement('div');
  bottom.className = 'recent-row-bottom';

  const startInput = document.createElement('input');
  startInput.type = 'text';
  startInput.className = 'recent-time-input';
  startInput.inputMode = 'numeric';
  startInput.autocomplete = 'off';
  startInput.maxLength = 5;
  const startDate = new Date(entry.timeInterval.start);
  startInput.value = formatTime(startDate);
  startInput.dataset.original = startInput.value;
  bottom.appendChild(startInput);

  const dash = document.createElement('span');
  dash.className = 'recent-dash';
  dash.textContent = '–';
  bottom.appendChild(dash);

  const endInput = document.createElement('input');
  endInput.type = 'text';
  endInput.className = 'recent-time-input';
  endInput.inputMode = 'numeric';
  endInput.autocomplete = 'off';
  endInput.maxLength = 5;
  let endDate = null;
  if (isRunning) {
    endInput.value = 'fut';
    endInput.disabled = true;
    endInput.classList.add('running-end');
  } else {
    endDate = new Date(entry.timeInterval.end);
    endInput.value = formatTime(endDate);
    endInput.dataset.original = endInput.value;
  }
  bottom.appendChild(endInput);

  const duration = document.createElement('span');
  duration.className = 'recent-duration';
  const durMs = (endDate ? endDate.getTime() : Date.now()) - startDate.getTime();
  duration.textContent = formatDuration(durMs);
  bottom.appendChild(duration);

  const status = document.createElement('span');
  status.className = 'recent-status';
  bottom.appendChild(status);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'recent-delete';
  deleteBtn.textContent = '×';
  deleteBtn.title = 'Törlés';
  bottom.appendChild(deleteBtn);

  row.appendChild(bottom);

  let confirmTimer = null;
  function resetDeleteBtn() {
    deleteBtn.classList.remove('confirm');
    deleteBtn.textContent = '×';
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  deleteBtn.addEventListener('click', async () => {
    if (!deleteBtn.classList.contains('confirm')) {
      deleteBtn.classList.add('confirm');
      deleteBtn.textContent = 'Biztos?';
      confirmTimer = setTimeout(resetDeleteBtn, 3000);
      return;
    }
    resetDeleteBtn();
    deleteBtn.disabled = true;
    setStatus('info', '…');
    const result = await chrome.runtime.sendMessage({
      action: 'deleteEntry',
      data: { entryId: entry.id },
    });
    if (result?.error) {
      deleteBtn.disabled = false;
      setStatus('error', result.error);
      return;
    }
    row.style.transition = 'opacity 0.2s';
    row.style.opacity = '0';
    setTimeout(() => row.remove(), 200);
  });

  function setStatus(kind, text) {
    status.className = `recent-status ${kind}`;
    status.textContent = text || '';
  }

  async function save() {
    const parsedStart = parseTimeInput(startInput.value);
    if (!parsedStart) {
      setStatus('error', 'Érvénytelen kezdés');
      return;
    }
    startInput.value = formatHM(parsedStart);

    let newEndISO = null;
    if (!isRunning) {
      const parsedEnd = parseTimeInput(endInput.value);
      if (!parsedEnd) {
        setStatus('error', 'Érvénytelen vég');
        return;
      }
      endInput.value = formatHM(parsedEnd);
      newEndISO = isoFromEntryDate(entry.timeInterval.end, parsedEnd);
    }

    const startChanged = startInput.value !== startInput.dataset.original;
    const endChanged = !isRunning && endInput.value !== endInput.dataset.original;
    if (!startChanged && !endChanged) {
      setStatus('', '');
      return;
    }

    const newStartISO = isoFromEntryDate(entry.timeInterval.start, parsedStart);

    setStatus('info', '…');
    const result = await chrome.runtime.sendMessage({
      action: 'updateEntryTimes',
      data: { entryId: entry.id, newStartISO, newEndISO },
    });

    if (result?.error === 'OVERLAP') {
      setStatus('error', `Átfedés: ${result.conflictWith}`);
      return;
    }
    if (result?.error) {
      setStatus('error', result.error);
      return;
    }

    // Update originals + duration + success tick
    startInput.dataset.original = startInput.value;
    if (!isRunning) endInput.dataset.original = endInput.value;
    const newStart = new Date(newStartISO);
    const newEnd = newEndISO ? new Date(newEndISO) : new Date();
    duration.textContent = formatDuration(newEnd.getTime() - newStart.getTime());
    setStatus('success', '✓');
    setTimeout(() => setStatus('', ''), 1500);
  }

  function saveOnChange() {
    const startChanged = startInput.value !== startInput.dataset.original;
    const endChanged = !isRunning && endInput.value !== endInput.dataset.original;
    if (startChanged || endChanged) save();
  }

  [startInput, endInput].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  });

  startInput.addEventListener('blur', saveOnChange);
  if (!isRunning) endInput.addEventListener('blur', saveOnChange);

  return row;
}

function renderActiveTimer(activeTimer, settings) {
  const header = sectionHeader('Aktív timer');
  content.appendChild(header);

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
    projectEl.textContent = `📁 ${activeTimer.projectName}`;
    timerInfo.appendChild(projectEl);
  }
  content.appendChild(timerInfo);

  const elapsedEl = document.createElement('div');
  elapsedEl.className = 'elapsed';
  elapsedEl.id = 'popup-elapsed';
  elapsedEl.textContent = '00:00:00';
  content.appendChild(elapsedEl);
  startElapsed(activeTimer.startedAt);

  if (!activeTimer.external) {
    const linearConfigComplete = !!(
      settings?.linearApiKey && settings?.linearDefaultTeamId &&
      settings?.linearViewerId && settings?.linearInProgressStateId
    );
    let doneBtn = null;

    const stopBtn = document.createElement('button');
    stopBtn.className = 'stop-btn';
    stopBtn.textContent = '⏹ Stop';
    stopBtn.addEventListener('click', async () => {
      stopBtn.disabled = true;
      if (doneBtn) doneBtn.disabled = true;
      const result = await chrome.runtime.sendMessage({ action: 'stopTimer' });
      if (result.error) {
        const errEl = document.createElement('div');
        errEl.className = 'error';
        errEl.style.display = 'block';
        errEl.textContent = result.error;
        content.appendChild(errEl);
        stopBtn.disabled = false;
        if (doneBtn) doneBtn.disabled = false;
      } else {
        render();
      }
    });
    content.appendChild(stopBtn);

    if (activeTimer.issueKey && linearConfigComplete) {
      doneBtn = document.createElement('button');
      doneBtn.className = 'done-btn';
      doneBtn.textContent = '✓ Stop & Done';
      doneBtn.addEventListener('click', async () => {
        stopBtn.disabled = true;
        doneBtn.disabled = true;
        const result = await chrome.runtime.sendMessage({ action: 'stopAndDoneTimer' });
        if (result.error) {
          const errEl = document.createElement('div');
          errEl.className = 'error';
          errEl.style.display = 'block';
          errEl.textContent = result.error;
          content.appendChild(errEl);
          stopBtn.disabled = false;
          doneBtn.disabled = false;
          return;
        }
        if (result.warning) {
          const warnEl = document.createElement('div');
          warnEl.className = 'error';
          warnEl.style.display = 'block';
          warnEl.style.color = '#eab308';
          warnEl.textContent = `⚠️ ${result.warning}`;
          content.appendChild(warnEl);
        }
        render();
      });
      content.appendChild(doneBtn);
    }
  }
}

async function renderRecent() {
  content.appendChild(sectionHeader('Legutóbbi bejegyzések'));
  const list = document.createElement('div');
  list.className = 'recent-list';
  content.appendChild(list);

  const loading = document.createElement('div');
  loading.className = 'spinner-center';
  const spinnerEl = document.createElement('span');
  spinnerEl.className = 'spinner';
  loading.appendChild(spinnerEl);
  loading.appendChild(document.createTextNode('Betöltés…'));
  list.appendChild(loading);

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'getRecentEntries',
      data: { pageSize: 3 },
    });
    loading.remove();
    const entries = result?.entries || [];
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recent-empty';
      empty.textContent = 'Még nincs bejegyzés';
      list.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      list.appendChild(buildRecentRow(entry));
    }
  } catch (err) {
    loading.remove();
    const errEl = document.createElement('div');
    errEl.className = 'recent-empty';
    errEl.textContent = `Hiba: ${err.message}`;
    list.appendChild(errEl);
  }
}

async function render() {
  const { activeTimer } = await chrome.storage.local.get('activeTimer');
  const { settings } = await chrome.storage.local.get('settings');

  content.textContent = '';
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }

  if (!settings?.apiKey || !settings?.linearApiKey) {
    const msg = document.createElement('div');
    msg.className = 'no-timer';
    msg.textContent = 'API key(ek) nincsenek beállítva';
    content.appendChild(msg);
    return;
  }

  if (activeTimer) {
    renderActiveTimer(activeTimer, settings);
  }

  await renderRecent();
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
    el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  update();
  elapsedInterval = setInterval(update, 1000);
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.activeTimer || changes.settings) render();
});
render();
