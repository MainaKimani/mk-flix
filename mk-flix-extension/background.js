// Service worker: the extension's counterpart of the desktop app's main.js.
//
// - Runs the shared scripts on cinejoy.pk pages once their DOM is ready, in
//   the page's world and in main.js's order, after window.MKFlixNative
//   (bridge-page.js) and its snapshot.
// - Blocks ad and tracker hosts, but only for cinejoy.pk (see "Ad blocking").
// - Opens the gate (gate.html, the shared mkflix-account.html) on install,
//   from the toolbar button, and when a page asks for the paywall.
//
// Not here yet: the session and subscription check. Until the gate hands
// them over, the snapshot says "not subscribed", so posters show padlocks
// and Play opens the gate.

const GATE_URL = chrome.runtime.getURL('gate.html');
const CINEJOY_PATTERNS = ['*://cinejoy.pk/*', '*://*.cinejoy.pk/*'];

// Same files and order as main.js's dom-ready injection.
const SHARED_SCRIPTS = [
  'mkflix-footer.js',
  'mkflix-enforcer.js',
  'mkflix-menu.js',
  'mkflix-lock.js',
  'mkflix-notice.js',
  'mkflix-player.js',
  'mkflix-pip.js',
  'mkflix-cinejoy.js',
];

function isCinejoyUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'cinejoy.pk' || host.endsWith('.cinejoy.pk');
  } catch (e) {
    return false;
  }
}

// What the page-world bridge answers synchronously.
async function snapshot() {
  const { subscribed } = await chrome.storage.local.get({ subscribed: false });
  return { subscribed: subscribed === true };
}

// ---- Shared scripts on cinejoy.pk ----

chrome.webNavigation.onDOMContentLoaded.addListener(async (details) => {
  if (details.frameId !== 0) return;
  // documentIds pins the injection to this page, so a quick second
  // navigation can't receive a half-injected set.
  const target = details.documentId
    ? { tabId: details.tabId, documentIds: [details.documentId] }
    : { tabId: details.tabId, frameIds: [0] };
  try {
    await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['bridge-page.js'] });
    await chrome.scripting.executeScript({
      target,
      world: 'MAIN',
      func: (s) => window.__blendyBridge && window.__blendyBridge.update(s),
      args: [await snapshot()],
    });
    await chrome.scripting.executeScript({ target, world: 'MAIN', files: SHARED_SCRIPTS });
  } catch (e) {
    // The tab moved on or closed meanwhile; its next page gets its own run.
  }
}, { url: [{ hostEquals: 'cinejoy.pk' }, { hostSuffix: '.cinejoy.pk' }] });

// ---- Calls from cinejoy.pk pages (bridge-page.js → bridge-relay.js) ----

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.from !== 'page') return;
  if (!sender.tab || !isCinejoyUrl(sender.url)) return;
  switch (msg.call) {
    case 'openPaywall':
      chrome.tabs.update(sender.tab.id, { url: GATE_URL });
      break;
    case 'openSubscription':
      chrome.tabs.update(sender.tab.id, { url: GATE_URL + '#subscription' });
      break;
    case 'refreshSubscription':
      // Nothing to refresh until the gate hands over a session.
      break;
  }
});

// ---- Gate: on install and from the toolbar button ----

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: GATE_URL });
  syncAdTabs();
});
chrome.runtime.onStartup.addListener(syncAdTabs);
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: GATE_URL }));

// ---- Ad blocking ----
//
// The host list holds general-purpose services too (facebook.net, hubspot.com,
// intercom.io, ...), so blocking them browser-wide would break other sites.
// It applies to cinejoy.pk only, in two parts:
// - the static rule (adblock-rules.json) blocks requests cinejoy.pk itself
//   makes, popups and redirects it starts included;
// - this session rule blocks every request in a tab showing cinejoy.pk, so
//   ads inside embedded players (other sites' frames) are caught as well.
// The session rule's tab list is kept in step with the tabs showing
// cinejoy.pk, and is the only copy of that list: the worker is stopped when
// idle and loses its variables, while session rules last until the browser
// closes.

const AD_TAB_RULE_ID = 1;
let adHosts = null;
// Changes run one after another, each reading what the last one wrote.
let pending = Promise.resolve();

async function loadAdHosts() {
  if (!adHosts) {
    const rules = await (await fetch(chrome.runtime.getURL('adblock-rules.json'))).json();
    adHosts = rules[0].condition.requestDomains;
  }
  return adHosts;
}

// change(tabIds) edits the set of cinejoy.pk tab ids in place.
function changeAdTabs(change) {
  pending = pending.then(async () => {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const rule = rules.find((r) => r.id === AD_TAB_RULE_ID);
    const before = rule ? rule.condition.tabIds : [];
    const tabIds = new Set(before);
    await change(tabIds);
    if (tabIds.size === before.length && before.every((id) => tabIds.has(id))) return;
    const addRules = [];
    if (tabIds.size) {
      addRules.push({
        id: AD_TAB_RULE_ID,
        priority: 1,
        action: { type: 'block' },
        condition: { requestDomains: await loadAdHosts(), tabIds: [...tabIds] },
      });
    }
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [AD_TAB_RULE_ID], addRules });
  }).catch((e) => console.warn('Blendy Play: ad rule update failed', e));
}

// Rebuilds the list from the open tabs (browser start, extension installed or
// updated, a tab swapped for a preloaded one).
function syncAdTabs() {
  changeAdTabs(async (tabIds) => {
    const tabs = await chrome.tabs.query({ url: CINEJOY_PATTERNS });
    tabIds.clear();
    for (const t of tabs) tabIds.add(t.id);
  });
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const is = isCinejoyUrl(details.url);
  changeAdTabs((tabIds) => {
    if (is) tabIds.add(details.tabId); else tabIds.delete(details.tabId);
  });
});
chrome.webNavigation.onTabReplaced.addListener(syncAdTabs);
chrome.tabs.onRemoved.addListener((tabId) => changeAdTabs((tabIds) => { tabIds.delete(tabId); }));
