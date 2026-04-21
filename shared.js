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

  const api = {
    parseTimeInput,
    formatHM,
    todayStr,
    localTimeToISO,
    dayBoundsISO,
  };

  global.LCShared = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
