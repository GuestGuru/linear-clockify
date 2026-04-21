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

  function buildHsDescription({ ticketNumber, subject, customer }) {
    const prefix = `[HS: #${ticketNumber}]`;
    const tail = [subject, customer].filter((s) => s && String(s).trim()).join(' - ');
    return tail ? `${prefix} ${tail}` : prefix;
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
    parseHsTitle,
    buildHsDescription,
    detectTimerSource,
  };

  global.LCShared = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
