// 跨浏览器兼容：Chromium(Edge/Chrome) 无 browser 全局，MV3 下 chrome.* 同样返回 Promise
globalThis.browser ??= chrome;

const DEFAULTS = {
  url: "",
  count: 4,
  fullscreen: false,
  closeOrigin: false
};

const SETTINGS_KEY = "popupSettings";
const FLAG_KEY = "biliAutoFullscreen";

const urlInput = document.getElementById("urlInput");
const countInput = document.getElementById("countInput");
const fullscreenToggle = document.getElementById("fullscreenToggle");
const closeOriginToggle = document.getElementById("closeOriginToggle");
const useCurrentBtn = document.getElementById("useCurrentBtn");
const openBtn = document.getElementById("openBtn");
const closeAllBtn = document.getElementById("closeAllBtn");
const tileTabsBtn = document.getElementById("tileTabsBtn");
const gridHint = document.getElementById("gridHint");
const statusMsg = document.getElementById("statusMsg");

function setStatus(text, ok) {
  statusMsg.textContent = text || "";
  statusMsg.className = ok ? "status ok" : "status";
}

// i18n：填充 data-i18n / data-i18n-placeholder 标记的元素
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const msg = browser.i18n.getMessage(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const msg = browser.i18n.getMessage(el.dataset.i18nPlaceholder);
    if (msg) el.placeholder = msg;
  });
}

function t(key, ...args) {
  return browser.i18n.getMessage(key, args.map(String)) || key;
}

// 计算网格提示，如 "4 个 → 2 x 2"
function gridLayout(n) {
  let cols, rows;
  if (n <= 3) {
    // 1~3 个单行排列
    cols = n;
    rows = 1;
  } else {
    cols = Math.ceil(Math.sqrt(n));
    rows = Math.ceil(n / cols);
  }
  return { cols, rows };
}

function updateHint() {
  const n = clampCount();
  const { cols, rows } = gridLayout(n);
  gridHint.textContent = t("gridHint", n, cols, rows);
}

function clampCount() {
  let n = parseInt(countInput.value, 10);
  if (isNaN(n)) n = DEFAULTS.count;
  n = Math.min(16, Math.max(1, n));
  if (String(n) !== countInput.value) countInput.value = n;
  return n;
}

async function saveSettings() {
  const settings = {
    url: urlInput.value,
    count: clampCount(),
    fullscreen: fullscreenToggle.checked,
    closeOrigin: closeOriginToggle.checked
  };
  // 一次写入设置和全局开关，content script 据此决定是否自动全屏
  await browser.storage.local.set({ [SETTINGS_KEY]: settings, [FLAG_KEY]: settings.fullscreen });
}

async function loadSettings() {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const s = result[SETTINGS_KEY] || DEFAULTS;
  urlInput.value = s.url || "";
  countInput.value = s.count || DEFAULTS.count;
  fullscreenToggle.checked = !!s.fullscreen;
  closeOriginToggle.checked = !!s.closeOrigin;
  updateHint();
}

async function fillCurrentTabUrl() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0] && tabs[0].url && /^https?:\/\//i.test(tabs[0].url)) {
    urlInput.value = tabs[0].url;
    setStatus("");
  } else {
    setStatus(t("noUrlForCurrentTab"));
  }
}

openBtn.addEventListener("click", async () => {
  const count = clampCount();
  const url = urlInput.value.trim();
  if (!url) {
    setStatus(t("enterUrl"));
    return;
  }
  await saveSettings();

  // 在打开任何窗口之前先捕捉原标签页信息；一致性判断与关闭都交给 background
  // （Firefox 下 popup 会随逐窗创建失焦，自身上下文里的后续查询不可靠）
  let originTabId;
  let originTabUrl;
  if (closeOriginToggle.checked) {
    try {
      const originTabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (originTabs[0] && originTabs[0].url) {
        originTabId = originTabs[0].id;
        originTabUrl = originTabs[0].url;
      }
    } catch (e) {
      // 忽略，退化为不关闭
    }
  }

  const rect = await getMonitorRect();
  const response = await browser.runtime.sendMessage({
    type: "MT_OPEN_GRID",
    url,
    count,
    fullscreen: fullscreenToggle.checked,
    closeOrigin: closeOriginToggle.checked,
    originTabId,
    originTabUrl,
    availWidth: rect.availWidth,
    availHeight: rect.availHeight,
    availLeft: rect.availLeft,
    availTop: rect.availTop
  });

  if (response && response.ok) {
    setStatus(t("openedWindows", count, response.cols, response.rows), true);
    // 关闭原标签页由 background 判断并执行；popup 延迟关闭避免遮挡
    setTimeout(() => window.close(), 600);
  } else {
    setStatus((response && response.error) || t("openFailed"));
  }
});

