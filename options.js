// Linear → Clockify Timer — Options

const DEFAULT_WORKSPACE_ID = '5ef305cdb6b6d1294b8a04c0';
const DEFAULT_RECENT_ENTRIES_COUNT = 3;
const MIN_RECENT_ENTRIES_COUNT = 1;
const MAX_RECENT_ENTRIES_COUNT = 20;

function clampRecentEntriesCount(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_RECENT_ENTRIES_COUNT;
  if (n < MIN_RECENT_ENTRIES_COUNT) return MIN_RECENT_ENTRIES_COUNT;
  if (n > MAX_RECENT_ENTRIES_COUNT) return MAX_RECENT_ENTRIES_COUNT;
  return n;
}

const DEFAULT_SETTINGS = {
  apiKey: '',
  linearApiKey: '',
  linearDefaultTeamId: '',
  linearViewerId: '',
  linearInProgressStateId: '',
  workspaceId: DEFAULT_WORKSPACE_ID,
  autoStop: false,
  recentEntriesCount: DEFAULT_RECENT_ENTRIES_COUNT,
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

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || { ...DEFAULT_SETTINGS };
}

async function render() {
  const settings = await loadSettings();

  document.getElementById('apiKey').value = settings.apiKey || '';
  document.getElementById('linearApiKey').value = settings.linearApiKey || '';
  document.getElementById('workspaceId').value = settings.workspaceId || DEFAULT_SETTINGS.workspaceId;
  document.getElementById('autoStop').checked = settings.autoStop || false;
  document.getElementById('recentEntriesCount').value = clampRecentEntriesCount(
    settings.recentEntriesCount ?? DEFAULT_RECENT_ENTRIES_COUNT
  );

  const sel = document.getElementById('linearDefaultTeam');
  if (settings.linearDefaultTeamId) {
    const opt = document.createElement('option');
    opt.value = settings.linearDefaultTeamId;
    opt.textContent = '(mentett — kattints Linear teszt-re frissítéshez)';
    opt.dataset.inProgressStateId = settings.linearInProgressStateId || '';
    opt.selected = true;
    sel.appendChild(opt);
    sel.dataset.viewerId = settings.linearViewerId || '';
  }

  renderMappingTable(settings.teamMapping || DEFAULT_SETTINGS.teamMapping);
}

function renderMappingTable(mapping) {
  const tbody = document.getElementById('mappingTable');
  tbody.textContent = '';

  for (const [teamKey, projectName] of Object.entries(mapping)) {
    addMappingRow(teamKey, projectName);
  }
}

function addMappingRow(teamKey, projectName) {
  const tbody = document.getElementById('mappingTable');
  const tr = document.createElement('tr');

  const tdTeam = document.createElement('td');
  const inputTeam = document.createElement('input');
  inputTeam.type = 'text';
  inputTeam.className = 'map-team';
  inputTeam.value = teamKey || '';
  inputTeam.placeholder = 'IT';
  tdTeam.appendChild(inputTeam);

  const tdProject = document.createElement('td');
  tdProject.style.display = 'flex';
  tdProject.style.gap = '4px';
  tdProject.style.alignItems = 'center';

  const inputProject = document.createElement('input');
  inputProject.type = 'text';
  inputProject.className = 'map-project';
  inputProject.value = projectName || '';
  inputProject.placeholder = 'IT';
  inputProject.style.flex = '1';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-danger';
  removeBtn.style.padding = '4px 8px';
  removeBtn.style.fontSize = '12px';
  removeBtn.textContent = '\u2715';
  removeBtn.addEventListener('click', () => tr.remove());

  tdProject.appendChild(inputProject);
  tdProject.appendChild(removeBtn);

  tr.appendChild(tdTeam);
  tr.appendChild(tdProject);
  tbody.appendChild(tr);
}

function collectMapping() {
  const mapping = {};
  const rows = document.querySelectorAll('#mappingTable tr');
  for (const row of rows) {
    const team = row.querySelector('.map-team').value.trim();
    const project = row.querySelector('.map-project').value.trim();
    if (team && project) {
      mapping[team] = project;
    }
  }
  return mapping;
}

function showStatus(message, isError) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = isError ? 'status error' : 'status';
  status.style.display = 'block';
  setTimeout(() => { status.style.display = 'none'; }, 3000);
}

document.getElementById('save').addEventListener('click', async () => {
  const sel = document.getElementById('linearDefaultTeam');
  const chosen = sel.options[sel.selectedIndex];
  const linearDefaultTeamId = sel.value || '';
  const linearInProgressStateId = chosen?.dataset?.inProgressStateId || '';
  const linearViewerId = sel.dataset.viewerId || '';

  const settings = {
    apiKey: document.getElementById('apiKey').value.trim(),
    linearApiKey: document.getElementById('linearApiKey').value.trim(),
    linearDefaultTeamId,
    linearViewerId,
    linearInProgressStateId,
    workspaceId: document.getElementById('workspaceId').value.trim() || DEFAULT_SETTINGS.workspaceId,
    autoStop: document.getElementById('autoStop').checked,
    recentEntriesCount: clampRecentEntriesCount(document.getElementById('recentEntriesCount').value),
    teamMapping: collectMapping(),
  };

  await chrome.storage.local.set({ settings });
  await chrome.storage.local.remove(['projectCache', 'userId']);
  showStatus('\u2705 Beállítások mentve');
});

document.getElementById('linearValidate').addEventListener('click', async () => {
  const statusEl = document.getElementById('linearStatus');
  statusEl.style.display = 'block';
  statusEl.className = 'status';
  statusEl.textContent = 'Kapcsolódás Linear-hez…';

  const apiKey = document.getElementById('linearApiKey').value.trim();
  if (!apiKey) {
    statusEl.className = 'status error';
    statusEl.textContent = 'Add meg a Linear API key-t előbb.';
    return;
  }

  const result = await chrome.runtime.sendMessage({
    action: 'validateLinearConfig',
    data: { linearApiKey: apiKey },
  });

  if (!result || result.error) {
    statusEl.className = 'status error';
    statusEl.textContent = `Hiba: ${result?.error || 'nincs válasz'}`;
    return;
  }

  statusEl.className = 'status';
  statusEl.textContent = `\u2705 Bejelentkezve mint ${result.viewerName} — ${result.teams.length} team elérhető.`;

  const sel = document.getElementById('linearDefaultTeam');
  sel.textContent = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— Válassz egy team-et —';
  sel.appendChild(placeholder);

  const currentSettings = await loadSettings();
  for (const team of result.teams) {
    const opt = document.createElement('option');
    opt.value = team.id;
    opt.dataset.inProgressStateId = team.inProgressStateId || '';
    opt.textContent = `${team.key} — ${team.name}`;
    if (team.id === currentSettings.linearDefaultTeamId) opt.selected = true;
    sel.appendChild(opt);
  }

  sel.dataset.viewerId = result.viewerId;
});

document.getElementById('reset').addEventListener('click', async () => {
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
  await chrome.storage.local.remove(['projectCache', 'userId']);
  render();
  showStatus('Alapértelmezés visszaállítva');
});

document.getElementById('addRow').addEventListener('click', () => addMappingRow('', ''));

render();
