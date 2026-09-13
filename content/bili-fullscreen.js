// B站直播自动网页全屏 content script
// 全局开关：popup 勾选后写入 storage 的 biliAutoFullscreen，开启后所有 B 站直播页自动全屏，直到手动关闭
// 仅在普通直播间生效；特殊聚合页（iframe 嵌入播放器）跨域无法操作

const FLAG_KEY = "biliAutoFullscreen";
const MAX_RETRY = 30;        // 最多重试次数
const RETRY_INTERVAL = 500;  // 重试间隔 ms
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

// 主路径：调用直播播放器 JS API（Firefox Xray 特性，wrappedJSObject）
// 社区脚本验证：livePlayer.setFullscreenStatus(1) 可直接进入网页全屏
function tryPlayerApi() {
  try {
    const livePlayer = window.wrappedJSObject && window.wrappedJSObject.livePlayer;
    if (livePlayer && typeof livePlayer.setFullscreenStatus === "function") {
      livePlayer.setFullscreenStatus(1);
      return true;
    }
  } catch (e) {
    // 播放器 API 尚未就绪，继续重试
  }
  return false;
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

  for (let i = 0; i < MAX_RETRY; i++) {
    if (tryPlayerApi()) {
      running = false;
      return;
    }
    await new Promise(r => setTimeout(r, RETRY_INTERVAL));
  }

  // API 路径失败，降级为按钮点击
  for (let i = 0; i < MAX_RETRY; i++) {
    if (tryClickButton()) {
      break;
    }
    await new Promise(r => setTimeout(r, RETRY_INTERVAL));
  }
  running = false;
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
