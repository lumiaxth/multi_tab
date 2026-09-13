// 跨浏览器兼容：Chromium(Edge/Chrome) 无 browser 全局，MV3 下 chrome.* 同样返回 Promise
globalThis.browser ??= chrome;

// B站直播自动网页全屏 content script
// 全局开关：popup 勾选后写入 storage 的 biliAutoFullscreen，开启后所有 B 站直播页自动全屏，直到手动关闭
// 仅在普通直播间生效；特殊聚合页（iframe 嵌入播放器）跨域无法操作
//
// 主路径（按浏览器分派）：
//   Firefox：window.wrappedJSObject.livePlayer（Xray 特性）
//   Chromium/Edge：注入 content/injected/bili-api.js 到页面上下文
// 备用路径：唤出控制条后点击网页全屏按钮（两浏览器通用）
//
// 成功判定：不依赖"点击是否命中"，而是几何验证——网页全屏生效后
// 播放器容器（#live-player）会被 CSS 提升为近乎铺满视口，以此为准。
// 16+ 窗口并发重载时页面初始化慢，点击命中未就绪元素是无效的，
// 必须验证失败后继续重试，否则个别页面会停留在网页模式下。

const FLAG_KEY = "biliAutoFullscreen";
const IS_FIREFOX = typeof window.wrappedJSObject !== "undefined";
const MAX_RETRY = 60;          // 最多重试次数（并发 16 窗时页面初始化很慢，预算放宽）
const RETRY_INTERVAL = 500;    // 重试间隔 ms
const VERIFY_DELAY = 1200;     // 触发后等待生效再验证的间隔 ms
let running = false;

// 是否已开启自动全屏（storage.local 全局开关）
async function isEnabled() {
  try {
    const result = await browser.storage.local.get(FLAG_KEY);
    return !!result[FLAG_KEY];
  } catch (e) {
    return false;
  }
}

// 几何验证：网页全屏生效后播放器近乎铺满视口
function isWebFullscreenActive() {
  const player = document.getElementById("live-player");
  if (!player) return false;
  const rect = player.getBoundingClientRect();
  return (
    rect.width >= window.innerWidth * 0.95 &&
    rect.height >= window.innerHeight * 0.9
  );
}

// 验证生效与否：等 VERIFY_DELAY 后检查，返回是否成功
function waitForActivation() {
  return new Promise(resolve => {
    setTimeout(() => resolve(isWebFullscreenActive()), VERIFY_DELAY);
  });
}

// 主路径（Firefox）：调用直播播放器 JS API（Xray 特性，wrappedJSObject）
async function tryPlayerApiFirefox() {
  try {
    const livePlayer = window.wrappedJSObject && window.wrappedJSObject.livePlayer;
    if (livePlayer && typeof livePlayer.setFullscreenStatus === "function") {
      livePlayer.setFullscreenStatus(1);
      return await waitForActivation();
    }
  } catch (e) {
    // 播放器 API 尚未就绪，继续重试
  }
  return false;
}

// 主路径（Chromium/Edge）：注入脚本到页面上下文（注入脚本自带轮询与验证）
function injectPageScript() {
  const script = document.createElement("script");
  script.src = browser.runtime.getURL("content/injected/bili-api.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

// 备用路径：向播放器派发 mousemove 唤出控制条，再点击网页全屏图标
function tryClickButton() {
  const player = document.getElementById("live-player");
  if (!player) return false;

  // 控制条默认隐藏，需先触发鼠标移动事件
  player.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, cancelable: true })
  );

  const selectors = [
    // B站直播播放器为 Svelte 实现，控制条右侧图标区
    "#web-player-controller-wrap-el .right-area div:nth-child(2) span",
    "#web-player-controller-wrap-el .right-area > div:nth-child(2)",
    "#web-player-controller-wrap-el .right-area div[class*='web-fullscreen']",
    "#web-player-controller-wrap-el .right-area div[title='网页全屏']",
    "[title='网页全屏']",
    "[aria-label='网页全屏']"
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      el.dispatchEvent(
        new MouseEvent("mouseenter", { bubbles: true, cancelable: true })
      );
      el.click();
      return true;
    }
  }
  return false;
}

async function autoFullscreen() {
  if (running) return;
  if (!location.hostname.includes("live.bilibili.com")) return;
  running = true;

  try {
    // 主路径：Firefox 调 API 并验证；Chromium 注入页面脚本（自带轮询+验证）
    if (IS_FIREFOX) {
      for (let i = 0; i < MAX_RETRY && running; i++) {
        if (await tryPlayerApiFirefox()) return;
        await new Promise(r => setTimeout(r, RETRY_INTERVAL));
      }
    } else {
      injectPageScript();
      // 注入脚本自带 30s 轮询，这里给足时间后查一次结果
      for (let waited = 0; waited < MAX_RETRY * RETRY_INTERVAL; waited += RETRY_INTERVAL) {
        if (isWebFullscreenActive()) return;
        await new Promise(r => setTimeout(r, RETRY_INTERVAL));
      }
    }

    // 备用路径：按钮点击，点击后验证是否真的生效，未生效则继续重试
    for (let i = 0; i < MAX_RETRY && running; i++) {
      tryClickButton();
      if (await waitForActivation()) return;
      await new Promise(r => setTimeout(r, RETRY_INTERVAL));
    }

    // 兜底返回：Chromium 注入版可能只是没等到，最后一次无延时的几何检查
    if (!IS_FIREFOX && isWebFullscreenActive()) return;
  } finally {
    running = false;
  }
}

// background 消息触发（优先路径）
browser.runtime.onMessage.addListener((message) => {
  if (message && message.type === "MT_AUTO_FULLSCREEN") {
    autoFullscreen();
  }
});

// 兜底路径：storage 开关开启时，直播页自动尝试（页面刷新/直开也能生效）
(async () => {
  if (await isEnabled()) {
    if (document.readyState === "complete") {
      autoFullscreen();
    } else {
      window.addEventListener("load", autoFullscreen, { once: true });
    }
  }
})();
