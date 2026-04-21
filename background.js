// Linear → Clockify Timer — Service Worker
importScripts('shared.js');

const { detectTimerSource, computeSnapTime, buildHsDescription } = self.LCShared;

const CLOCKIFY_BASE = 'https://api.clockify.me/api/v1';
const LINEAR_BASE = 'https://api.linear.app/graphql';
const DEFAULT_WORKSPACE_ID = '5ef305cdb6b6d1294b8a04c0';

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || {
    apiKey: '',
    workspaceId: DEFAULT_WORKSPACE_ID,
    autoStop: false,
    teamMapping: {
      GG: 'Cég működése',
      MAN: 'Management',
      SAL: 'Sales',
      IT: 'IT',
      FIN: 'Pénzügy',
      HR: 'HR',
      KOM: 'Kommunikáció és Vendégek',
      LBE: 'Lakásindítás',
      TUL: 'Lakások és Tulajok',
      LM: 'Lakásmenedzserek',
    },
  };
}

async function clockifyFetch(path, options = {}) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('NO_API_KEY');
  }
  const url = `${CLOCKIFY_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'X-Api-Key': settings.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Clockify API ${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function getUserId() {
  const { userId } = await chrome.storage.local.get('userId');
  if (userId) return userId;
  const user = await clockifyFetch('/user');
  await chrome.storage.local.set({ userId: user.id });
  return user.id;
}

async function resolveProjectId(projectName) {
  const { projectCache } = await chrome.storage.local.get('projectCache');
  const cache = projectCache || {};
  if (cache[projectName]) return cache[projectName];

  const settings = await getSettings();
  const projects = await clockifyFetch(
    `/workspaces/${settings.workspaceId}/projects?name=${encodeURIComponent(projectName)}`
  );
  const match = projects.find((p) => p.name === projectName);
  if (!match) return null;

  cache[projectName] = match.id;
  await chrome.storage.local.set({ projectCache: cache });
  return match.id;
}

async function getIssueDetails(teamKey, issueNumber) {
  const settings = await getSettings();
  if (!settings.linearApiKey) return null;

  const query = `query($teamKey: String!, $number: Float!) {
    issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }, first: 1) {
      nodes {
        title
        project { name }
        parent { title }
      }
    }
  }`;

  const response = await fetch(LINEAR_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': settings.linearApiKey,
    },
    body: JSON.stringify({ query, variables: { teamKey, number: Number(issueNumber) } }),
  });

  if (!response.ok) {
    console.warn('[LC] Linear API error:', response.status);
    return null;
  }

  const json = await response.json();
  const issue = json.data?.issues?.nodes?.[0];
  if (!issue) return null;

  const parts = [];
  if (issue.project?.name) parts.push(issue.project.name);
  if (issue.parent?.title) parts.push(issue.parent.title);
  parts.push(issue.title);

  return { title: parts.join(' > ') };
}

async function getEntriesInRange(dayStartISO, dayEndISO) {
  const settings = await getSettings();
  const userId = await getUserId();
  const entries = await clockifyFetch(
    `/workspaces/${settings.workspaceId}/user/${userId}/time-entries` +
      `?start=${encodeURIComponent(dayStartISO)}&end=${encodeURIComponent(dayEndISO)}&page-size=200`
  );
  return entries || [];
}

async function findOverlap(startISO, endISO, dayStartISO, dayEndISO) {
  const entries = await getEntriesInRange(dayStartISO, dayEndISO);
  const newStart = new Date(startISO).getTime();
  const newEnd = new Date(endISO).getTime();
  const now = Date.now();

  for (const e of entries) {
    const eStart = new Date(e.timeInterval.start).getTime();
    const eEnd = e.timeInterval.end ? new Date(e.timeInterval.end).getTime() : now;
    if (eStart < newEnd && eEnd > newStart) {
      return e;
    }
  }
  return null;
}

function formatHM(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function createManualEntry(issueKey, issueTitle, teamKey, startISO, endISO, dayStartISO, dayEndISO) {
  const settings = await getSettings();

  const conflict = await findOverlap(startISO, endISO, dayStartISO, dayEndISO);
  if (conflict) {
    const cs = new Date(conflict.timeInterval.start);
    const ce = conflict.timeInterval.end ? new Date(conflict.timeInterval.end) : null;
    const timeStr = ce ? `${formatHM(cs)}–${formatHM(ce)}` : `${formatHM(cs)}–(fut)`;
    const desc = conflict.description || '(leírás nélkül)';
    return { error: 'OVERLAP', conflictWith: `${desc} @ ${timeStr}` };
  }

  const projectName = teamKey ? settings.teamMapping[teamKey] : null;
  let projectId = null;
  let warning = null;

  if (projectName) {
    projectId = await resolveProjectId(projectName);
    if (!projectId) {
      warning = `Clockify projekt nem található: ${projectName}`;
    }
  } else if (teamKey) {
    warning = `Ismeretlen team: ${teamKey}`;
  }

  const body = {
    start: startISO,
    end: endISO,
    description: `[${issueKey}] ${issueTitle}`,
  };
  if (projectId) {
    body.projectId = projectId;
  }

  await clockifyFetch(
    `/workspaces/${settings.workspaceId}/time-entries`,
    { method: 'POST', body: JSON.stringify(body) }
  );

  return { success: true, warning };
}

async function startTimer(issueKey, issueTitle, teamKey) {
  const settings = await getSettings();
  const projectName = settings.teamMapping[teamKey];
  let projectId = null;
  let warning = null;

  if (projectName) {
    projectId = await resolveProjectId(projectName);
    if (!projectId) {
      warning = `Clockify projekt nem található: ${projectName}`;
    }
  } else {
    warning = `Ismeretlen team: ${teamKey}`;
  }

  const body = {
    start: new Date().toISOString(),
    description: `[${issueKey}] ${issueTitle}`,
  };
  if (projectId) {
    body.projectId = projectId;
  }

  const entry = await clockifyFetch(
    `/workspaces/${settings.workspaceId}/time-entries`,
    { method: 'POST', body: JSON.stringify(body) }
  );

  const activeTimer = {
    timeEntryId: entry.id,
    source: 'linear',
    issueKey,
    teamKey,
    issueTitle,
    projectName: projectName || null,
    startedAt: body.start,
  };
  await chrome.storage.local.set({ activeTimer });
  updateBadge(activeTimer);

  return { success: true, warning };
}

async function stopTimer() {
  // Always clear local state, even if the API call fails
  await chrome.storage.local.remove('activeTimer');
  clearBadge();

  try {
    const settings = await getSettings();
    const userId = await getUserId();
    await clockifyFetch(
      `/workspaces/${settings.workspaceId}/user/${userId}/time-entries`,
      { method: 'PATCH', body: JSON.stringify({ end: new Date().toISOString() }) }
    );
  } catch (err) {
    // Timer may have been stopped externally — that's fine
    console.warn('[LC] stopTimer API error (state already cleared):', err.message);
  }

  return { success: true };
}

async function checkRunningTimer() {
  const settings = await getSettings();
  if (!settings.apiKey) return;

  const userId = await getUserId();
  const entries = await clockifyFetch(
    `/workspaces/${settings.workspaceId}/user/${userId}/time-entries?in-progress=true`
  );

  if (!entries || entries.length === 0) {
    await chrome.storage.local.remove('activeTimer');
    clearBadge();
    return;
  }

  const entry = entries[0];
  const { activeTimer } = await chrome.storage.local.get('activeTimer');

  if (activeTimer && activeTimer.timeEntryId === entry.id) {
    updateBadge(activeTimer);
    return;
  }

  const detected = detectTimerSource(entry.description);
  const base = {
    timeEntryId: entry.id,
    startedAt: entry.timeInterval.start,
    projectName: null,
    external: true,
  };

  let externalTimer;
  if (detected?.source === 'linear') {
    externalTimer = {
      ...base,
      source: 'linear',
      issueKey: detected.issueKey,
      teamKey: detected.teamKey,
      issueTitle: detected.issueTitle,
    };
  } else if (detected?.source === 'hs') {
    externalTimer = {
      ...base,
      source: 'hs',
      ticketNumber: detected.ticketNumber,
      issueTitle: detected.issueTitle,
    };
  } else {
    externalTimer = {
      ...base,
      source: 'unknown',
      issueTitle: entry.description || 'Külső timer',
    };
  }

  await chrome.storage.local.set({ activeTimer: externalTimer });
  updateBadge(externalTimer);
}

function updateBadge(activeTimer) {
  if (!activeTimer) {
    clearBadge();
    return;
  }
  const elapsed = Date.now() - new Date(activeTimer.startedAt).getTime();
  const hours = Math.floor(elapsed / 3600000);
  const minutes = Math.floor((elapsed % 3600000) / 60000);
  const text = hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : `${minutes}m`;

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: '' });
}

chrome.alarms.create('badge-refresh', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'badge-refresh') {
    chrome.storage.local.get('activeTimer', ({ activeTimer }) => {
      updateBadge(activeTimer);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let retried = false;

  const handler = async () => {
    try {
      switch (message.action) {
        case 'startTimer': {
          const { issueKey, issueTitle, teamKey } = message.data;
          return await startTimer(issueKey, issueTitle, teamKey);
        }
        case 'stopTimer': {
          return await stopTimer();
        }
        case 'stopAndStartTimer': {
          await stopTimer();
          const { issueKey, issueTitle, teamKey } = message.data;
          return await startTimer(issueKey, issueTitle, teamKey);
        }
        case 'createManualEntry': {
          const { issueKey, issueTitle, teamKey, start, end, dayStart, dayEnd } = message.data;
          return await createManualEntry(issueKey, issueTitle, teamKey, start, end, dayStart, dayEnd);
        }
        case 'getIssueDetails': {
          const { teamKey, issueNumber } = message.data;
          const details = await getIssueDetails(teamKey, issueNumber);
          return { details };
        }
        case 'getStatus': {
          const { activeTimer } = await chrome.storage.local.get('activeTimer');
          return { activeTimer: activeTimer || null };
        }
        case 'openOptions': {
          chrome.runtime.openOptionsPage();
          return { success: true };
        }
        default:
          return { error: `Unknown action: ${message.action}` };
      }
    } catch (err) {
      if (err.message === 'NO_API_KEY') {
        return { error: 'NO_API_KEY' };
      }
      if (err.message.includes('Failed to fetch') && !retried) {
        retried = true;
        return handler();
      }
      return { error: err.message };
    }
  };

  handler().then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener(() => checkRunningTimer().catch(console.error));
chrome.runtime.onStartup.addListener(() => checkRunningTimer().catch(console.error));

// Auto-stop timer when Linear tab is closed (if enabled in settings)
chrome.tabs.onRemoved.addListener(async () => {
  const settings = await getSettings();
  if (!settings.autoStop) return;

  const { activeTimer } = await chrome.storage.local.get('activeTimer');
  if (!activeTimer || activeTimer.external) return;

  // Check if any remaining Linear tabs are open
  const tabs = await chrome.tabs.query({ url: 'https://linear.app/gghq/*' });
  if (tabs.length === 0) {
    await stopTimer();
  }
});
