// Linear → Clockify Timer — Popup
const {
  parseTimeInput, formatHM,
  todayStr, localTimeToISO, dayBoundsISO,
  parseHsUrl, canonicalizeHsUrl, parseHsTitle,
} = window.LCShared;
const LINEAR_WORKSPACE = 'gghq';

const content = document.getElementById('content');
let elapsedInterval = null;
let renderGeneration = 0;

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

function buildRecentRow(entry, activeTimer, settings, hasLocalTimer) {
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
    endInput.value = formatRunningElapsed(entry.timeInterval.start);
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
  if (!isRunning) {
    const durMs = endDate.getTime() - startDate.getTime();
    duration.textContent = formatDuration(durMs);
  }
  bottom.appendChild(duration);

  const status = document.createElement('span');
  status.className = 'recent-status';
  bottom.appendChild(status);

  let playBtn = null;
  if (!hasLocalTimer && !isRunning) {
    playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'recent-play';
    playBtn.textContent = '▶';
    playBtn.title = 'Új timer indítása ezekkel az adatokkal';
    bottom.appendChild(playBtn);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'recent-delete';
  deleteBtn.textContent = '×';
  deleteBtn.title = 'Törlés';
  bottom.appendChild(deleteBtn);

  if (playBtn) {
    playBtn.addEventListener('click', async () => {
      playBtn.disabled = true;
      deleteBtn.disabled = true;
      setStatus('info', '…');
      const result = await chrome.runtime.sendMessage({
        action: 'startFromEntry',
        data: { entryId: entry.id },
      });
      if (result?.error) {
        playBtn.disabled = false;
        deleteBtn.disabled = false;
        const msg = result.error === 'ALREADY_RUNNING' ? 'Már fut egy timer' : result.error;
        setStatus('error', msg);
        return;
      }
      // storage change will re-render
    });
  }

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

  if (isRunning) {
    const actions = buildRunningActions(activeTimer, settings);
    if (actions) row.appendChild(actions);
    startRunningTicker(endInput, entry.timeInterval.start);
  }

  return row;
}

function formatRunningElapsed(startedAtISO) {
  const diff = Date.now() - new Date(startedAtISO).getTime();
  const totalMin = Math.floor(diff / 60000);
  if (totalMin < 60) {
    const s = Math.floor((diff % 60000) / 1000);
    return `${String(totalMin).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function startRunningTicker(endInput, startedAtISO) {
  if (elapsedInterval) clearInterval(elapsedInterval);
  const tick = () => { endInput.value = formatRunningElapsed(startedAtISO); };
  tick();
  elapsedInterval = setInterval(tick, 1000);
}

function buildRunningActions(activeTimer, settings) {
  if (!activeTimer || activeTimer.external) return null;

  const linearConfigComplete = !!(
    settings?.linearApiKey && settings?.linearDefaultTeamId &&
    settings?.linearViewerId && settings?.linearInProgressStateId
  );

  const actions = document.createElement('div');
  actions.className = 'recent-actions';

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
  actions.appendChild(stopBtn);

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
    actions.appendChild(doneBtn);
  }

  return actions;
}

async function renderRecent(activeTimer, settings, gen, hasLocalTimer) {
  const isStale = () => gen !== renderGeneration;

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

  const rawCount = settings?.recentEntriesCount;
  const parsedCount = Number.parseInt(rawCount, 10);
  const pageSize = Number.isFinite(parsedCount)
    ? Math.min(20, Math.max(1, parsedCount))
    : 3;

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'getRecentEntries',
      data: { pageSize },
    });
    if (isStale()) return;
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
      list.appendChild(buildRecentRow(entry, activeTimer, settings, hasLocalTimer));
    }
  } catch (err) {
    if (isStale()) return;
    loading.remove();
    const errEl = document.createElement('div');
    errEl.className = 'recent-empty';
    errEl.textContent = `Hiba: ${err.message}`;
    list.appendChild(errEl);
  }
}

async function getActiveTabInfo() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab?.url) return null;
    return { id: tab.id, url: tab.url, title: tab.title || '' };
  } catch {
    return null;
  }
}

function tabUrlSource(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'linear.app' && u.pathname.includes('/issue/')) {
      const m = u.pathname.match(/\/[^/]+\/issue\/([A-Z]+)-(\d+)/);
      if (m) return { source: 'linear', issueKey: `${m[1]}-${m[2]}`, teamKey: m[1] };
    }
    if (u.hostname === 'secure.helpscout.net') {
      const parsed = parseHsUrl(u.pathname);
      if (parsed) return { source: 'hs', convId: parsed.convId, ticketNumber: parsed.ticketNumber };
    }
  } catch {
    // ignore
  }
  return null;
}

async function requestPageContext(tabId) {
  if (typeof tabId !== 'number') return null;
  try {
    const ctx = await chrome.tabs.sendMessage(tabId, { action: 'getPageContext' });
    if (ctx?.source) return ctx;
    return null;
  } catch {
    // Content script may not be loaded yet (or tab is not a matched origin).
    return null;
  }
}

async function resolvePageContext() {
  const tab = await getActiveTabInfo();
  if (!tab) return null;
  const urlInfo = tabUrlSource(tab.url);
  if (!urlInfo) return null;

  const fromScript = await requestPageContext(tab.id);
  if (fromScript) return fromScript;

  // Fallback: parse what we can from URL + tab.title.
  if (urlInfo.source === 'linear') {
    let title = (tab.title || '').replace(/\s*[—–-]\s*Linear\s*$/, '').trim();
    title = title.replace(new RegExp(`^${urlInfo.issueKey}\\s+`), '');
    return {
      source: 'linear',
      issueKey: urlInfo.issueKey,
      teamKey: urlInfo.teamKey,
      issueTitle: title || urlInfo.issueKey,
    };
  }
  if (urlInfo.source === 'hs') {
    const parsedTitle = parseHsTitle(tab.title) || {};
    return {
      source: 'hs',
      convId: urlInfo.convId,
      ticketNumber: urlInfo.ticketNumber,
      subject: parsedTitle.subject || '',
      customer: parsedTitle.customer || '',
      canonicalHsUrl: canonicalizeHsUrl(tab.url) || tab.url,
      emails: [],
      hsCustomerId: null,
    };
  }
  return null;
}

function formatSnapLabel(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildStartSection(pageCtx, snapInfo, settings) {
  const section = document.createElement('div');
  section.className = 'start-section';

  const ctxRow = document.createElement('div');
  ctxRow.className = 'start-context';

  const keyEl = document.createElement('span');
  keyEl.className = 'start-context-key';
  if (pageCtx.source === 'linear') {
    keyEl.textContent = pageCtx.issueKey;
  } else {
    keyEl.classList.add('hs');
    keyEl.textContent = `HS #${pageCtx.ticketNumber}`;
  }
  ctxRow.appendChild(keyEl);

  const titleEl = document.createElement('span');
  titleEl.className = 'start-context-title';
  if (pageCtx.source === 'linear') {
    titleEl.textContent = pageCtx.issueTitle || '';
    titleEl.title = pageCtx.issueTitle || '';
  } else {
    const parts = [pageCtx.subject, pageCtx.customer].filter(Boolean).join(' — ');
    titleEl.textContent = parts || '(nincs cím)';
    titleEl.title = parts;
  }
  ctxRow.appendChild(titleEl);
  section.appendChild(ctxRow);

  const actions = document.createElement('div');
  actions.className = 'start-actions';

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'start-btn';
  startBtn.textContent = '▶ Start';
  actions.appendChild(startBtn);

  const hasSnap = !!(snapInfo?.snapEnabled && snapInfo.snapTo);
  let snapBtn = null;
  if (hasSnap) {
    snapBtn = document.createElement('button');
    snapBtn.type = 'button';
    snapBtn.className = 'start-btn snap';
    snapBtn.textContent = `↶ ${formatSnapLabel(snapInfo.snapTo)} Start`;
    snapBtn.title = 'Start az előző entry végétől';
    actions.appendChild(snapBtn);
  }

  const manualBtn = document.createElement('button');
  manualBtn.type = 'button';
  manualBtn.className = 'start-btn-manual';
  manualBtn.textContent = '✎';
  manualBtn.title = 'Manuális rögzítés';
  actions.appendChild(manualBtn);

  section.appendChild(actions);

  const manualForm = document.createElement('div');
  manualForm.className = 'start-manual-form';

  const row = document.createElement('div');
  row.className = 'start-manual-row';

  const fromInput = document.createElement('input');
  fromInput.type = 'text';
  fromInput.placeholder = 'mettől';
  fromInput.inputMode = 'numeric';
  fromInput.autocomplete = 'off';
  fromInput.maxLength = 5;

  const dash = document.createElement('span');
  dash.className = 'start-manual-dash';
  dash.textContent = '–';

  const toInput = document.createElement('input');
  toInput.type = 'text';
  toInput.placeholder = 'meddig';
  toInput.inputMode = 'numeric';
  toInput.autocomplete = 'off';
  toInput.maxLength = 5;

  const dateChip = document.createElement('button');
  dateChip.type = 'button';
  dateChip.className = 'start-manual-date-chip';
  dateChip.textContent = '📅 Ma';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = todayStr();
  dateInput.style.display = 'none';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'start-manual-submit';
  submitBtn.textContent = 'Rögzít';

  row.appendChild(fromInput);
  row.appendChild(dash);
  row.appendChild(toInput);
  row.appendChild(dateChip);
  row.appendChild(dateInput);
  row.appendChild(submitBtn);

  const status = document.createElement('div');
  status.className = 'start-manual-status';

  manualForm.appendChild(row);
  manualForm.appendChild(status);
  section.appendChild(manualForm);

  const setStatus = (kind, text) => {
    status.className = `start-manual-status ${kind || ''}`.trim();
    status.textContent = text || '';
  };

  const updateDateChip = () => {
    const today = todayStr();
    dateChip.textContent = dateInput.value === today ? '📅 Ma' : `📅 ${dateInput.value}`;
  };
  dateChip.addEventListener('click', () => {
    const hidden = dateInput.style.display === 'none';
    dateInput.style.display = hidden ? '' : 'none';
    if (hidden) dateInput.focus();
  });
  dateInput.addEventListener('change', () => {
    updateDateChip();
    dateInput.style.display = 'none';
  });

  [fromInput, toInput].forEach((input) => {
    input.addEventListener('blur', () => {
      if (!input.value) return;
      const parsed = parseTimeInput(input.value);
      if (parsed) input.value = formatHM(parsed);
    });
  });

  manualBtn.addEventListener('click', () => {
    const open = !manualForm.classList.contains('open');
    manualForm.classList.toggle('open', open);
    manualBtn.classList.toggle('active', open);
    if (open) setTimeout(() => fromInput.focus(), 0);
  });

  async function runStart(startOverrideISO) {
    startBtn.disabled = true;
    if (snapBtn) snapBtn.disabled = true;
    try {
      let result;
      if (pageCtx.source === 'linear') {
        result = await chrome.runtime.sendMessage({
          action: 'startTimer',
          data: {
            issueKey: pageCtx.issueKey,
            issueTitle: pageCtx.issueTitle || pageCtx.issueKey,
            teamKey: pageCtx.teamKey,
            startOverrideISO: startOverrideISO || undefined,
          },
        });
      } else {
        result = await chrome.runtime.sendMessage({
          action: 'startHsTimer',
          data: {
            convId: pageCtx.convId,
            ticketNumber: pageCtx.ticketNumber,
            subject: pageCtx.subject,
            customer: pageCtx.customer,
            canonicalHsUrl: pageCtx.canonicalHsUrl,
            emails: pageCtx.emails || [],
            hsCustomerId: pageCtx.hsCustomerId || null,
            startOverrideISO: startOverrideISO || undefined,
          },
        });
      }
      if (result?.error) {
        setStatus('error', result.error === 'NO_API_KEY' ? 'Beállítás szükséges' : result.error);
        startBtn.disabled = false;
        if (snapBtn) snapBtn.disabled = false;
        return;
      }
      // storage change will re-render and hide this section
    } catch (err) {
      setStatus('error', err.message);
      startBtn.disabled = false;
      if (snapBtn) snapBtn.disabled = false;
    }
  }

  startBtn.addEventListener('click', () => runStart(new Date().toISOString()));
  if (snapBtn) snapBtn.addEventListener('click', () => runStart(snapInfo.snapTo));

  submitBtn.addEventListener('click', async () => {
    setStatus('', '');
    const parsedFrom = parseTimeInput(fromInput.value);
    const parsedTo = parseTimeInput(toInput.value);
    if (!parsedFrom || !parsedTo) {
      setStatus('error', 'Érvénytelen időformátum (pl. 1413 → 14:13)');
      return;
    }
    fromInput.value = formatHM(parsedFrom);
    toInput.value = formatHM(parsedTo);
    const fromMin = parsedFrom.h * 60 + parsedFrom.m;
    const toMin = parsedTo.h * 60 + parsedTo.m;
    if (fromMin >= toMin) {
      setStatus('error', 'A „Meddig" nagyobb kell legyen');
      return;
    }
    const dateStr = dateInput.value || todayStr();
    const startISO = localTimeToISO(dateStr, parsedFrom.h, parsedFrom.m);
    const endISO = localTimeToISO(dateStr, parsedTo.h, parsedTo.m);
    const { start: dayStart, end: dayEnd } = dayBoundsISO(dateStr);

    submitBtn.disabled = true;
    setStatus('info', 'Mentés…');
    try {
      let result;
      if (pageCtx.source === 'linear') {
        result = await chrome.runtime.sendMessage({
          action: 'createManualEntry',
          data: {
            issueKey: pageCtx.issueKey,
            issueTitle: pageCtx.issueTitle || pageCtx.issueKey,
            teamKey: pageCtx.teamKey,
            start: startISO,
            end: endISO,
            dayStart,
            dayEnd,
          },
        });
      } else {
        result = await chrome.runtime.sendMessage({
          action: 'createHsManualEntry',
          data: {
            convId: pageCtx.convId,
            ticketNumber: pageCtx.ticketNumber,
            subject: pageCtx.subject,
            customer: pageCtx.customer,
            canonicalHsUrl: pageCtx.canonicalHsUrl,
            emails: pageCtx.emails || [],
            hsCustomerId: pageCtx.hsCustomerId || null,
            startISO,
            endISO,
            dayStartISO: dayStart,
            dayEndISO: dayEnd,
          },
        });
      }
      if (result?.error === 'OVERLAP') {
        setStatus('error', `Átfedés: ${result.conflictWith}`);
      } else if (result?.error) {
        setStatus('error', result.error);
      } else {
        const msg = result?.warning ? `Rögzítve ✓ — ${result.warning}` : 'Rögzítve ✓';
        setStatus('success', msg);
        fromInput.value = '';
        toInput.value = '';
        render();
      }
    } catch (err) {
      setStatus('error', err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Swallow settings var to avoid unused-param warning; currently not needed
  // for rendering, but kept in the signature so future tweaks (e.g. showing
  // Linear-config state) don't need a new plumbing pass.
  void settings;

  return section;
}

async function render() {
  // Concurrent renders (explicit render() after stop + storage.onChanged
  // listener firing for the same change) used to double-append sections.
  // Bump a generation counter and bail out at every async boundary if we're
  // no longer the latest render.
  const gen = ++renderGeneration;
  const isStale = () => gen !== renderGeneration;

  content.textContent = '';
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }

  const { activeTimer } = await chrome.storage.local.get('activeTimer');
  if (isStale()) return;
  const { settings } = await chrome.storage.local.get('settings');
  if (isStale()) return;

  if (!settings?.apiKey || !settings?.linearApiKey) {
    const msg = document.createElement('div');
    msg.className = 'no-timer';
    msg.textContent = 'API key(ek) nincsenek beállítva';
    content.appendChild(msg);
    return;
  }

  const hasLocalTimer = activeTimer && !activeTimer.external;
  if (!hasLocalTimer) {
    const pageCtx = await resolvePageContext();
    if (isStale()) return;
    if (pageCtx) {
      let snapInfo = null;
      try {
        snapInfo = await chrome.runtime.sendMessage({ action: 'getSnapInfo' });
      } catch {
        snapInfo = null;
      }
      if (isStale()) return;
      content.appendChild(buildStartSection(pageCtx, snapInfo, settings));
    }
  }

  await renderRecent(activeTimer, settings, gen, hasLocalTimer);
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.activeTimer || changes.settings) render();
});
render();
