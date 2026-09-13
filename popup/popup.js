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
const maximizeHint = document.getElementById("maximizeHint");

function setStatus(text, ok) {
  statusMsg.textContent = text || "";
  statusMsg.className = ok ? "status ok" : "status";
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
  gridHint.textContent = `${n} 个窗口 → ${cols} 列 x ${rows} 行`;
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
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
  // 同步全局开关，content script 据此决定是否自动全屏
  await browser.storage.local.set({ [FLAG_KEY]: settings.fullscreen });
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
    setStatus("当前标签页无可用的网址");
  }
}

openBtn.addEventListener("click", async () => {
  const count = clampCount();
  const url = urlInput.value.trim();
  if (!url) {
    setStatus("请输入网址，或点击“使用当前标签页”");
    return;
  }
  await saveSettings();

  const win = await browser.windows.get(browser.windows.WINDOW_ID_CURRENT);
  const response = await browser.runtime.sendMessage({
    type: "MT_OPEN_GRID",
    url,
    count,
    fullscreen: fullscreenToggle.checked,
    availWidth: win.width,
    availHeight: win.height
  });

  if (response && response.ok) {
    setStatus(`已打开 ${count} 个窗口（${response.cols}x${response.rows}）`, true);
    // 仅当多开 URL 与当前激活标签页一致时，关闭原标签页
    if (closeOriginToggle.checked) {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (tab && tab.url && tab.url.replace(/\/$/, "") === url.replace(/\/$/, "")) {
          await browser.tabs.remove(tab.id);
        }
      } catch (e) {
        // 标签页可能已被关闭，忽略
      }
    }
    // 打开后关闭 popup，避免遮挡
    setTimeout(() => window.close(), 600);
  } else {
    setStatus((response && response.error) || "打开失败");
  }
});

tileTabsBtn.addEventListener("click", async () => {
  const win = await browser.windows.get(browser.windows.WINDOW_ID_CURRENT);
  setStatus("正在平铺标签页…");
  const response = await browser.runtime.sendMessage({
    type: "MT_TILE_TABS",
    availWidth: win.width,
    availHeight: win.height
  });

  if (response && response.ok) {
    let msg = `已平铺 ${response.tiledCount} 个标签页（${response.cols}x${response.rows}）`;
    if (response.limited) msg += `，超出上限仅取前 ${response.tiledCount} 个`;
    if (response.skipped > 0) msg += `，${response.skipped} 个特殊页面保留在原窗口`;
    else if (response.originalClosed) msg += "，原窗口已关闭";
    setStatus(msg, true);
    if (response.originalClosed) {
      setTimeout(() => window.close(), 800);
    }
  } else {
    setStatus((response && response.error) || "平铺失败");
  }
});

closeAllBtn.addEventListener("click", async () => {
  const response = await browser.runtime.sendMessage({ type: "MT_CLOSE_GRID" });
  if (response && response.ok) {
    setStatus(`已关闭 ${response.closedCount} 个窗口`, true);
  } else {
    setStatus((response && response.error) || "关闭失败");
  }
});

useCurrentBtn.addEventListener("click", fillCurrentTabUrl);
countInput.addEventListener("input", updateHint);
countInput.addEventListener("change", saveSettings);
fullscreenToggle.addEventListener("change", saveSettings);
closeOriginToggle.addEventListener("change", saveSettings);
urlInput.addEventListener("change", saveSettings);

// 未最大化且非全屏时显示提示条
async function checkWindowState() {
  try {
    const win = await browser.windows.get(browser.windows.WINDOW_ID_CURRENT);
    if (win.state !== "maximized" && win.state !== "fullscreen") {
      maximizeHint.classList.remove("hidden");
    }
  } catch (e) {
    // 忽略
  }
}

checkWindowState();
loadSettings();
