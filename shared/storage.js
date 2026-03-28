// shared/storage.js — 配置读写、默认值、域名覆盖合并

const DEFAULTS = {
  enabled: false,
  interval: 60,
  requestMethod: 'head',
  customUrl: '',
  heartbeatUrl: '',
  preventIdle: true,
  idleInterval: 30,
  domainOverrides: {}
};

const STORAGE_KEY = 'keepSessionConfig';

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function mergeConfig(globalConfig, domain) {
  const base = deepClone(globalConfig);
  const overrides = base.domainOverrides?.[domain];
  if (overrides) {
    delete base.domainOverrides;
    Object.assign(base, overrides);
  }
  delete base.domainOverrides;
  return base;
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const stored = result[STORAGE_KEY] || {};
      const merged = Object.assign({}, DEFAULTS, stored);
      // 确保 domainOverrides 始终是对象
      merged.domainOverrides = merged.domainOverrides || {};
      resolve(merged);
    });
  });
}

async function saveConfig(partial) {
  const current = await getConfig();
  const updated = Object.assign({}, current, partial);
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: updated }, resolve);
  });
}

async function getEffectiveConfig(domain) {
  const global = await getConfig();
  return mergeConfig(global, domain);
}

async function setDomainOverride(domain, override) {
  const config = await getConfig();
  if (!config.domainOverrides) {
    config.domainOverrides = {};
  }
  if (override) {
    config.domainOverrides[domain] = override;
  } else {
    delete config.domainOverrides[domain];
  }
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: config }, resolve);
  });
}

function getDomainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// Tab 级别状态（不在 storage 中，通过 runtime 消息通信）
const tabState = new Map();

function setTabState(tabId, state) {
  tabState.set(tabId, state);
}

function getTabState(tabId) {
  return tabState.get(tabId);
}

function removeTabState(tabId) {
  tabState.delete(tabId);
}
