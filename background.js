// Linear → Clockify Timer — Service Worker
importScripts('shared.js');

const { detectTimerSource, computeSnapTime, buildHsDescription, isOverlappingEntry,
        linearRequest, linearFindOrCreateIssue, OrphanIssueError, createConvLock,
        parseTeamKeyFromIssueKey, pickCompletedState } = self.LCShared;

const convLock = createConvLock();

const CLOCKIFY_BASE = 'https://api.clockify.me/api/v1';
const DEFAULT_WORKSPACE_ID = '5ef305cdb6b6d1294b8a04c0';
const HS_PROJECT_DEFAULT = 'Lakások és Tulajok';

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const defaults = {
    apiKey: '',
    linearApiKey: '',
    linearDefaultTeamId: '',
    linearViewerId: '',
    linearInProgressStateId: '',
    workspaceId: DEFAULT_WORKSPACE_ID,
    autoStop: false,
    snapEnabled: true,
    hsProjectName: HS_PROJECT_DEFAULT,
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
  return { ...defaults, ...(settings || {}) };
}

function getLinearConfig(settings) {
  return {
    linearApiKey: settings.linearApiKey || '',
    linearDefaultTeamId: settings.linearDefaultTeamId || '',
    linearViewerId: settings.linearViewerId || '',
    linearInProgressStateId: settings.linearInProgressStateId || '',
  };
}

function isLinearConfigComplete(config) {
  return !!(config.linearApiKey && config.linearDefaultTeamId &&
            config.linearViewerId && config.linearInProgressStateId);
}

async function resolveHsLinearIssue(ctx) {
  const settings = await getSettings();
  const linearConfig = getLinearConfig(settings);
  if (!isLinearConfigComplete(linearConfig)) {
    return { error: 'LINEAR_CONFIG_MISSING' };
  }
  const lockKey = `hsconv:${ctx.convId}`;
  try {
    const result = await convLock.run(lockKey, () => linearFindOrCreateIssue({
      ctx: {
        canonicalHsUrl: ctx.canonicalHsUrl,
        subject: ctx.subject,
        customer: ctx.customer,
        ticketNumber: ctx.ticketNumber,
        hsConvIdLong: ctx.convId,
        hsConvIdShort: ctx.ticketNumber,
        emails: ctx.emails || [],
        hsCustomerId: ctx.hsCustomerId || null,
      },
      config: linearConfig,
      fetchFn: fetch,
    }));
    return { ok: result };
  } catch (err) {
    if (err instanceof OrphanIssueError) {
      return { error: 'ORPHAN_LINEAR_ISSUE', issueKey: err.issueKey };
    }
    return { error: `Linear: ${err.message}` };
  }
}

