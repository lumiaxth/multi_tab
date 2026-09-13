// 网格多开 background script

// 跨浏览器兼容：Chromium(Edge/Chrome) 无 browser 全局，MV3 下 chrome.* 同样返回 Promise
globalThis.browser ??= chrome;

// i18n：background 上下文的消息文案
function t(key, ...args) {
  return browser.i18n.getMessage(key, args.map(String)) || key;
}

const GRID_GROUP_KEY = "gridGroupWindowIds";
const MAX_TILE_TABS = 16;

// 网格窗口重叠补偿：Windows/Chromium 窗口四周有约 7~8px 的不可见拖拽边框，
// 窗口外框严格相邻时可见内容之间会露出约 14~16px 的缝隙。
// 补偿量 = 2 边框宽度（左侧窗口的可见右缘恰好接到右侧窗口的可见左缘），
// 取 15px 可在边框为 7 或 8px 时把误差控制在 ±1px 内（视觉不可见）
const CELL_OVERLAP = 15;

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
  const baseW = Math.floor(availWidth / cols);
  const baseH = Math.floor(availHeight / rows);
  const cells = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // 末行/末列吸收 floor 舍入的余数，保证格线精确
    const cellW = (col < cols - 1 ? baseW : availWidth - (cols - 1) * baseW) + CELL_OVERLAP;
    const cellH = (row < rows - 1 ? baseH : availHeight - (rows - 1) * baseH) + CELL_OVERLAP;
    cells.push({
      left: col * baseW,
      top: row * baseH,
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

// 静音指定标签页（"tabs" 权限已包含 mutedInfo）
async function muteTab(tabId) {
  try {
    const tab = await browser.tabs.update(tabId, { muted: true });
    return tab && tab.mutedInfo && tab.mutedInfo.muted;
  } catch (e) {
    return false;
  }
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

async function openGrid({ url, count, fullscreen, availWidth, availHeight, availLeft, availTop }) {
  const grid = computeGrid(count, availWidth, availHeight);
  const windowIds = [];

  for (let i = 0; i < count; i++) {
    const cell = grid.cells[i];
    const createInfo = {
      url,
      left: cell.left + availLeft,
      top: cell.top + availTop,
      width: cell.width,
      height: cell.height
    };
    const win = await browser.windows.create(createInfo);
    windowIds.push(win.id);
    // 多开页面默认静音
    const muted = await muteTab(win.tabs[0].id);
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
  return { ok: true, cols: grid.cols, rows: grid.rows, windowIds, normUrl: url };
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

// 平铺当前窗口的所有标签页：将标签页拆分到独立窗口（保留页面状态），再整理成网格
// 仅拆分 http/https 标签页（上限 16 个）；存在无法拆分的特殊标签页时原窗口自动保留
async function tileAllTabs({ availWidth, availHeight, availLeft, availTop }) {
  // 先查询并记录原窗口，拆分过程中引用的是标签页/新窗口 ID，不受聚焦变化影响
  const tabs = await browser.tabs.query({ currentWindow: true });
  const tileable = tabs.filter(
    t => t.url && /^https?:\/\//i.test(t.url) && !/^(about:|moz-extension:)/i.test(t.url)
  );

  if (tileable.length === 0) {
    return { ok: false, error: t("errNoTileableTabs") };
  }

  const skipped = tabs.length - tileable.length;
  const limited = tileable.length > MAX_TILE_TABS;
  const targets = tileable.slice(0, MAX_TILE_TABS);

  const grid = computeGrid(targets.length, availWidth, availHeight);
  const windowIds = [];
  let fallbackCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const cell = grid.cells[i];
    let win = null;
    try {
      // 主路径：windows.create({ tabId }) 将现有标签页移入新窗口（保留页面完整状态）
      // 一次调用同时完成"拆分 + 网格定位"，不加载新网页（Firefox 47+ / Chromium 均支持）
      win = await browser.windows.create({
        tabId: targets[i].id,
        left: cell.left + availLeft,
        top: cell.top + availTop,
        width: cell.width,
        height: cell.height,
        focused: false
      });
    } catch (e) {
      // 二级兜底：tabs.move 到新窗口再修正位置
      try {
        const moved = await browser.tabs.move(targets[i].id, {
          windowId: browser.windows.WINDOW_ID_NONE,
          index: -1
        });
        win = moved;
        await browser.windows.update(win.windowId, {
          left: cell.left + availLeft,
          top: cell.top + availTop,
          width: cell.width,
          height: cell.height
        });
      } catch (e2) {
        // 最后兜底：按 URL 重开（页面状态会丢失，仅保证流程不中断）
        try {
          win = await browser.windows.create({
            url: targets[i].url,
            left: cell.left + availLeft,
            top: cell.top + availTop,
            width: cell.width,
            height: cell.height
          });
          fallbackCount++;
        } catch (e3) {
          // 该标签页彻底失败，跳过
        }
      }
    }
    if (win) windowIds.push(win.windowId);
  }

  await setGridGroup(windowIds);

  return {
    ok: true,
    tiledCount: windowIds.length,
    cols: grid.cols,
    rows: grid.rows,
    skipped,
    limited,
    fallbackCount
  };
}

// 解析消息中的显示器矩形（popup 传入 screen.avail*，默认安全值兜底）
function parseMonitorRect(message) {
  return {
    availWidth: Math.max(200, parseInt(message.availWidth, 10) || 1280),
    availHeight: Math.max(200, parseInt(message.availHeight, 10) || 720),
    availLeft: parseInt(message.availLeft, 10) || 0,
    availTop: parseInt(message.availTop, 10) || 0
  };
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "MT_OPEN_GRID": {
          const url = normalizeUrl(message.url);
          if (!url) {
            sendResponse({ ok: false, error: t("errInvalidUrl") });
            return;
          }
          const count = Math.min(16, Math.max(1, parseInt(message.count, 10) || 1));
          sendResponse(
            await openGrid({
              url,
              count,
              fullscreen: !!message.fullscreen,
              ...parseMonitorRect(message)
            })
          );
          return;
        }
        case "MT_CLOSE_GRID": {
          sendResponse(await closeGridGroup());
          return;
        }
        case "MT_TILE_TABS": {
          sendResponse(await tileAllTabs(parseMonitorRect(message)));
          return;
        }
        default:
          sendResponse({ ok: false, error: t("errUnknownMessage") });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  })();
  return true; // 异步响应
});
