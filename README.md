# MultiTab - 网页多开和整理助手

[English](#english) | 简体中文

一个 Firefox / Edge 浏览器扩展（Manifest V3），主要功能有：（一）批量打开网页并按网格平铺排列，支持哔哩哔哩直播多开后自动网页全屏。（二）将现有标签页按网格整理，平铺到整个屏幕。

- **A Firefox / Edge extension (Manifest V3)** that opens multiple copies of a webpage or all open tabs in a tiled grid layout, with optional auto web fullscreen for Bilibili Live. UI is available in English and Simplified Chinese (auto-follows browser language).

## 插件简介

**MultiTab - Web Multi-Open & Organizer**（MultiTab - 网页多开和整理助手）解决一个核心问题：**在浏览器里同时打开并摆放多个页面副本**。典型场景有：

- 同时监控多个直播间或行情页面：输入网址 + 打开数量，一键铺满屏幕
- 多标签整理：把当前窗口的所有标签页一键拆分成整齐的窗口网格

它不修改网页内容，只是打开真实窗口并精确摆放位置——因此页面保持完整登录态与播放状态，兼容任何网站。附带针对哔哩哔哩直播的自动网页全屏，让多窗口观看更沉浸。

## 功能特性

- **批量多开**：将当前标签页或手动输入的网址，按指定数量（1~16 个）批量打开为独立窗口
- **网格平铺**：窗口自动按近似方阵平铺到屏幕
  - 1~3 个 → 单行排列
  - 4 个 → 2×2，6 个 → 3×2，9 个 → 3×3，以此类推
- **平铺所有标签页**：一键将当前窗口的所有标签页平铺为网格（上限 16 个）
  - 仅支持 http/https 页面；`about:` 等特殊页面会保留在原窗口并提示
  - 无特殊页面时平铺后自动关闭原窗口
- **哔哩哔哩直播自动网页全屏**：全局开关（默认关闭），开启后所有 B 站直播页自动进入网页全屏模式
  - 主路径：调用播放器 JS API `livePlayer.setFullscreenStatus(1)`（利用 Firefox Xray 特性）
  - 备用路径：唤出控制条后点击网页全屏按钮（多套选择器兜底）
- **多开后关闭原标签页**：可选开关（默认关闭），仅当多开 URL 与当前标签页一致时才关闭，避免误关
- **一键关闭整组**：记住本组窗口 ID，一键关闭所有批量打开的窗口
- **设置记忆**：记住上次的网址、数量、开关状态，下次打开 popup 时回显供确认修改

## 技术说明

由于 B 站等网站设置了 `X-Frame-Options` 禁止 iframe 嵌入，网格平铺采用**多窗口精确定位**方案：打开 N 个真实浏览器窗口，按屏幕可用区域计算每个窗口的位置和尺寸，拼成网格。

## 安装（临时加载，适合开发测试）

### Firefox

1. 运行构建脚本：`node build-firefox.mjs`（需要 Node.js）
2. Firefox 打开 `about:debugging` → 左侧"此 Firefox" → "临时载入附加组件"
3. 选择生成的 `dist-firefox/` 目录下的 `manifest.json`

### Edge / Chrome

根目录 `manifest.json` 即 Chromium 版：

1. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）
2. 开启"开发人员模式" / "Developer mode"
3. 点击"加载解压缩的扩展" / "Load unpacked"，选择**项目根目录**

> 根目录 `manifest.json` 是 Chromium(Edge/Chrome) 版（`service_worker` 后台）；`build-firefox.mjs` 会生成 Firefox 版（`background.scripts` 后台 + gecko 设置）到 `dist-firefox/`。**不要**在 Chromium 浏览器里加载 `dist-firefox/`，也**不要**在 Firefox 里直接加载根目录。

### 商店发布打包

```bash
node pack.mjs
```

输出到 `artifacts/`：
- `multitab-edge.mv3.zip` — 上传到 [Microsoft Edge 合作伙伴中心](https://partner.microsoft.com/dashboard/microsoftedge/overview)
- `multitab-firefox.mv3.zip` — 上传到 [Firefox Mail Add-ons (AMO)](https://addons.mozilla.org/developers/)

两个包均以完整文件列表打包（`manifest.json` 在包根目录、无开发用文件），已验证内容差异正确（Edge 为 service_worker、Firefox 为 background.scripts + gecko 设置）。

## 使用方法

1. 点击工具栏中的扩展图标打开弹窗
2. 输入网址（或点击"使用当前标签页"带出当前页地址）
3. 设置打开数量（1~16），下方会实时显示网格形态（如"9 个窗口 → 3 列 x 3 行"）
4. 按需勾选"哔哩哔哩直播自动网页全屏"、"多开后关闭原标签页"
5. 点击"打开并平铺"完成批量打开
6. 点击"关闭整组窗口"可一键关闭本组所有窗口
7. 也可直接点击"平铺所有标签页"，将当前窗口的所有标签页平铺

## 项目结构

```
multi_tab/
├── manifest.json            # MV3 清单（Chromium/Edge 版），权限: storage、tabs
├── background.js            # 网格计算、批量开窗、平铺标签页、整组关闭
├── popup/
│   ├── popup.html           # 设置界面（data-i18n 标记）
│   ├── popup.css            # 样式
│   └── popup.js             # i18n 填充、设置读写、消息发送、原标签页关闭
├── content/
│   ├── bili-fullscreen.js   # B站直播自动网页全屏（分派浏览器专用路径）
│   └── injected/
│       └── bili-api.js      # 页面上下文脚本（Chromium 注入，调 livePlayer API）
├── icons/                   # 扩展图标（16/32/48/128）
├── _locales/                # i18n 语言包（zh_CN / en）
│   ├── zh_CN/messages.json
│   └── en/messages.json
├── make-icons.ps1           # 图标生成脚本（PowerShell + System.Drawing）
├── build-firefox.mjs        # Firefox 构建（生成 dist-firefox/）
└── pack.mjs                 # 商店打包脚本（输出 artifacts/*.zip）
```

## 已知限制

- 每个窗口自带标题栏会占用少量高度，平铺时按可用区域均分
- B 站改版可能导致备用路径的按钮选择器失效（主路径 JS API 不受影响）
- B 站特殊聚合页（iframe 嵌入播放器）跨域无法操作，自动全屏仅在普通直播间生效
- 平铺所有标签页的上限为 16 个，超出的标签页不会平铺
- Firefox 版构建（`build-firefox.mjs`）已内置 AMO 2025-11 新政要求的 `data_collection_permissions`（声明不收集数据），因此最低版本为 Firefox 142；如需支持更早版本需自行评估该字段兼容性

## English

**MultiTab - Web Multi-Open & Organizer** — a Firefox / Edge extension (Manifest V3) that opens multiple copies of a webpage (or all open tabs of the current window) as independently positioned windows forming a grid layout on screen.

### Features

- **Bulk open**: open the current tab's URL (or a custom URL) 1~16 times as separate windows
- **Grid tiling**: windows are precisely positioned into an approximate square grid — 1~3 in a single row, 4 → 2×2, 6 → 3×2, 9 → 3×3, etc.
- **Tile all tabs**: tile every tab of the current window (http/https only, up to 16); the original window is closed when everything is tiled, or kept when special pages (e.g. `about:`) are skipped
- **Auto web fullscreen for Bilibili Live**: a global switch (off by default). Uses the player JS API `livePlayer.setFullscreenStatus(1)` via Firefox Xray (`wrappedJSObject`) or page-context script injection on Chromium, with a control-bar button click as fallback
- **Close original tab** option: only closes the source tab when the URL matches what was opened
- **Close group**: one click to close all windows opened by the extension
- **Settings memory**: last URL, count and switches are remembered and shown for confirmation each time
- **Maximize hint**: shown when the window is not maximized
- **i18n**: English and Simplified Chinese, auto-follows the browser language

### Install (temporary, for development/testing)

- **Edge / Chrome**: the root `manifest.json` is the Chromium version — `edge://extensions` → Developer mode → Load unpacked → select the project root
- **Firefox**: run `node build-firefox.mjs`, then `about:debugging` → This Firefox → Load Temporary Add-on → pick `dist-firefox/manifest.json`
