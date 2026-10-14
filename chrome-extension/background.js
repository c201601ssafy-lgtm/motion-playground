const SITES = new Set(['https://c201601ssafy-lgtm.github.io/motion-playground/', 'http://localhost:5173/']);
const key = id => `crumple:${id}`;

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || message.type !== 'START') return;
  (async () => {
    if (!SITES.has(message.site) || !Number.isInteger(message.tabId)) throw new Error('잘못된 대상입니다');
    const target = await chrome.tabs.get(message.tabId);
    if (!/^https?:/.test(target.url ?? '')) throw new Error('일반 웹페이지 탭을 선택해 주세요');
    let screenshot = null;
    // activeTab only permits capturing the tab on which the popup was invoked.
    if (message.capture && target.active) {
      try { screenshot = await chrome.tabs.captureVisibleTab(target.windowId, { format: 'jpeg', quality: 75 }); } catch { /* title card fallback */ }
    }
    const token = crypto.randomUUID();
    const demo = await chrome.tabs.create({ url: 'about:blank' });
    const url = new URL(message.site); url.searchParams.set('extension', chrome.runtime.id); url.searchParams.set('session', token); url.hash = '/crumple';
    await chrome.storage.session.set({ [key(demo.id)]: { targetId: target.id, targetUrl: target.url,
      title: target.title || '선택한 탭', screenshot, token, origin: url.origin, path: url.pathname, expires: Date.now() + 30 * 60 * 1000 } });
    await chrome.tabs.update(demo.id, { url: url.href });
    return { ok: true };
  })().then(respond, e => respond({ ok: false, error: e.message }));
  return true;
});

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  (async () => {
    if (!sender.tab?.id || !['LOAD', 'CLOSE'].includes(message?.type)) throw new Error('연결할 수 없습니다');
    const record = (await chrome.storage.session.get(key(sender.tab.id)))[key(sender.tab.id)];
    const source = new URL(sender.url);
    if (!record || record.expires < Date.now() || record.token !== message.token ||
      source.origin !== record.origin || source.pathname !== record.path || sender.frameId !== 0) throw new Error('연결이 만료되었습니다. 확장 프로그램에서 다시 선택해 주세요');
    const target = await chrome.tabs.get(record.targetId);
    if (target.url !== record.targetUrl) throw new Error('선택한 탭의 주소가 바뀌었습니다. 다시 선택해 주세요');
    if (message.type === 'LOAD') return { ok: true, title: record.title, screenshot: record.screenshot };
    // Consume the session before removing only its bound target tab.
    await chrome.storage.session.remove(key(sender.tab.id));
    await chrome.tabs.remove(record.targetId);
    return { ok: true };
  })().then(respond, e => respond({ ok: false, error: e.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(id => { void chrome.storage.session.remove(key(id)); });
