// Linear → Clockify Timer — Popup
const content = document.getElementById('content');
let elapsedInterval = null;

function appendSettingsLink() {
  const link = document.createElement('a');
  link.href = '#';
  link.className = 'settings-link';
  link.textContent = '⚙️ Beállítások';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  content.appendChild(link);
}

async function render() {
  const { activeTimer } = await chrome.storage.local.get('activeTimer');
  const { settings } = await chrome.storage.local.get('settings');

  content.textContent = '';
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }

  if (!settings?.apiKey || !settings?.linearApiKey) {
    const msg = document.createElement('div');
    msg.className = 'no-timer';
    msg.textContent = 'API key(ek) nincsenek beállítva';
    content.appendChild(msg);
    appendSettingsLink();
    return;
  }

  if (!activeTimer) {
    const msg = document.createElement('div');
    msg.className = 'no-timer';
    msg.textContent = 'Nincs aktív timer';
    content.appendChild(msg);
    appendSettingsLink();
    return;
  }

  const timerInfo = document.createElement('div');
  timerInfo.className = 'timer-info';

  const issueKeyEl = document.createElement('div');
  issueKeyEl.className = 'issue-key';
  issueKeyEl.textContent = activeTimer.issueKey || 'Ismeretlen';
  if (activeTimer.external) {
    const badge = document.createElement('span');
    badge.className = 'external-badge';
    badge.textContent = 'külső';
    issueKeyEl.appendChild(badge);
  }
  timerInfo.appendChild(issueKeyEl);

  const titleEl = document.createElement('div');
  titleEl.className = 'issue-title';
  titleEl.textContent = activeTimer.issueTitle;
  timerInfo.appendChild(titleEl);

  if (activeTimer.projectName) {
    const projectEl = document.createElement('div');
    projectEl.className = 'project-name';
    projectEl.textContent = '📁 ' + activeTimer.projectName;
    timerInfo.appendChild(projectEl);
  }
  content.appendChild(timerInfo);

  const elapsedEl = document.createElement('div');
  elapsedEl.className = 'elapsed';
  elapsedEl.id = 'popup-elapsed';
  elapsedEl.textContent = '00:00:00';
  content.appendChild(elapsedEl);
  startElapsed(activeTimer.startedAt);

  if (!activeTimer.external) {
    const linearConfigComplete = !!(
      settings?.linearApiKey && settings?.linearDefaultTeamId &&
      settings?.linearViewerId && settings?.linearInProgressStateId
    );
    let doneBtn = null;

    const stopBtn = document.createElement('button');
    stopBtn.className = 'stop-btn';
    stopBtn.textContent = '⏹ Stop';
    stopBtn.addEventListener('click', async () => {
      stopBtn.disabled = true;
      if (doneBtn) doneBtn.disabled = true;
      const result = await chrome.runtime.sendMessage({ action: 'stopTimer' });
      if (result.error) {
        const errEl = document.createElement('div');
        errEl.className = 'error';
        errEl.style.display = 'block';
        errEl.textContent = result.error;
        content.appendChild(errEl);
        stopBtn.disabled = false;
        if (doneBtn) doneBtn.disabled = false;
      } else {
        render();
      }
    });
    content.appendChild(stopBtn);

    if (activeTimer.issueKey && linearConfigComplete) {
      doneBtn = document.createElement('button');
      doneBtn.className = 'done-btn';
      doneBtn.textContent = '✓ Stop & Done';
      doneBtn.addEventListener('click', async () => {
        stopBtn.disabled = true;
        doneBtn.disabled = true;
        const result = await chrome.runtime.sendMessage({ action: 'stopAndDoneTimer' });
        if (result.error) {
          const errEl = document.createElement('div');
          errEl.className = 'error';
          errEl.style.display = 'block';
          errEl.textContent = result.error;
          content.appendChild(errEl);
          stopBtn.disabled = false;
          doneBtn.disabled = false;
          return;
        }
        if (result.warning) {
          const warnEl = document.createElement('div');
          warnEl.className = 'error';
          warnEl.style.display = 'block';
          warnEl.style.color = '#eab308';
          warnEl.textContent = `⚠️ ${result.warning}`;
          content.appendChild(warnEl);
        }
        render();
      });
      content.appendChild(doneBtn);
    }
  }

  appendSettingsLink();
}

function startElapsed(startedAt) {
  if (elapsedInterval) clearInterval(elapsedInterval);
  const el = document.getElementById('popup-elapsed');
  if (!el) return;

  function update() {
    const diff = Date.now() - new Date(startedAt).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent =
      String(h).padStart(2, '0') + ':' +
      String(m).padStart(2, '0') + ':' +
      String(s).padStart(2, '0');
  }

  update();
  elapsedInterval = setInterval(update, 1000);
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.activeTimer || changes.settings) render();
});
render();
