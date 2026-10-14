const start = document.querySelector('#start');
const status = document.querySelector('#status');
let selected;
const tabs = await chrome.tabs.query({ currentWindow: true });
const current = tabs.find(t => t.active);
for (const tab of tabs) {
  if (!tab.id || !/^https?:/.test(tab.url ?? '')) continue;
  const label = document.createElement('label'); label.className = 'tab';
  const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'tab';
  const text = document.createElement('span'); text.textContent = tab.title || tab.url;
  radio.checked = tab.id === current?.id;
  if (radio.checked) selected = tab.id;
  radio.addEventListener('change', () => { selected = tab.id; start.disabled = false; });
  label.append(radio, text); document.querySelector('#tabs').append(label);
}
start.disabled = !selected;
start.addEventListener('click', async () => {
  start.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'START', tabId: selected,
      capture: selected === current?.id, site: document.querySelector('#site').value });
    if (!response?.ok) throw new Error(response?.error || '연결 실패');
    window.close();
  } catch (e) { status.textContent = e.message; start.disabled = false; }
});
