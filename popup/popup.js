// popup/popup.js

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

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

  // ── 工具 ──────────────────────────────────────

  function getDomain(url) {
    try { return new URL(url).hostname; }
    catch { return ''; }
  }

  function formatElapsed(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }

  // ── 存储 ──────────────────────────────────────

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        const stored = result[STORAGE_KEY] || {};
        resolve(Object.assign({}, DEFAULTS, stored));
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

  // ── 获取当前 tab 信息 ──────────────────────────

  async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // ── 获取 content script 状态 ───────────────────

  async function getContentState(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'keepSession:getState' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }

  // ── 渲染 UI ───────────────────────────────────

  async function render() {
    const tab = await getCurrentTab();
    if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
      showDisabled('非网页标签');
      return;
    }

    const domain = getDomain(tab.url);
    const config = await getConfig();
    const override = config.domainOverrides?.[domain];
    const effectiveEnabled = override?.enabled ?? config.enabled;

    // 域名
    $('#status-domain').textContent = domain;

    // 开关
    const toggle = $('#main-toggle');
    toggle.checked = effectiveEnabled;

    // 状态卡片
    const state = await getContentState(tab.id);

    if (state?.isRunning) {
      setStatusCard('running', '运行中');
      $('#stat-requests').textContent = state.requestCount;
      $('#stat-elapsed').textContent = formatElapsed(state.elapsed);
    } else if (state?.status === 'session_lost') {
      setStatusCard('session-lost', 'Session 已失效');
      $('#stat-requests').textContent = state.requestCount;
      $('#stat-elapsed').textContent = formatElapsed(state.elapsed);
    } else if (state?.status === 'error') {
      setStatusCard('error', '请求异常');
      $('#stat-requests').textContent = state.requestCount;
      $('#stat-elapsed').textContent = formatElapsed(state.elapsed);
    } else if (effectiveEnabled) {
      setStatusCard('running', '启动中...');
      $('#stat-requests').textContent = '0';
      $('#stat-elapsed').textContent = '0s';
    } else {
      setStatusCard('disabled', '未启用');
      $('#stat-requests').textContent = '0';
      $('#stat-elapsed').textContent = '0s';
    }

    // 域名覆盖提示
    const hintEl = $('#domain-override-hint');
    if (override) {
      let detail = '';
      if (override.interval) detail += `间隔 ${override.interval}s`;
      if (override.requestMethod) detail += `${detail ? '、' : ''}${override.requestMethod.toUpperCase()}`;
      $('#domain-hint-text').textContent = `此域名使用自定义配置（${detail || '自定义'}）`;
      hintEl.style.display = 'flex';
    } else {
      hintEl.style.display = 'none';
    }

    // 心跳候选
    const hbSection = $('#heartbeat-section');
    const hbList = $('#heartbeat-list');
    hbList.innerHTML = '';

    if (state?.heartbeatCandidates?.length > 0) {
      hbSection.style.display = 'block';
      const currentHb = state.effectiveConfig?.heartbeatUrl || override?.heartbeatUrl || config.heartbeatUrl;

      state.heartbeatCandidates.forEach((url) => {
        const item = document.createElement('div');
        item.className = 'heartbeat-item' + (url === currentHb ? ' selected' : '');
        item.innerHTML = `<div class="hb-dot"></div><span>${escapeHtml(shortenUrl(url))}</span>`;
        item.title = url;
        item.addEventListener('click', () => selectHeartbeat(domain, url, override, config));
        hbList.appendChild(item);
      });
    } else {
      hbSection.style.display = 'none';
    }
  }

  function setStatusCard(status, text) {
    const card = $('#status-card');
    card.className = 'status-card status-' + status;
    $('#status-text').textContent = text;
  }

  function showDisabled(text) {
    setStatusCard('disabled', text);
    $('#main-toggle').checked = false;
    $('#main-toggle').disabled = true;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function shortenUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname + u.search;
      return path.length > 50 ? path.substring(0, 47) + '...' : path;
    } catch {
      return url.length > 50 ? url.substring(0, 47) + '...' : url;
    }
  }

  async function selectHeartbeat(domain, url, override, config) {
    if (override) {
      override.heartbeatUrl = url;
      await saveConfig({});
      // 直接更新 domainOverrides
      const cfg = await getConfig();
      cfg.domainOverrides[domain].heartbeatUrl = url;
      await new Promise((resolve) => {
        chrome.storage.local.set({ [STORAGE_KEY]: cfg }, resolve);
      });
    } else {
      await saveConfig({ heartbeatUrl: url });
    }
    await render();
  }

  // ── 事件绑定 ───────────────────────────────────

  document.addEventListener('DOMContentLoaded', async () => {
    await render();

    // 主开关
    $('#main-toggle').addEventListener('change', async (e) => {
      const tab = await getCurrentTab();
      if (!tab) return;
      const domain = getDomain(tab.url);
      const config = await getConfig();
      const hasOverride = !!config.domainOverrides?.[domain];

      if (hasOverride) {
        config.domainOverrides[domain].enabled = e.target.checked;
        if (!e.target.checked) {
          // 清理空 override
          const o = config.domainOverrides[domain];
          const isEmpty = !o.interval && !o.requestMethod && !o.heartbeatUrl && !o.customUrl;
          if (isEmpty) delete config.domainOverrides[domain];
        }
        await new Promise((resolve) => {
          chrome.storage.local.set({ [STORAGE_KEY]: config }, resolve);
        });
      } else {
        await saveConfig({ enabled: e.target.checked });
      }

      // 动态申请 host 权限
      if (e.target.checked && tab.url) {
        const origin = new URL(tab.url).origin + '/*';
        chrome.permissions.request({ origins: [origin] }, (granted) => {
          if (!granted) {
            // 用户拒绝权限
            e.target.checked = false;
            if (hasOverride) {
              config.domainOverrides[domain].enabled = false;
              chrome.storage.local.set({ [STORAGE_KEY]: config });
            } else {
              saveConfig({ enabled: false });
            }
          }
        });
      }

      await render();
    });

    // 域名设置 → 打开 options 并定位到域名
    $('#btn-domain-settings').addEventListener('click', async () => {
      const tab = await getCurrentTab();
      const domain = tab ? getDomain(tab.url) : '';
      chrome.runtime.openOptionsPage();
      // options 页面通过 URL hash 传递域名
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'keepSession:focusDomain', domain });
      }, 300);
    });

    // 全局设置
    $('#btn-global-settings').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // 监听 storage 变化刷新 UI
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_KEY]) {
        render();
      }
    });

    // 定时刷新统计
    setInterval(render, 5000);
  });
})();
