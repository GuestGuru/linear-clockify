// HelpScout → Clockify Timer — Content Script
//
// The UI lives entirely in the extension popup. This content script only
// exists to resolve the current conversation's context when the popup asks
// for it. Emails and customer ID must be read from the DOM, which is why a
// content script is still needed at all (the popup can only see URL + title).

const {
  parseHsUrl, parseHsTitle,
  canonicalizeHsUrl, parseHsEmailsFromDom, parseHsCustomerIdFromDom,
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
    canonicalHsUrl: canonicalizeHsUrl(window.location.href) || window.location.href,
    emails: parseHsEmailsFromDom(document),
    hsCustomerId: parseHsCustomerIdFromDom(document),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'getPageContext') return false;
  const ctx = getConversationContext();
  if (!ctx) {
    sendResponse({ source: null });
    return false;
  }
  sendResponse({ source: 'hs', ...ctx });
  return false;
});
