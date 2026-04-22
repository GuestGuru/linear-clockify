// Linear → Clockify Timer — Content Script
//
// The UI lives entirely in the extension popup. This content script only
// exists to resolve the current page's issue context (key + team + title)
// when the popup asks for it via chrome.tabs.sendMessage.

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

  const result = await chrome.runtime.sendMessage({
    action: 'getIssueDetails',
    data: { teamKey: issue.teamKey, issueNumber: issue.issueNumber },
  });

  if (result?.details?.title) return result.details.title;
  return getFallbackTitle();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'getPageContext') return false;
  (async () => {
    const issue = parseIssueFromUrl();
    if (!issue) {
      sendResponse({ source: null });
      return;
    }
    const issueTitle = await getIssueTitle();
    sendResponse({
      source: 'linear',
      issueKey: issue.issueKey,
      teamKey: issue.teamKey,
      issueTitle,
    });
  })();
  return true;
});