async function clockifyFetch(path, options = {}) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('NO_API_KEY');
  }
  const url = `${CLOCKIFY_BASE}${path}`;
  const method = options.method || 'GET';
  console.log('[LC BG] clockify →', method, path);
  const response = await fetch(url, {
    ...options,
    headers: {
      'X-Api-Key': settings.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  console.log('[LC BG] clockify ←', method, path, response.status);
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

  console.log('[LC BG] linear → issue', teamKey, issueNumber);
  try {
    const data = await linearRequest({
      query,
      variables: { teamKey, number: Number(issueNumber) },
      apiKey: settings.linearApiKey,
      fetchFn: fetch,
    });
    const issue = data?.issues?.nodes?.[0];
    if (!issue) return null;
    const parts = [];
    if (issue.project?.name) parts.push(issue.project.name);
    if (issue.parent?.title) parts.push(issue.parent.title);
    parts.push(issue.title);
    return { title: parts.join(' > ') };
  } catch (err) {
    console.warn('[LC BG] Linear API error:', err.message);
    return null;
  }
}

function pickInProgressState(stateNodes) {
  if (!Array.isArray(stateNodes)) return null;
  const byName = stateNodes.find((s) => s.name === 'In Progress');
  if (byName) return byName.id;
  const byType = stateNodes.find((s) => s.type === 'started');
  return byType ? byType.id : null;
}

async function resolveLinearDoneStateId(teamKey) {
  if (!teamKey) return null;
  const settings = await getSettings();
  if (!settings.linearApiKey) return null;

  const stored = await chrome.storage.local.get('linearDoneStateByTeam');
  const cache = stored.linearDoneStateByTeam || {};
  if (cache[teamKey]) return cache[teamKey];

  const query = `query($teamKey: String!) {
    teams(filter: { key: { eq: $teamKey } }, first: 1) {
      nodes { id states { nodes { id name type } } }
    }
  }`;

  console.log('[LC BG] linear → done state', teamKey);
  const data = await linearRequest({
    query,
    variables: { teamKey },
    apiKey: settings.linearApiKey,
    fetchFn: fetch,
  });
  const team = data?.teams?.nodes?.[0];
  if (!team) return null;
  const stateId = pickCompletedState(team.states?.nodes || []);
  if (!stateId) return null;

  cache[teamKey] = stateId;
  await chrome.storage.local.set({ linearDoneStateByTeam: cache });
  return stateId;
}

async function markLinearIssueDone(issueKey) {
  if (!issueKey) return { error: 'NO_ISSUE_KEY' };
  const teamKey = parseTeamKeyFromIssueKey(issueKey);
  if (!teamKey) return { error: `Érvénytelen issue key: ${issueKey}` };

  const settings = await getSettings();
  const linearConfig = getLinearConfig(settings);
  if (!isLinearConfigComplete(linearConfig)) {
    return { error: 'LINEAR_CONFIG_MISSING' };
  }

  const match = issueKey.match(/^([A-Za-z]+)-(\d+)$/);
  if (!match) return { error: `Érvénytelen issue key: ${issueKey}` };
  const issueNumber = Number(match[2]);

  let stateId;
  try {
    stateId = await resolveLinearDoneStateId(teamKey);
  } catch (err) {
    return { error: `Linear Done state lookup: ${err.message}` };
  }
  if (!stateId) {
    return { error: `Linear 'Done' state nem található a(z) ${teamKey} team-hez` };
  }

  const lookupQuery = `query($teamKey: String!, $number: Float!) {
    issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }, first: 1) {
      nodes { id }
    }
  }`;
  let issueId;
  try {
    const lookupData = await linearRequest({
      query: lookupQuery,
      variables: { teamKey, number: issueNumber },
      apiKey: settings.linearApiKey,
      fetchFn: fetch,
    });
    issueId = lookupData?.issues?.nodes?.[0]?.id;
  } catch (err) {
    return { error: `Linear issue lookup: ${err.message}` };
  }
  if (!issueId) return { error: `Linear issue nem található: ${issueKey}` };

  const mutation = `mutation($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) { success }
  }`;
  try {
    const updateData = await linearRequest({
      query: mutation,
      variables: { id: issueId, input: { stateId } },
      apiKey: settings.linearApiKey,
      fetchFn: fetch,
    });
    if (!updateData?.issueUpdate?.success) {
      return { error: 'Linear issueUpdate nem járt sikerrel' };
    }
    return { success: true };
  } catch (err) {
    return { error: `Linear issueUpdate: ${err.message}` };
  }
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

async function findOverlap(startISO, endISO, dayStartISO, dayEndISO, excludeId = null) {
  const entries = await getEntriesInRange(dayStartISO, dayEndISO);
  const now = Date.now();

  for (const e of entries) {
    if (isOverlappingEntry(e, startISO, endISO, now, excludeId)) {
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

async function createHsManualEntry(ctx) {
  const { ticketNumber, subject, customer, startISO, endISO, dayStartISO, dayEndISO } = ctx;
  const settings = await getSettings();

  const linear = await resolveHsLinearIssue(ctx);
  if (linear.error) return linear;
  const { issueKey } = linear.ok;

  const conflict = await findOverlap(startISO, endISO, dayStartISO, dayEndISO);
  if (conflict) {
    const cs = new Date(conflict.timeInterval.start);
    const ce = conflict.timeInterval.end ? new Date(conflict.timeInterval.end) : null;
    const timeStr = ce ? `${formatHM(cs)}–${formatHM(ce)}` : `${formatHM(cs)}–(fut)`;
    const desc = conflict.description || '(leírás nélkül)';
    return { error: 'OVERLAP', conflictWith: `${desc} @ ${timeStr}` };
  }

  const projectName = settings.hsProjectName || HS_PROJECT_DEFAULT;
  let projectId = null;
  let warning = null;
  if (projectName) {
    projectId = await resolveProjectId(projectName);
    if (!projectId) warning = `Clockify projekt nem található: ${projectName}`;
  }

  const body = {
    start: startISO,
    end: endISO,
    description: buildHsDescription({ issueKey, ticketNumber, subject, customer }),
  };
  if (projectId) body.projectId = projectId;

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
    start: await resolveStartTime(),
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

async function startHsTimer(ctx) {
  const { ticketNumber, subject, customer } = ctx;
  const settings = await getSettings();

  const linear = await resolveHsLinearIssue(ctx);
  if (linear.error) return linear;
  const { issueKey } = linear.ok;

  const projectName = settings.hsProjectName || HS_PROJECT_DEFAULT;
  let projectId = null;
  let warning = null;
  if (projectName) {
    projectId = await resolveProjectId(projectName);
    if (!projectId) warning = `Clockify projekt nem található: ${projectName}`;
  }

  const body = {
    start: await resolveStartTime(),
    description: buildHsDescription({ issueKey, ticketNumber, subject, customer }),
  };
  if (projectId) body.projectId = projectId;

  const entry = await clockifyFetch(
    `/workspaces/${settings.workspaceId}/time-entries`,
    { method: 'POST', body: JSON.stringify(body) }
  );

  const issueTitle = [subject, customer].filter(Boolean).join(' - ') || `#${ticketNumber}`;
  const activeTimer = {
    timeEntryId: entry.id,
    source: 'hs',
    ticketNumber,
    issueKey,
    issueTitle,
    projectName,
    startedAt: body.start,
  };
  await chrome.storage.local.set({ activeTimer });
  updateBadge(activeTimer);

  return { success: true, warning };
}

async function updateTimerStart(newStartISO) {
  const settings = await getSettings();
  const { activeTimer } = await chrome.storage.local.get('activeTimer');

  if (!activeTimer?.timeEntryId) {
    return { error: 'Nincs futó timer' };
  }
  if (activeTimer.external) {
    return { error: 'Külső timer — nem szerkeszthető' };
  }

  const newStartMs = new Date(newStartISO).getTime();
  if (!Number.isFinite(newStartMs)) {
    return { error: 'Érvénytelen időpont' };
  }
  if (newStartMs > Date.now()) {
    return { error: 'A kezdés nem lehet a jövőben' };
  }

  // Overlap check — exclude the timer being edited. Use a day-wide window
  // that covers the new start (in case user rolls back across midnight).
  const dayStr = new Date(newStartMs).toISOString().slice(0, 10); // YYYY-MM-DD (UTC day)
  const [y, mo, d] = dayStr.split('-').map(Number);
  const dayStart = new Date(Date.UTC(y, mo - 1, d - 1)).toISOString();
  const dayEnd = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString();
  // newEnd for the overlap check = now (running timer extends to present)
  const nowISO = new Date().toISOString();

  const conflict = await findOverlap(newStartISO, nowISO, dayStart, dayEnd, activeTimer.timeEntryId);
  if (conflict) {
    const cs = new Date(conflict.timeInterval.start);
    const ce = conflict.timeInterval.end ? new Date(conflict.timeInterval.end) : null;
    const timeStr = ce ? `${formatHM(cs)}–${formatHM(ce)}` : `${formatHM(cs)}–(fut)`;
    const desc = conflict.description || '(leírás nélkül)';
    return { error: 'OVERLAP', conflictWith: `${desc} @ ${timeStr}` };
  }

  // PATCH the entry — Clockify requires the full time entry body for PUT,
  // but PATCH on /time-entries/{id} supports partial updates on the start/end.
  // Using PUT with the full entry is safer: fetch current entry, modify start, PUT back.
  const current = await clockifyFetch(
    `/workspaces/${settings.workspaceId}/time-entries/${activeTimer.timeEntryId}`
  );

  const putBody = {
    start: newStartISO,
    billable: current.billable,
    description: current.description,
    projectId: current.projectId || undefined,
    taskId: current.taskId || undefined,
    tagIds: current.tagIds || undefined,
    // end is omitted — Clockify keeps it null (running) if omitted on a running entry
  };
  if (current.timeInterval?.end) {
    putBody.end = current.timeInterval.end;
  }

  await clockifyFetch(
    `/workspaces/${settings.workspaceId}/time-entries/${activeTimer.timeEntryId}`,
    { method: 'PUT', body: JSON.stringify(putBody) }
  );

  // Update local storage
  const updated = { ...activeTimer, startedAt: newStartISO };
  await chrome.storage.local.set({ activeTimer: updated });
  updateBadge(updated);

  return { success: true };
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

// In-flight dedupe: concurrent callers (header chip + card chip, possibly
// across tabs) share a single Clockify fetch instead of fanning out.
let snapInfoInFlight = null;

async function getSnapInfo() {
  if (snapInfoInFlight) return snapInfoInFlight;
  snapInfoInFlight = (async () => {
    const settings = await getSettings();
    const snapEnabled = settings.snapEnabled !== false; // default true
    if (!snapEnabled) return { snapTo: null, snapEnabled: false };

    try {
      const now = Date.now();
      const userId = await getUserId();
      // Clockify's start/end range filter misbehaves on narrow ranges — fetch
      // the latest 5 entries unfiltered and let computeSnapTime pick the
      // latest end.
      const entries = await clockifyFetch(
        `/workspaces/${settings.workspaceId}/user/${userId}/time-entries?page-size=5`
      );
      const snapTo = computeSnapTime(entries || [], now);
      return { snapTo, snapEnabled: true };
    } catch (err) {
      console.warn('[LC] getSnapInfo failed:', err.message);
      return { snapTo: null, snapEnabled: true };
    }
  })();
  try {
    return await snapInfoInFlight;
  } finally {
    snapInfoInFlight = null;
  }
}

async function resolveStartTime() {
  const info = await getSnapInfo();
  return info.snapTo || new Date().toISOString();
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

  console.log('[LC BG] →', message.action, message.data ? Object.keys(message.data) : '');

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
        case 'updateTimerStart': {
          return await updateTimerStart(message.data.newStartISO);
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
        case 'startHsTimer': {
          return await startHsTimer(message.data);
        }
        case 'stopAndStartHsTimer': {
          await stopTimer();
          return await startHsTimer(message.data);
        }
        case 'createHsManualEntry': {
          return await createHsManualEntry(message.data);
        }
        case 'getIssueDetails': {
          const { teamKey, issueNumber } = message.data;
          const details = await getIssueDetails(teamKey, issueNumber);
          return { details };
        }
        case 'getSnapInfo': {
          return await getSnapInfo();
        }
        case 'getStatus': {
          const { activeTimer } = await chrome.storage.local.get('activeTimer');
          return { activeTimer: activeTimer || null };
        }
        case 'openOptions': {
          chrome.runtime.openOptionsPage();
          return { success: true };
        }
        case 'setSnapEnabled': {
          const settings = await getSettings();
          const next = { ...settings, snapEnabled: !!message.data.enabled };
          await chrome.storage.local.set({ settings: next });
          return { success: true };
        }
        case 'validateLinearConfig': {
          const settings = await getSettings();
          const apiKey = message.data?.linearApiKey || settings.linearApiKey;
          if (!apiKey) return { error: 'NO_API_KEY' };
          try {
            const data = await linearRequest({
              query: `query { viewer { id name } teams(first: 100) { nodes { id key name states { nodes { id name type } } } } }`,
              apiKey,
              fetchFn: fetch,
            });
            return {
              success: true,
              viewerId: data.viewer.id,
              viewerName: data.viewer.name,
              teams: data.teams.nodes.map((t) => ({
                id: t.id,
                key: t.key,
                name: t.name,
                inProgressStateId: pickInProgressState(t.states.nodes),
              })),
            };
          } catch (err) {
            return { error: err.message };
          }
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

  handler().then((result) => {
    console.log('[LC BG] ←', message.action, result);
    sendResponse(result);
  });
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
