const status = document.querySelector('#status');
const connect = document.querySelector('#connect');
const share = document.querySelector('#share');
async function refresh(type = 'status') {
  try {
    const state = await chrome.runtime.sendMessage({ type });
    status.textContent = state.message;
    connect.disabled = state.connected || state.connecting;
    share.disabled = !state.connected || state.capturing;
  } catch { status.textContent = 'Companion is unavailable. Reopen it and try again.'; share.disabled = true; }
}
connect.addEventListener('click', () => refresh('connect'));
share.addEventListener('click', () => refresh('share'));
await refresh();
setInterval(() => refresh(), 750);
