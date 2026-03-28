# Keep Session - 浏览器插件设计文档

## 概述

Chrome MV3 浏览器插件，通过定时发送后台请求、检测心跳接口、阻止 idle 检测三种手段，保持任意网页的 session 不失效。支持全局默认配置 + 按域名覆盖。

## 架构：纯 Content Script 方案

保活逻辑由 Content Script 在页面上下文中直接执行，不依赖 Background Service Worker。

```
keep-session/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/
│   └── keep-alive.js
├── background/
│   └── service-worker.js
├── options/
│   └── options.html
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── shared/
    └── storage.js
```

- **Content Script**：核心保活逻辑，注入页面后自主运行
- **Popup**：通过 `chrome.storage` 与 Content Script 共享配置（无消息通信）
- **Service Worker**：仅处理插件安装事件和图标 badge 状态
- Content Script 通过 `chrome.storage.onChanged` 监听配置变化，实时响应

## 核心保活机制

### 1. 后台请求

- 定时向当前页面 URL 发送 `fetch` 请求（HEAD 或 GET）
- 请求在页面上下文中发起，自动携带 cookie
- 默认间隔 60 秒，用户可配置（最小 10 秒）
- 可选请求方式：HEAD（轻量）/ GET（完整）/ 自定义 URL

### 2. 检测心跳接口

- 页面加载后 5 秒内进行一次性扫描
- 扫描 `<script>` 标签，拦截 `XMLHttpRequest` 和 `fetch`，记录 API 请求 URL
- 识别 URL 中包含 `heartbeat`、`ping`、`keepalive`、`session` 等关键词的请求
- 最多记录 10 个候选 URL，用户在弹窗中选择启用
- 启用后优先调用该心跳接口

### 3. 防止 Idle 检测

- 注入 `requestAnimationFrame` 循环
- 定期触发 `mousemove` / `keydown` 事件（默认每 30 秒）
- 覆盖 `document.visibilityState` 和 `document.hidden` 的 getter
- 仅在用户开启该选项时激活

### 运行流程

```
页面加载 → Content Script 注入
  → 读取 storage 中的全局/域名配置
  → 判断当前域名是否启用
  → 启动保活定时器（后台请求 + idle 防御）
  → 启动心跳接口检测（一次性扫描，5 秒内）
  → 检测结果写入 storage
  → 监听 storage 变化，实时调整策略
```

## 配置数据结构

```js
{
  enabled: true,                    // 全局开关
  interval: 60,                     // 请求间隔（秒）
  requestMethod: "head",            // head | get | custom
  customUrl: "",                    // 自定义请求地址
  heartbeatUrl: "",                 // 自动检测到的心跳 URL
  preventIdle: true,                // 防止 idle 检测
  idleInterval: 30,                 // idle 事件间隔（秒）
  domainOverrides: {                // 按域名覆盖
    "example.com": {
      enabled: true,
      interval: 30,
      requestMethod: "get"
    }
  }
}
```

## Popup UI：方案 A（开关 + 状态卡片）

弹窗包含以下区域：

1. **状态卡片**：绿色/红色/黄色状态条 + 当前域名 + 运行状态
2. **主开关**：保持 Session 活跃 toggle
3. **统计信息**：已发送请求数 + 活跃时长（双列网格）
4. **域名覆盖提示**：当前域名有自定义配置时显示蓝色提示条
5. **底部按钮**：「域名设置」和「全局设置」

## 权限

```json
{
  "permissions": ["storage", "activeTab"],
  "optional_host_permissions": ["<all_urls>"]
}
```

使用 `optional_host_permissions`，用户启用某域名保活时通过 `chrome.permissions.request()` 动态申请。

## Options 页面

通过 popup「全局设置」按钮调用 `chrome.runtime.openOptionsPage()` 打开，配置：

- 默认请求间隔
- 默认请求方式
- 防止 idle 开关
- 域名覆盖列表（增删改）
- 心跳检测候选 URL 管理

## 边界情况与错误处理

### Session 失效

- 后台请求返回 401/403/302（跳转登录页）→ 判定 session 已丢失
- 立即停止保活，badge 显示红色 "!"
- Popup 状态变为"Session 已失效"，提示重新登录
- 用户重新登录后，Content Script 检测到有效响应自动恢复

### Tab 生命周期

- 关闭 tab → Content Script 自然销毁
- 刷新页面 → Content Script 重新注入，从 storage 恢复
- 多 tab 同域名 → 每个 tab 独立运行

### 请求失败容错

- 连续 3 次失败 → 暂停保活，badge 黄色警告
- 单次失败 → 静默忽略
- 网络恢复后自动恢复

### 性能控制

- 请求超 2 秒显示警告
- 最小间隔 10 秒
- 页面不可见时保持请求但不发 idle 事件

### 心跳检测限制

- 仅页面加载后 5 秒内一次性扫描
- 最多 10 个候选 URL
- 不拦截 HTTPS 页面上的 HTTP 请求

## 图标 Badge 状态

| 状态 | Badge | 颜色 |
|------|-------|------|
| 运行中 | 无/绿色圆点 | `#4caf50` |
| 已暂停 | OFF | `#bdbdbd` |
| Session 失效 | ! | `#f44336` |
| 请求异常 | ⚠ | `#ff9800` |
