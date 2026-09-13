// B站直播自动网页全屏 - 页面上下文注入脚本
// 运行在页面 main world，可直接访问页面 JS 变量（livePlayer）
// 由 content script 动态注入（Chromium），或通过 script 标签加载
(function () {
  "use strict";

  const MAX_RETRY = 60;        // 最多重试次数（16 窗并发时初始化慢，预算 30s）
  const RETRY_INTERVAL = 500;  // 重试间隔 ms

  function trySetWebFullscreen() {
    try {
      const player = window.livePlayer;
      if (player && typeof player.setFullscreenStatus === "function") {
        player.setFullscreenStatus(1);
        return true;
      }
    } catch (e) {
      // 播放器 API 尚未就绪
    }
    return false;
  }

  function run() {
    let done = false;
    const timer = setInterval(() => {
      if (trySetWebFullscreen()) {
        clearInterval(timer);
        done = true;
        return;
      }
      // 超时放弃
    }, RETRY_INTERVAL);
    setTimeout(() => {
      if (!done) clearInterval(timer);
    }, MAX_RETRY * RETRY_INTERVAL);
  }

  if (document.readyState === "complete") {
    run();
  } else {
    window.addEventListener("load", run, { once: true });
  }
})();
