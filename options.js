// Linear → Clockify Timer — Options

const DEFAULT_WORKSPACE_ID = '5ef305cdb6b6d1294b8a04c0';

const DEFAULT_SETTINGS = {
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
    LBE: 'Lakásbekerülés',
    TUL: 'Lakások és Tulajok',
    LM: 'LM Support',
  },
};

async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || { ...DEFAULT_SETTINGS };
}

async function render() {
  const settings = await loadSettings();

  document.getElementById('apiKey').value = settings.apiKey || '';
  document.getElementById('workspaceId').value = settings.workspaceId || DEFAULT_SETTINGS.workspaceId;
  document.getElementById('autoStop').checked = settings.autoStop || false;

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
  const settings = {
    apiKey: document.getElementById('apiKey').value.trim(),
    workspaceId: document.getElementById('workspaceId').value.trim() || DEFAULT_SETTINGS.workspaceId,
    autoStop: document.getElementById('autoStop').checked,
    teamMapping: collectMapping(),
  };

  await chrome.storage.local.set({ settings });
  await chrome.storage.local.remove(['projectCache', 'userId']);
  showStatus('\u2705 Beállítások mentve');
});

document.getElementById('reset').addEventListener('click', async () => {
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
  await chrome.storage.local.remove(['projectCache', 'userId']);
  render();
  showStatus('Alapértelmezés visszaállítva');
});

document.getElementById('addRow').addEventListener('click', () => addMappingRow('', ''));

render();
