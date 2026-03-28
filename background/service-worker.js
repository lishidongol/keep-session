// background/service-worker.js — 安装事件、Badge 状态、权限动态申请

const BADGE_COLORS = {
  running: '#4caf50',
  disabled: '#bdbdbd',
  session_lost: '#f44336',
  error: '#ff9800'
};

const BADGE_TEXTS = {
  running: '',
  disabled: 'OFF',
  session_lost: '!',
  error: '⚠'
};

// ── 安装事件 ──────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 初始化默认配置
    chrome.storage.local.get('keepSessionConfig', (result) => {
      if (!result.keepSessionConfig) {
        chrome.storage.local.set({
          keepSessionConfig: {
            enabled: false,
            interval: 60,
            requestMethod: 'head',
            customUrl: '',
            heartbeatUrl: '',
            preventIdle: true,
            idleInterval: 30,
            domainOverrides: {}
          }
        });
      }
    });
  }
});

// ── 消息中转 ──────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content Script 上报状态 → 更新 Badge
  if (msg.type === 'keepSession:status') {
    const tabId = sender.tab?.id;
    if (tabId) {
      updateBadge(tabId, msg.status);
      // 缓存 tab 状态
      chrome.storage.session?.set({
        [`tab_${tabId}`]: msg
      }).catch(() => {});
    }
  }

  // Content Script 上报心跳候选
  if (msg.type === 'keepSession:heartbeatCandidates') {
    // 存储候选到 session storage
    const key = `heartbeat_${msg.domain}`;
    chrome.storage.session?.set({
      [key]: msg.candidates
    }).catch(() => {});
  }

  // Popup 请求当前 tab 状态
  if (msg.type === 'keepSession:getTabState') {
    const tabId = msg.tabId;
    // 向 content script 转发请求
    chrome.tabs.sendMessage(tabId, { type: 'keepSession:getState' }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ isRunning: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse(response);
      }
    });
    return true; // 异步响应
  }

  // Popup 请求动态权限
  if (msg.type === 'keepSession:requestPermission') {
    chrome.permissions.request({
      origins: msg.origins
    }, (granted) => {
      sendResponse({ granted });
    });
    return true;
  }
});

// ── Tab 事件 ──────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session?.remove(`tab_${tabId}`).catch(() => {});
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  // 激活 tab 时刷新 badge
  chrome.storage.session?.get(`tab_${activeInfo.tabId}`).then((result) => {
    const state = result?.[`tab_${activeInfo.tabId}`];
    if (state) {
      updateBadge(activeInfo.tabId, state.status);
    } else {
      // 没有状态，说明 content script 未运行或未启用
      chrome.action.setBadgeText({ text: '', tabId: activeInfo.tabId });
    }
  }).catch(() => {
    chrome.action.setBadgeText({ text: '', tabId: activeInfo.tabId });
  });
});

// ── Badge 管理 ────────────────────────────────

function updateBadge(tabId, status) {
  const text = BADGE_TEXTS[status] || '';
  const color = BADGE_COLORS[status] || '#bdbdbd';

  chrome.action.setBadgeText({ text: text, tabId: tabId });
  chrome.action.setBadgeBackgroundColor({ color: color, tabId: tabId });
}
