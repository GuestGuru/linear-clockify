// HelpScout → Clockify Timer — Content Script

const {
  parseTimeInput, formatHM, todayStr, localTimeToISO, dayBoundsISO,
  setStatus, clearStatus, createSettingsLink,
  buildManualEntryForm, attachManualEntrySubmit,
  buildSnapChip, buildStartEditor,
  parseHsUrl, parseHsTitle,
} = window.LCShared;

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

console.log('[LC HS] loaded', getConversationContext());