tileTabsBtn.addEventListener("click", async () => {
  const rect = await getMonitorRect();
  setStatus(t("tilingTabs"));
  const response = await browser.runtime.sendMessage({
    type: "MT_TILE_TABS",
    availWidth: rect.availWidth,
    availHeight: rect.availHeight,
    availLeft: rect.availLeft,
    availTop: rect.availTop
  });

  if (response && response.ok) {
    let msg = t("tiledTabs", response.tiledCount, response.cols, response.rows);
    if (response.limited) msg += t("tiledLimited", response.tiledCount);
    if (response.skipped > 0) msg += t("tiledSkipped", response.skipped);
    setStatus(msg, true);
    if (response.tiledCount > 0 && response.skipped === 0) {
      // 原窗口所有标签页已移走会自动关闭，稍后关闭 popup
      setTimeout(() => window.close(), 800);
    }
  } else {
    setStatus((response && response.error) || t("tileFailed"));
  }
});

closeAllBtn.addEventListener("click", async () => {
  const response = await browser.runtime.sendMessage({ type: "MT_CLOSE_GRID" });
  if (response && response.ok) {
    setStatus(t("closedWindows", response.closedCount), true);
  } else {
    setStatus((response && response.error) || t("closeFailed"));
  }
});

useCurrentBtn.addEventListener("click", fillCurrentTabUrl);

// 赞助 / 好评入口：href 供中键或 Ctrl+点击直接打开，左键拦截后走 HE.support.open
// （popup 上下文用 tabs.create，弹窗自动关闭）
function bindSupportLink(el, urlOf) {
  if (!el) return;
  const support = globalThis.HE && HE.support;
  const url = support ? urlOf() : "";
  if (url) el.href = url;
  el.addEventListener("click", e => {
    e.preventDefault();
    if (support && url) support.open(url);
  });
}
bindSupportLink(document.getElementById("sponsorLink"), () => HE.support.sponsorUrl());
bindSupportLink(document.getElementById("reviewLink"), () => HE.support.storeUrl());
countInput.addEventListener("input", updateHint);
countInput.addEventListener("change", saveSettings);
fullscreenToggle.addEventListener("change", saveSettings);
closeOriginToggle.addEventListener("change", saveSettings);
urlInput.addEventListener("change", saveSettings);

// 读取 popup 所在显示器的可用区域与其原点：
// - 优先使用 popup 宿主窗口（最大化时=所在显示器可用区域）自身的几何值，
//   它与 windows.create/update 的坐标语义一致，可绕开 Firefox 在混 DPI
//   副显示器上对 screen.availLeft/Top 的误报（Mozilla bug 1246346）
// - 非 maximized 窗口回退到 screen.avail*（Chromium 语义正确）
async function getMonitorRect() {
  const s = window.screen;
  const rect = {
    availWidth: s.availWidth,
    availHeight: s.availHeight,
    availLeft: s.availLeft || 0,
    availTop: s.availTop || 0
  };
  try {
    const win = await browser.windows.get(browser.windows.WINDOW_ID_CURRENT);
    if (win && (win.state === "maximized" || win.state === "fullscreen")) {
      return {
        availWidth: win.width,
        availHeight: win.height,
        availLeft: win.left || 0,
        availTop: win.top || 0
      };
    }
  } catch (e) {
    // 忽略，使用 screen 兜底
  }
  return rect;
}

applyI18n();
loadSettings();
