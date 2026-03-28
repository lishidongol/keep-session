// content/keep-alive.js — 核心保活脚本

(async function () {
  'use strict';

  // ── 常量 ──────────────────────────────────────
  const MIN_INTERVAL = 10; // 最小间隔秒数
  const HEARTBEAT_SCAN_DURATION = 5000; // 心跳扫描窗口 5 秒
  const MAX_HEARTBEAT_CANDIDATES = 10;
  const HEARTBEAT_KEYWORDS = ['heartbeat', 'ping', 'keepalive', 'keep-alive', 'session', 'refresh', 'renew', 'alive', 'tick'];
  const MAX_CONSECUTIVE_FAILURES = 3;

  // ── 状态 ──────────────────────────────────────
  let timer = null;
  let idleIntervalId = null;
  let idleRafId = null;
  let requestCount = 0;
  let startTime = null;
  let consecutiveFailures = 0;
  let isRunning = false;
  let config = null;
  let heartbeatCandidates = [];

  const domain = location.hostname;
  const pageOrigin = location.origin;
  const isSecure = location.protocol === 'https:';

  // ── 工具函数 ──────────────────────────────────

  function sendStatus(status) {
    chrome.runtime.sendMessage({
      type: 'keepSession:status',
      tabId: -1, // 由 background 填充
      domain,
      status,
      requestCount,
      elapsed: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0
    }).catch(() => { /* background 可能未就绪 */ });
  }

  // ── 1. 后台请求 ───────────────────────────────

  async function sendKeepAliveRequest() {
    const effectiveConfig = getEffectiveConfig();

    let url;
    if (effectiveConfig.requestMethod === 'custom' && effectiveConfig.customUrl) {
      url = effectiveConfig.customUrl;
    } else if (effectiveConfig.heartbeatUrl) {
      url = effectiveConfig.heartbeatUrl;
    } else {
      url = location.href;
    }

    const method = effectiveConfig.requestMethod === 'get' ? 'GET' : 'HEAD';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method,
        credentials: 'include',
        mode: 'same-origin',
        redirect: 'manual', // 不自动跟随重定向
        signal: controller.signal
      });

      clearTimeout(timeout);

      // 检查 session 是否失效
      if (response.status === 401 || response.status === 403) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stop('session_lost');
          sendStatus('session_lost');
          return;
        }
      } else if (response.type === 'opaqueredirect' || response.status === 302) {
        // 302 重定向通常是跳转到登录页
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stop('session_lost');
          sendStatus('session_lost');
          return;
        }
      } else if (response.ok || response.status === 304) {
        consecutiveFailures = 0;
        requestCount++;
        sendStatus('running');
      } else {
        // 其他状态码
        handleSingleFailure();
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // 超时
        sendStatus('slow_response');
      }
      handleSingleFailure();
    }
  }

  function handleSingleFailure() {
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      stop('error');
      sendStatus('error');
    }
  }

  // ── 2. 心跳接口检测 ───────────────────────────

  function scanHeartbeatCandidates() {
    const candidates = new Set();

    // 扫描 <script> 标签中的 URL
    document.querySelectorAll('script[src]').forEach((el) => {
      const src = el.src;
      if (matchesHeartbeatPattern(src)) {
        candidates.add(src);
      }
    });

    // 扫描 <script> 标签内容中的 URL
    document.querySelectorAll('script:not([src])').forEach((el) => {
      const text = el.textContent || '';
      const urlPattern = /["']([^"']*(?:api|ajax|fetch|req)[^"']*)["']/gi;
      let match;
      while ((match = urlPattern.exec(text)) !== null) {
        const url = resolveUrl(match[1]);
        if (url && matchesHeartbeatPattern(url)) {
          candidates.add(url);
        }
      }
    });

    heartbeatCandidates = [...candidates].slice(0, MAX_HEARTBEAT_CANDIDATES);

    // 存储检测结果
    if (heartbeatCandidates.length > 0) {
      chrome.runtime.sendMessage({
        type: 'keepSession:heartbeatCandidates',
        domain,
        candidates: heartbeatCandidates
      }).catch(() => {});
    }
  }

  function matchesHeartbeatPattern(url) {
    const lower = url.toLowerCase();
    return HEARTBEAT_KEYWORDS.some((kw) => lower.includes(kw));
  }

  function resolveUrl(raw) {
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return null;
    // 跳过 HTTPS 页面上的 HTTP URL
    if (isSecure && raw.startsWith('http://')) return null;
    try {
      return new URL(raw, pageOrigin).href;
    } catch {
      return null;
    }
  }

  // 拦截 XHR 和 fetch 以捕获 API 请求
  function interceptNetworkRequests() {
    const captured = new Set();

    // 拦截 XMLHttpRequest
    const origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (typeof url === 'string') {
        const resolved = resolveUrl(url);
        if (resolved && matchesHeartbeatPattern(resolved)) {
          captured.add(resolved);
        }
      }
      return origXHROpen.call(this, method, url, ...rest);
    };

    // 拦截 fetch
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      let url;
      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof Request) {
        url = input.url;
      }
      if (url) {
        const resolved = resolveUrl(url);
        if (resolved && matchesHeartbeatPattern(resolved)) {
          captured.add(resolved);
        }
      }
      return origFetch.call(this, input, init);
    };

    // 扫描窗口结束后，恢复原始方法并收集结果
    setTimeout(() => {
      XMLHttpRequest.prototype.open = origXHROpen;
      window.fetch = origFetch;

      captured.forEach((url) => {
        if (!heartbeatCandidates.includes(url) && heartbeatCandidates.length < MAX_HEARTBEAT_CANDIDATES) {
          heartbeatCandidates.push(url);
        }
      });

      if (heartbeatCandidates.length > 0) {
        chrome.runtime.sendMessage({
          type: 'keepSession:heartbeatCandidates',
          domain,
          candidates: heartbeatCandidates
        }).catch(() => {});
      }
    }, HEARTBEAT_SCAN_DURATION);
  }

  // ── 3. 防止 Idle 检测 ─────────────────────────

  function startIdlePrevention(intervalSec) {
    stopIdlePrevention();

    const intervalMs = Math.max(intervalSec, 5) * 1000;

    // requestAnimationFrame 循环
    function loop() {
      idleRafId = requestAnimationFrame(() => loop());
    }
    idleRafId = requestAnimationFrame(() => loop());

    // 定期触发用户活动事件
    idleIntervalId = setInterval(() => {
      // mousemove
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: Math.random() * window.innerWidth,
        clientY: Math.random() * window.innerHeight
      }));

      // keydown（安全键）
      document.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Unidentified',
        code: ''
      }));
    }, intervalMs);

    // 覆盖 visibilityState 和 hidden
    try {
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
        configurable: true
      });
      Object.defineProperty(document, 'hidden', {
        get: () => false,
        configurable: true
      });
    } catch (e) {
      // 某些页面可能禁止覆盖
    }
  }

  function stopIdlePrevention() {
    if (idleIntervalId !== null) {
      clearInterval(idleIntervalId);
      idleIntervalId = null;
    }
    if (idleRafId !== null) {
      cancelAnimationFrame(idleRafId);
      idleRafId = null;
    }
    // 恢复 visibility（删除我们定义的 getter，让浏览器默认值生效）
    try {
      delete document.visibilityState;
      delete document.hidden;
    } catch (e) {
      // 忽略
    }
  }

  // ── 配置辅助 ──────────────────────────────────

  function getEffectiveConfig() {
    if (!config) return null;
    const base = JSON.parse(JSON.stringify(config));
    const overrides = base.domainOverrides?.[domain];
    if (overrides) {
      delete base.domainOverrides;
      Object.assign(base, overrides);
    }
    return base;
  }

  // ── 启动 / 停止 ───────────────────────────────

  async function start() {
    const data = await chrome.storage.local.get('keepSessionConfig');
    config = data.keepSessionConfig || {};
    const effective = getEffectiveConfig();

    if (!effective || !effective.enabled) {
      sendStatus('disabled');
      return;
    }

    if (isRunning) return;
    isRunning = true;
    startTime = Date.now();
    requestCount = 0;
    consecutiveFailures = 0;

    const intervalSec = Math.max(effective.interval || 60, MIN_INTERVAL);

    // 启动后台请求定时器
    sendKeepAliveRequest(); // 立即发一次
    timer = setInterval(sendKeepAliveRequest, intervalSec * 1000);

    // 启动 idle 防御
    if (effective.preventIdle) {
      startIdlePrevention(effective.idleInterval || 30);
    }

    // 心跳扫描（一次性）
    scanHeartbeatCandidates();
    interceptNetworkRequests();

    sendStatus('running');
  }

  function stop(reason) {
    isRunning = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    stopIdlePrevention();
  }

  // ── 监听配置变化 ──────────────────────────────

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.keepSessionConfig) {
      config = changes.keepSessionConfig.newValue || {};
      const effective = getEffectiveConfig();

      if (isRunning && (!effective || !effective.enabled)) {
        // 被关闭了
        stop('disabled');
        sendStatus('disabled');
      } else if (!isRunning && effective?.enabled) {
        // 被开启了
        start();
      } else if (isRunning) {
        // 参数变了，重启
        stop('config_changed');
        start();
      }
    }
  });

  // ── 接收来自 popup 的消息 ─────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'keepSession:getState') {
      const effective = getEffectiveConfig();
      sendResponse({
        isRunning,
        domain,
        requestCount,
        elapsed: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
        consecutiveFailures,
        heartbeatCandidates,
        effectiveConfig: effective
      });
      return true; // 异步响应
    }

    if (msg.type === 'keepSession:toggle') {
      // popup 切换开关后通过 storage 通知，这里不需要额外处理
      // storage.onChanged 会处理
    }
  });

  // ── 启动 ──────────────────────────────────────
  start();
})();
