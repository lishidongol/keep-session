// options/options.js

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const STORAGE_KEY = 'keepSessionConfig';

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

  let editingDomain = null;

  // ── 存储 ──────────────────────────────────────

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        const stored = result[STORAGE_KEY] || {};
        resolve(Object.assign({}, DEFAULTS, stored));
      });
    });
  }

  async function saveConfig(config) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: config }, resolve);
    });
  }

  function flashSave() {
    const hint = $('#save-hint');
    hint.classList.add('show');
    setTimeout(() => hint.classList.remove('show'), 1500);
  }

  // ── 全局设置 ──────────────────────────────────

  async function loadGlobalSettings() {
    const config = await getConfig();

    $('#opt-enabled').checked = config.enabled;
    $('#opt-interval').value = config.interval;
    $('#opt-method').value = config.requestMethod;
    $('#opt-custom-url').value = config.customUrl || '';
    $('#opt-prevent-idle').checked = config.preventIdle;
    $('#opt-idle-interval').value = config.idleInterval;

    toggleCustomUrlRow(config.requestMethod);
  }

  function toggleCustomUrlRow(method) {
    $('#custom-url-row').style.display = method === 'custom' ? 'flex' : 'none';
  }

  async function onGlobalChange() {
    const config = await getConfig();
    config.enabled = $('#opt-enabled').checked;
    config.interval = Math.max(10, parseInt($('#opt-interval').value) || 60);
    config.requestMethod = $('#opt-method').value;
    config.customUrl = $('#opt-custom-url').value.trim();
    config.preventIdle = $('#opt-prevent-idle').checked;
    config.idleInterval = Math.max(5, parseInt($('#opt-idle-interval').value) || 30);

    toggleCustomUrlRow(config.requestMethod);
    await saveConfig(config);
    flashSave();
  }

  // ── 域名覆盖列表 ──────────────────────────────

  async function renderDomainList() {
    const config = await getConfig();
    const list = $('#domain-list');
    const overrides = config.domainOverrides || {};
    const domains = Object.keys(overrides);

    if (domains.length === 0) {
      list.innerHTML = '<div class="empty-state">暂无域名覆盖配置</div>';
      return;
    }

    list.innerHTML = domains.map((domain) => {
      const o = overrides[domain];
      const details = [];
      if (o.interval) details.push(`${o.interval}s`);
      if (o.requestMethod) details.push(o.requestMethod.toUpperCase());
      if (o.enabled !== undefined) details.push(o.enabled ? '✓' : '✗');
      return `
        <div class="domain-item" data-domain="${escapeAttr(domain)}">
          <span class="domain-name">${escapeHtml(domain)}</span>
          <span style="font-size:11px;color:#999;">${details.join(' · ')}</span>
          <div class="domain-actions">
            <button class="btn-sm" data-action="edit" data-domain="${escapeAttr(domain)}">编辑</button>
            <button class="btn-sm danger" data-action="delete" data-domain="${escapeAttr(domain)}">删除</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── 域名 CRUD ─────────────────────────────────

  async function addDomain(domain) {
    if (!domain || !domain.match(/^[a-zA-Z0-9].*\..+$/)) return;
    const config = await getConfig();
    if (!config.domainOverrides) config.domainOverrides = {};
    if (config.domainOverrides[domain]) return; // 已存在

    config.domainOverrides[domain] = { enabled: true };
    await saveConfig(config);
    renderDomainList();
    flashSave();
  }

  async function deleteDomain(domain) {
    const config = await getConfig();
    delete config.domainOverrides[domain];
    await saveConfig(config);
    renderDomainList();
    flashSave();
  }

  function openEditDialog(domain) {
    editingDomain = domain;
    // 读取当前 override
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const config = result[STORAGE_KEY] || {};
      const o = config.domainOverrides?.[domain] || {};

      $('#edit-domain-title').textContent = `编辑 ${domain}`;
      $('#edit-enabled').checked = o.enabled !== false;
      $('#edit-interval').value = o.interval || '';
      $('#edit-method').value = o.requestMethod || 'head';
      $('#edit-heartbeat').value = o.heartbeatUrl || '';

      $('#edit-overlay').classList.add('active');
    });
  }

  async function saveEdit() {
    if (!editingDomain) return;
    const config = await getConfig();
    if (!config.domainOverrides) config.domainOverrides = {};

    const interval = parseInt($('#edit-interval').value);
    config.domainOverrides[editingDomain] = {
      enabled: $('#edit-enabled').checked,
      ...(interval >= 10 ? { interval } : {}),
      requestMethod: $('#edit-method').value,
      heartbeatUrl: $('#edit-heartbeat').value.trim()
    };

    await saveConfig(config);
    closeEditDialog();
    renderDomainList();
    flashSave();
  }

  function closeEditDialog() {
    editingDomain = null;
    $('#edit-overlay').classList.remove('active');
  }

  // ── 工具 ──────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── 初始化 ────────────────────────────────────

  document.addEventListener('DOMContentLoaded', async () => {
    await loadGlobalSettings();
    await renderDomainList();

    // 全局设置变更
    ['opt-enabled', 'opt-prevent-idle'].forEach((id) => {
      $(`#${id}`).addEventListener('change', onGlobalChange);
    });
    ['opt-interval', 'opt-idle-interval', 'opt-custom-url'].forEach((id) => {
      $(`#${id}`).addEventListener('input', debounce(onGlobalChange, 500));
    });
    $('#opt-method').addEventListener('change', onGlobalChange);

    // 添加域名
    $('#btn-add-domain').addEventListener('click', () => {
      const input = $('#new-domain-input');
      addDomain(input.value.trim());
      input.value = '';
    });
    $('#new-domain-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const input = $('#new-domain-input');
        addDomain(input.value.trim());
        input.value = '';
      }
    });

    // 域名列表操作（事件委托）
    $('#domain-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const domain = btn.dataset.domain;
      if (btn.dataset.action === 'edit') openEditDialog(domain);
      if (btn.dataset.action === 'delete') deleteDomain(domain);
    });

    // 编辑弹窗
    $('#edit-cancel').addEventListener('click', closeEditDialog);
    $('#edit-save').addEventListener('click', saveEdit);
    $('#edit-overlay').addEventListener('click', (e) => {
      if (e.target === $('#edit-overlay')) closeEditDialog();
    });

    // 监听来自 popup 的 focusDomain 消息
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'keepSession:focusDomain' && msg.domain) {
        openEditDialog(msg.domain);
      }
    });
  });

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }
})();
