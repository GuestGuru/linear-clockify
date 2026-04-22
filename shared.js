(function (global) {
  // ─── Time parsing ─────────────────────────────────────────────────────────

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

  // ─── HelpScout parsing ──────────────────────────────────────────────────

  function parseHsUrl(pathname) {
    const str = String(pathname || '');
    const m = str.match(/^\/conversation\/(\d+)\/(\d+)\/?$/);
    if (!m) return null;
    return { convId: m[1], ticketNumber: m[2] };
  }

  function canonicalizeHsUrl(raw) {
    const str = String(raw || '').trim();
    if (!str) return null;
    try {
      const u = new URL(str);
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch {
      return null;
    }
  }

  const HS_EMAIL_SELECTOR = '[data-cy="Sidebar.CustomerEmails"] [data-testid="EmailList.EmailLink"]';

  function parseHsEmailsFromDom(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return [];
    const links = root.querySelectorAll(HS_EMAIL_SELECTOR);
    const out = [];
    for (const link of links) {
      const span = link.querySelector?.('.c-Truncate__content');
      const text = span?.textContent ? String(span.textContent).trim() : '';
      if (text) out.push(text);
    }
    return out;
  }

  function parseHsCustomerIdFromDom(root) {
    if (!root || typeof root.querySelector !== 'function') return null;
    const link = root.querySelector(HS_EMAIL_SELECTOR);
    if (!link) return null;
    const href = link.getAttribute?.('href');
    if (!href) return null;
    const m = String(href).match(/\/customer\/(\d+)/);
    return m ? m[1] : null;
  }

  function parseHsTitle(title) {
    const str = String(title || '').trim();
    const headMatch = str.match(/^#(\d+)\s+(.+)$/);
    if (!headMatch) return null;
    const ticketNumber = headMatch[1];
    const rest = headMatch[2];

    const lastSep = rest.lastIndexOf(' - ');
    if (lastSep === -1) return null;

    const subject = rest.slice(0, lastSep).trim();
    const customer = rest.slice(lastSep + 3).trim();
    if (!subject || !customer) return null;

    return { ticketNumber, subject, customer };
  }

  function buildHsDescription({ issueKey, ticketNumber, subject, customer } = {}) {
    const subj = subject && String(subject).trim();
    const cust = customer && String(customer).trim();
    const tnum = ticketNumber && String(ticketNumber).trim();

    if (issueKey) {
      const body = subj || (tnum ? `HS #${tnum}` : '');
      const tail = cust ? (body ? `${body} — ${cust}` : cust) : body;
      return tail ? `[${issueKey}] ${tail}` : `[${issueKey}]`;
    }

    // Fallback: no Linear identifier → legacy HS-prefix format
    const prefix = tnum ? `[HS: #${tnum}]` : '[HS: #?]';
    const legacyTail = [subj, cust].filter(Boolean).join(' - ');
    return legacyTail ? `${prefix} ${legacyTail}` : prefix;
  }

  // ─── Snap-to-previous time ──────────────────────────────────────────────

  const SNAP_WINDOW_MS = 30 * 60 * 1000;

  function computeSnapTime(entries, nowMs) {
    if (!Array.isArray(entries) || entries.length === 0) return null;

    let latestEnd = 0;
    for (const e of entries) {
      const end = e?.timeInterval?.end;
      if (!end) continue;
      const t = new Date(end).getTime();
      if (Number.isFinite(t) && t > latestEnd) latestEnd = t;
    }
    if (!latestEnd) return null;

    const gap = nowMs - latestEnd;
    if (gap <= 0 || gap >= SNAP_WINDOW_MS) return null;
    return new Date(latestEnd).toISOString();
  }

  // ─── Linear issue key parsing ───────────────────────────────────────────

  function parseTeamKeyFromIssueKey(issueKey) {
    if (typeof issueKey !== 'string' || !issueKey) return null;
    const m = issueKey.match(/^([A-Za-z]+)-(\d+)$/);
    if (!m) return null;
    return m[1].toUpperCase();
  }

  // ─── Timer source detection ──────────────────────────────────────────────

  function detectTimerSource(description) {
    const str = String(description || '');
    if (!str) return null;

    const hs = str.match(/^\[HS:\s*#?(\d+)\]\s*(.*)$/);
    if (hs) {
      return {
        source: 'hs',
        ticketNumber: hs[1],
        issueTitle: hs[2].trim(),
      };
    }

    const linear = str.match(/^\[([A-Z]+-\d+)\]\s*(.+)$/);
    if (linear) {
      const issueKey = linear[1];
      const teamKey = issueKey.split('-')[0];
      return {
        source: 'linear',
        issueKey,
        teamKey,
        issueTitle: linear[2].trim(),
      };
    }

    return null;
  }

  // ─── Linear API wrapper ──────────────────────────────────────────────────

  async function linearRequest({ query, variables, apiKey, fetchFn }) {
    if (!apiKey) throw new Error('LINEAR_NO_API_KEY');
    const response = await fetchFn('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    if (response.status === 401) {
      throw new Error('LINEAR_AUTH');
    }
    if (response.status === 429) {
      throw new Error('LINEAR_RATE_LIMIT');
    }
    // Linear returns structured GraphQL errors even on non-2xx (400 with body).
    // Parse the body as JSON first so the caller sees the real error message
    // instead of the raw envelope. Falls back to raw text if not JSON.
    let body = null;
    try {
      body = await response.json();
    } catch {
      const text = typeof response.text === 'function' ? await response.text() : '';
      if (!response.ok) throw new Error(`Linear API ${response.status}: ${text}`);
    }
    if (body?.errors?.length) {
      const first = body.errors[0];
      const code = first.extensions?.code;
      if (code === 'FORBIDDEN' || code === 'AUTHENTICATION_ERROR') {
        throw new Error(`LINEAR_FORBIDDEN: ${first.message}`);
      }
      throw new Error(first.message || 'Linear GraphQL error');
    }
    if (!response.ok) {
      throw new Error(`Linear API ${response.status}`);
    }
    return body.data;
  }

  // ─── Linear state picker ────────────────────────────────────────────────

  function pickCompletedState(stateNodes) {
    if (!Array.isArray(stateNodes)) return null;
    const byName = stateNodes.find(
      (s) => s && s.type === 'completed' && s.name === 'Done'
    );
    if (byName) return byName.id;
    const byType = stateNodes.find((s) => s && s.type === 'completed');
    return byType ? byType.id : null;
  }

  // ─── Linear: find-or-create issue for HS conversation ──────────────────

  class OrphanIssueError extends Error {
    constructor(issueKey, cause) {
      super(`Orphan Linear issue created (attachment failed): ${issueKey}`);
      this.name = 'OrphanIssueError';
      this.issueKey = issueKey;
      this.cause = cause;
    }
  }

  async function linearFindOrCreateIssue({ ctx, config, fetchFn, retryDelayMs = 500 }) {
    const {
      canonicalHsUrl, subject, customer,
      hsConvIdLong, hsConvIdShort, emails, hsCustomerId,
    } = ctx;
    const {
      linearApiKey, linearDefaultTeamId, linearViewerId, linearInProgressStateId,
    } = config;

    if (!linearApiKey || !linearDefaultTeamId || !linearViewerId || !linearInProgressStateId) {
      throw new Error('LINEAR_CONFIG_MISSING');
    }

    // 1. Lookup existing issue via attachment URL
    const lookupQuery = `query($url: String!) {
      attachmentsForURL(url: $url) {
        nodes { issue { id identifier title } }
      }
    }`;
    const lookupData = await linearRequest({
      query: lookupQuery,
      variables: { url: canonicalHsUrl },
      apiKey: linearApiKey,
      fetchFn,
    });
    const existing = lookupData?.attachmentsForURL?.nodes?.[0]?.issue;
    if (existing) {
      return {
        issueKey: existing.identifier,
        issueTitle: existing.title,
        wasCreated: false,
      };
    }

    // 2. Create issue
    const titleSubject = subject || `HS #${hsConvIdShort}`;
    const title = `${titleSubject} [HS: #${hsConvIdShort}]`;
    const description = [
      `**Partner:** ${customer || '—'}`,
      '',
      `[Helpscout conversation](${canonicalHsUrl})`,
    ].join('\n');

    const issueMutation = `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title }
      }
    }`;
    const issueData = await linearRequest({
      query: issueMutation,
      variables: {
        input: {
          teamId: linearDefaultTeamId,
          title,
          description,
          stateId: linearInProgressStateId,
          assigneeId: linearViewerId,
        },
      },
      apiKey: linearApiKey,
      fetchFn,
    });
    const issue = issueData?.issueCreate?.issue;
    if (!issueData?.issueCreate?.success || !issue) {
      throw new Error('Linear issueCreate failed (no success)');
    }

    // 3. Create attachment (with 1 retry)
    const attachmentMutation = `mutation($input: AttachmentCreateInput!) {
      attachmentCreate(input: $input) {
        success
        attachment { id }
      }
    }`;
    const attachmentInput = {
      issueId: issue.id,
      url: canonicalHsUrl,
      title: `Helpscout #${hsConvIdShort}`,
      subtitle: customer || '',
      metadata: {
        source: 'linear-clockify-extension',
        hsConvIdLong,
        hsConvIdShort,
        hsCustomerId: hsCustomerId || null,
        hsCustomerEmails: emails || [],
        hsCustomerName: customer || '',
        createdAt: new Date().toISOString(),
      },
    };

    let attachmentErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const attData = await linearRequest({
          query: attachmentMutation,
          variables: { input: attachmentInput },
          apiKey: linearApiKey,
          fetchFn,
        });
        if (attData?.attachmentCreate?.success) {
          return {
            issueKey: issue.identifier,
            issueTitle: issue.title,
            wasCreated: true,
          };
        }
        attachmentErr = new Error('attachmentCreate returned no success');
      } catch (err) {
        attachmentErr = err;
      }
      if (attempt === 1 && retryDelayMs > 0) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }

    throw new OrphanIssueError(issue.identifier, attachmentErr);
  }

  function createConvLock() {
    const inFlight = new Map();
    return {
      async run(key, worker) {
        if (inFlight.has(key)) return inFlight.get(key);
        const promise = (async () => {
          try {
            return await worker();
          } finally {
            inFlight.delete(key);
          }
        })();
        inFlight.set(key, promise);
        return promise;
      },
    };
  }

  // ─── Overlap detection ────────────────────────────────────────────────────

  function floorToMinuteMs(ms) {
    return Math.floor(ms / 60000) * 60000;
  }

  function isOverlappingEntry(entry, newStartISO, newEndISO, nowMs, excludeId) {
    if (!entry?.timeInterval) return false;
    if (excludeId && entry.id === excludeId) return false;

    const eStart = floorToMinuteMs(new Date(entry.timeInterval.start).getTime());
    const eEnd = entry.timeInterval.end
      ? floorToMinuteMs(new Date(entry.timeInterval.end).getTime())
      : floorToMinuteMs(nowMs);
    const newStart = new Date(newStartISO).getTime();
    const newEnd = new Date(newEndISO).getTime();

    return eStart < newEnd && eEnd > newStart;
  }

  // ─── Status helpers ──────────────────────────────────────────────────────

  function setStatus(el, kind, text) {
    el.style.display = 'block';
    el.className = `lc-status lc-status-${kind}`;
    el.textContent = text;
  }

  function clearStatus(el) {
    el.style.display = 'none';
    el.textContent = '';
  }

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

  // ─── Snap chip UI ────────────────────────────────────────────────────────

  function formatSnapLabel(snapISO) {
    const d = new Date(snapISO);
    return `↶ ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function buildSnapChip() {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'lc-snap-chip';
    chip.style.display = 'none';
    chip.setAttribute('aria-pressed', 'true');

    let forcedHidden = false;

    function render({ snapTo, snapEnabled }) {
      if (forcedHidden) {
        chip.style.display = 'none';
        return;
      }
      if (!snapEnabled) {
        chip.style.display = 'inline-flex';
        chip.textContent = '↶ off';
        chip.classList.remove('lc-snap-chip-active');
        chip.classList.add('lc-snap-chip-off');
        chip.title = 'Kattintásra bekapcsolod a snap-et';
        chip.setAttribute('aria-pressed', 'false');
        return;
      }
      if (!snapTo) {
        chip.style.display = 'none';
        return;
      }
      chip.style.display = 'inline-flex';
      chip.textContent = formatSnapLabel(snapTo);
      chip.classList.add('lc-snap-chip-active');
      chip.classList.remove('lc-snap-chip-off');
      chip.title = 'Előző entry vége — kattintásra kikapcsolod';
      chip.setAttribute('aria-pressed', 'true');
    }

    async function refresh() {
      if (forcedHidden) {
        chip.style.display = 'none';
        return;
      }
      // Preserve previous visible state on error / undefined response.
      // Transient service-worker restarts can make chrome.runtime.sendMessage
      // resolve with undefined, and the !snapTo branch used to hide an
      // already-rendered chip without clearing its text/classes — leaving
      // stale active markup with display:none. Only re-render on valid input.
      try {
        const info = await chrome.runtime.sendMessage({ action: 'getSnapInfo' });
        if (info && typeof info === 'object') render(info);
      } catch {
        // keep last known good state
      }
    }

    function setForcedHidden(b) {
      const next = !!b;
      if (next === forcedHidden) return;
      forcedHidden = next;
      if (forcedHidden) {
        chip.style.display = 'none';
      } else {
        refresh();
      }
    }

    chip.addEventListener('click', async () => {
      const isOff = chip.classList.contains('lc-snap-chip-off');
      const next = isOff; // if currently off, next is true (enable); if currently active, next is false
      await chrome.runtime.sendMessage({ action: 'setSnapEnabled', data: { enabled: next } });
      await refresh();
    });

    return { chip, refresh, render, setForcedHidden };
  }

  // ─── Start-time editor ───────────────────────────────────────────────────

  /**
   * Create an inline editor for changing a running timer's start time.
   * Initially hidden; call `show(currentStartISO)` to reveal pre-filled with HH:MM.
   *
   * @returns {{ container: HTMLElement, show: (iso: string) => void, hide: () => void }}
   */
  function buildStartEditor() {
    const container = document.createElement('div');
    container.className = 'lc-start-editor';
    container.style.display = 'none';

    const label = document.createElement('span');
    label.className = 'lc-start-editor-label';
    label.textContent = 'Új kezdés:';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'lc-time-input lc-start-editor-input';
    input.placeholder = 'HH:MM';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.maxLength = 5;

    const snapBtn = document.createElement('button');
    snapBtn.type = 'button';
    snapBtn.className = 'lc-snap-chip lc-snap-chip-active lc-start-editor-snap';
    snapBtn.style.display = 'none';
    snapBtn.title = 'Kattintásra az előző entry végére állítja a kezdést';

    const status = document.createElement('span');
    status.className = 'lc-start-editor-status';

    container.appendChild(label);
    container.appendChild(input);
    container.appendChild(snapBtn);
    container.appendChild(status);

    let currentStartISO = null;

    function setStatus(kind, text) {
      status.className = `lc-start-editor-status lc-start-editor-status-${kind}`;
      status.textContent = text || '';
    }

    async function populateSnapButton() {
      snapBtn.style.display = 'none';
      snapBtn.dataset.snapIso = '';
      try {
        const info = await chrome.runtime.sendMessage({ action: 'getSnapInfo' });
        if (info?.snapEnabled && info.snapTo) {
          const sd = new Date(info.snapTo);
          const hh = String(sd.getHours()).padStart(2, '0');
          const mm = String(sd.getMinutes()).padStart(2, '0');
          snapBtn.textContent = `↶ ${hh}:${mm}`;
          snapBtn.dataset.snapIso = info.snapTo;
          snapBtn.style.display = 'inline-flex';
        }
      } catch {
        // keep hidden on error
      }
    }

    function show(iso) {
      currentStartISO = iso;
      const d = new Date(iso);
      input.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      setStatus('', '');
      container.style.display = 'flex';
      populateSnapButton();
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    }

    function hide() {
      container.style.display = 'none';
      setStatus('', '');
    }

    async function save() {
      const parsed = parseTimeInput(input.value);
      if (!parsed) {
        setStatus('error', 'Érvénytelen idő');
        return;
      }
      input.value = formatHM(parsed);

      // Build ISO using the date of currentStartISO (so we keep the same day)
      const baseDate = new Date(currentStartISO);
      const y = baseDate.getFullYear();
      const mo = baseDate.getMonth();
      const d = baseDate.getDate();
      const newStartISO = new Date(y, mo, d, parsed.h, parsed.m, 0, 0).toISOString();

      setStatus('info', 'Mentés…');
      try {
        const result = await chrome.runtime.sendMessage({
          action: 'updateTimerStart',
          data: { newStartISO },
        });
        if (result?.error === 'OVERLAP') {
          setStatus('error', `Átfedés: ${result.conflictWith}`);
          return;
        }
        if (result?.error) {
          setStatus('error', result.error);
          return;
        }
        setStatus('success', '✓');
        setTimeout(() => hide(), 600);
      } catch (err) {
        setStatus('error', err.message);
      }
    }

    snapBtn.addEventListener('click', () => {
      const iso = snapBtn.dataset.snapIso;
      if (!iso) return;
      const sd = new Date(iso);
      input.value = `${String(sd.getHours()).padStart(2, '0')}:${String(sd.getMinutes()).padStart(2, '0')}`;
      save();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hide();
      }
    });

    input.addEventListener('blur', () => {
      if (!input.value) return;
      const parsed = parseTimeInput(input.value);
      if (parsed) input.value = formatHM(parsed);
    });

    return { container, show, hide };
  }

  // ─── Manual entry form builder ───────────────────────────────────────────

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
      dateChip.textContent = dateInput.value === today ? '📅 Ma' : `📅 ${dateInput.value}`;
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

  /**
   * Attach a submit handler that parses the form, calls `buildPayload` to get a
   * chrome.runtime.sendMessage body, and shows status.
   *
   * @param {HTMLFormElement} form
   * @param {object} fields - from buildManualEntryForm
   * @param {(ctx: {startISO: string, endISO: string, dayStart: string, dayEnd: string}) =>
   *         Promise<{action: string, data: object}> | {action: string, data: object}} buildPayload
   */
  function attachManualEntrySubmit(form, fields, buildPayload) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
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
        const payload = await buildPayload({ startISO, endISO, dayStart, dayEnd });
        const result = await chrome.runtime.sendMessage(payload);

        if (result?.error === 'OVERLAP') {
          setStatus(status, 'error', `Átfedés: ${result.conflictWith}`);
        } else if (result?.error === 'NO_API_KEY') {
          setStatus(status, 'error', 'Beállítás szükséges (Clockify)');
        } else if (result?.error === 'LINEAR_CONFIG_MISSING') {
          setStatus(status, 'error', 'Beállítás szükséges (Linear)');
        } else if (result?.error === 'ORPHAN_LINEAR_ISSUE') {
          setStatus(status, 'error', `Árva Linear issue: ${result.issueKey}. Ellenőrizd Linear-ben.`);
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

  const api = {
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
    parseHsUrl,
    canonicalizeHsUrl,
    parseHsEmailsFromDom,
    parseHsCustomerIdFromDom,
    parseHsTitle,
    buildHsDescription,
    linearRequest,
    linearFindOrCreateIssue,
    OrphanIssueError,
    parseTeamKeyFromIssueKey,
    pickCompletedState,
    createConvLock,
    detectTimerSource,
    computeSnapTime,
    buildSnapChip,
    isOverlappingEntry,
    buildStartEditor,
  };

  global.LCShared = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
