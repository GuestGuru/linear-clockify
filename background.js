// Linear → Clockify Timer — Service Worker

const CLOCKIFY_BASE = 'https://api.clockify.me/api/v1';

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || {
    apiKey: '',
    workspaceId: '5ef305cdb6b6d1294b8a04c0',
    autoStop: false,
    teamMapping: {
      GG: 'Cég működése',
      MAN: 'Management',
      SAL: 'Sales',
      IT: 'IT',
      FIN: 'Pénzügy',
      HR: 'HR',
      KOM: 'Kommunikáció és Vendégek',
      LBE: 'Lakásbekerülés',
      TUL: 'Lakások és Tulajok',
      LM: 'LM Support',
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

async function startTimer(issueKey, issueTitle, teamKey) {
  const settings = await getSettings();
  const projectName = settings.teamMapping[teamKey];
  let projectId = null;
  let warning = null;

  if (projectName) {
    projectId = await resolveProjectId(projectName);
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
    issueKey,
    issueTitle,
    projectName: projectName || null,
    startedAt: body.start,
  };
  await chrome.storage.local.set({ activeTimer });
  updateBadge(activeTimer);

  return { success: true, warning };
}

async function stopTimer() {
  const settings = await getSettings();
  const userId = await getUserId();

  await clockifyFetch(
    `/workspaces/${settings.workspaceId}/user/${userId}/time-entries`,
    { method: 'PATCH', body: JSON.stringify({ end: new Date().toISOString() }) }
  );

  await chrome.storage.local.remove('activeTimer');
  clearBadge();

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

  const match = entry.description?.match(/^\[([A-Z]+-\d+)\]\s*(.+)$/);
  if (match) {
    const externalTimer = {
      timeEntryId: entry.id,
      issueKey: match[1],
      issueTitle: match[2],
      projectName: null,
      startedAt: entry.timeInterval.start,
      external: true,
    };
    await chrome.storage.local.set({ activeTimer: externalTimer });
    updateBadge(externalTimer);
  } else {
    const externalTimer = {
      timeEntryId: entry.id,
      issueKey: null,
      issueTitle: entry.description || 'Külső timer',
      projectName: null,
      startedAt: entry.timeInterval.start,
      external: true,
    };
    await chrome.storage.local.set({ activeTimer: externalTimer });
    updateBadge(externalTimer);
  }
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
      if (err.message.includes('Failed to fetch') && !message._retried) {
        message._retried = true;
        return handler();
      }
      return { error: err.message };
    }
  };

  handler().then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener(() => checkRunningTimer());
chrome.runtime.onStartup.addListener(() => checkRunningTimer());
