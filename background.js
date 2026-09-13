// 网格多开 background script

const GRID_GROUP_KEY = "gridGroupWindowIds";
const MAX_TILE_TABS = 16;

// 计算 n 个窗口的网格布局（近似方阵）
// 返回 { cols, rows, cells: [{left, top, width, height}] }
function computeGrid(n, availWidth, availHeight) {
  let cols, rows;
  if (n <= 3) {
    // 1~3 个单行排列
    cols = n;
    rows = 1;
  } else {
    cols = Math.ceil(Math.sqrt(n));
    rows = Math.ceil(n / cols);
  }
  const cellW = Math.floor(availWidth / cols);
  const cellH = Math.floor(availHeight / rows);
  const cells = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    cells.push({
      left: col * cellW,
      top: row * cellH,
      width: cellW,
      height: cellH
    });
  }
  return { cols, rows, cells };
}

async function getGridGroup() {
  const result = await browser.storage.local.get(GRID_GROUP_KEY);
  return result[GRID_GROUP_KEY] || [];
}

async function setGridGroup(ids) {
  await browser.storage.local.set({ [GRID_GROUP_KEY]: ids });
}

// 校验 URL，无协议则补 https://
function normalizeUrl(input) {
  let url = input.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch (e) {
    return null;
  }
}

async function openGrid({ url, count, fullscreen, availWidth, availHeight }) {
  const grid = computeGrid(count, availWidth, availHeight);
  const windowIds = [];

  for (let i = 0; i < count; i++) {
    const cell = grid.cells[i];
    const createInfo = {
      url,
      left: cell.left,
      top: cell.top,
      width: cell.width,
      height: cell.height
    };
    const win = await browser.windows.create(createInfo);
    windowIds.push(win.id);
    // B站直播页面自动网页全屏：通过 URL 参数标记，content script 读取
    if (fullscreen && /^https?:\/\/live\.bilibili\.com\//i.test(url)) {
      try {
        await browser.tabs.sendMessage(win.tabs[0].id, {
          type: "MT_AUTO_FULLSCREEN"
        });
      } catch (e) {
        // content script 可能尚未注入，由其自身依据标记兜底（见 bili-fullscreen.js）
      }
    }
  }

  await setGridGroup(windowIds);
  return { ok: true, cols: grid.cols, rows: grid.rows, windowIds };
}

async function closeGridGroup() {
  const ids = await getGridGroup();
  const closed = [];
  for (const id of ids) {
    try {
      const exists = await browser.windows.get(id).then(() => true, () => false);
      if (exists) {
        await browser.windows.remove(id);
        closed.push(id);
      }
    } catch (e) {
      // 窗口可能已被手动关闭，忽略
    }
  }
  await setGridGroup([]);
  return { ok: true, closedCount: closed.length };
}

// 平铺当前窗口的所有标签页
// 仅平铺 http/https 标签页（上限 16 个）；存在无法重开的特殊标签页时保留原窗口
async function tileAllTabs({ availWidth, availHeight }) {
  // 先记录原窗口 ID，避免创建新窗口后聚焦变化导致误关
  const originalWindow = await browser.windows.getCurrent();
  const tabs = await browser.tabs.query({ currentWindow: true });
  const tileable = tabs.filter(
    t => t.url && /^https?:\/\//i.test(t.url) && !/^(about:|moz-extension:)/i.test(t.url)
  );

  if (tileable.length === 0) {
    return { ok: false, error: "没有可平铺的标签页（仅支持 http/https 页面）" };
  }

  const skipped = tabs.length - tileable.length;
  const limited = tileable.length > MAX_TILE_TABS;
  const targets = tileable.slice(0, MAX_TILE_TABS);

  const grid = computeGrid(targets.length, availWidth, availHeight);
  const windowIds = [];
  for (let i = 0; i < targets.length; i++) {
    const cell = grid.cells[i];
    const win = await browser.windows.create({
      url: targets[i].url,
      left: cell.left,
      top: cell.top,
      width: cell.width,
      height: cell.height
    });
    windowIds.push(win.id);
  }

  await setGridGroup(windowIds);

  // 全部平铺成功且无跳过项时，关闭原窗口
  let originalClosed = false;
  if (skipped === 0 && originalWindow) {
    try {
      await browser.windows.remove(originalWindow.id);
      originalClosed = true;
    } catch (e) {
      // 原窗口可能已被用户关闭，忽略
    }
  }

  return {
    ok: true,
    tiledCount: targets.length,
    cols: grid.cols,
    rows: grid.rows,
    skipped,
    limited,
    originalClosed
  };
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "MT_OPEN_GRID": {
          const url = normalizeUrl(message.url);
          if (!url) {
            sendResponse({ ok: false, error: "URL 无效" });
            return;
          }
          const count = Math.min(16, Math.max(1, parseInt(message.count, 10) || 1));
          const availWidth = Math.max(200, parseInt(message.availWidth, 10) || 1280);
          const availHeight = Math.max(200, parseInt(message.availHeight, 10) || 720);
          sendResponse(
            await openGrid({
              url,
              count,
              fullscreen: !!message.fullscreen,
              availWidth,
              availHeight
            })
          );
          return;
        }
        case "MT_CLOSE_GRID": {
          sendResponse(await closeGridGroup());
          return;
        }
        case "MT_TILE_TABS": {
          const availWidth = Math.max(200, parseInt(message.availWidth, 10) || 1280);
          const availHeight = Math.max(200, parseInt(message.availHeight, 10) || 720);
          sendResponse(await tileAllTabs({ availWidth, availHeight }));
          return;
        }
        default:
          sendResponse({ ok: false, error: "未知消息类型" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true; // 异步响应
});
