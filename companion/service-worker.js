import { captureSelectedPage } from './capture.js';

let port;
let state = { connected: false, connecting: false, message: 'Open a local-only browser session in Roundtable, then connect.' };
let capturing = false;
let captureTimer;
const clearCapture = () => { capturing = false; clearTimeout(captureTimer); };
function connect() {
  if (port) return;
  state = { connected: false, connecting: true, message: 'Connecting to Roundtable…' };
  try {
    port = chrome.runtime.connectNative('com.roundtable.companion');
    port.onMessage.addListener(message => {
      if (message.type === 'ready') state = { connected: true, connecting: false, message: 'Connected to a local-only Roundtable session.' };
      else if (message.type === 'captured') { clearCapture(); state = { connected: true, connecting: false, message: 'Page shared. Inspect it in Roundtable with /browser read.', sourceId: message.sourceId }; }
      else if (message.type === 'error') { clearCapture(); state = { ...state, message: String(message.message).slice(0, 500) }; }
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      port = undefined; clearCapture();
      state = { connected: false, connecting: false, message: error ? 'Connection unavailable. Start roundtable browser and check the companion installation.' : 'Roundtable disconnected. Reconnect and explicitly share the page again.' };
    });
  } catch { port = undefined; state = { connected: false, connecting: false, message: 'Native companion host is unavailable.' }; }
}
async function share() {
  if (!port || !state.connected || capturing) throw new Error('Connect to Roundtable before sharing a page.');
  capturing = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) throw new Error('Select an ordinary HTTP(S) page. Browser settings and extension pages cannot be shared.');
    const [capture] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', func: captureSelectedPage });
    if (!capture?.documentId || !capture.result || capture.result.url !== tab.url) throw new Error('The selected page changed. Open the companion and share it again.');
    const [check] = await chrome.scripting.executeScript({ target: { tabId: tab.id, documentIds: [capture.documentId] }, world: 'ISOLATED', func: () => location.href });
    if (check?.result !== tab.url) throw new Error('The selected document changed. Share it again.');
    if (!port || !state.connected) throw new Error('Roundtable disconnected before capture completed.');
    port.postMessage({ type: 'snapshot', tabId: tab.id, documentId: capture.documentId, ...capture.result });
    captureTimer = setTimeout(() => { clearCapture(); port?.disconnect(); state = { connected: false, connecting: false, message: 'Capture timed out. Reconnect and explicitly share again.' }; }, 5000);
    state = { ...state, message: 'Sharing this page with the local session…' };
  } catch (error) { clearCapture(); throw error; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return false;
  (async () => {
    try {
      if (message?.type === 'connect') connect();
      else if (message?.type === 'share') await share();
      else if (message?.type !== 'status') throw new Error('Unsupported companion command');
      respond({ ...state, capturing });
    } catch (error) { state = { ...state, message: error.message }; respond({ ...state, capturing }); }
  })();
  return true;
});
