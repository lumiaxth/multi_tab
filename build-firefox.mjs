// Firefox 构建脚本：生成 dist-firefox/ 目录
// 用法：node build-firefox.mjs
// 说明：
//   - 根目录 manifest.json 是 Chromium(Edge/Chrome) 版，后台为 service_worker
//   - Firefox MV3 用 background.scripts（事件页），并需要 browser_specific_settings 提供扩展 ID
//   - 本脚本生成 Firefox 专用的 dist-firefox/ 目录

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist-firefox");

console.log("Building dist-firefox/ ...");

if (existsSync(dist)) {
  rmSync(dist, { recursive: true, force: true });
}
mkdirSync(dist, { recursive: true });

// 读取 Chromium 清单并转换为 Firefox 版
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

const firefoxManifest = {
  ...manifest,
  background: {
    scripts: ["background.js"]
  },
  browser_specific_settings: {
    gecko: {
      id: "multi-tab@opencode.local",
      // AMO 要求声明 data_collection_permissions，该字段仅 Firefox 140+（Android 142+）支持，
      // 故最低版本需提升到 142.0
      strict_min_version: "142.0",
      data_collection_permissions: {
        required: ["none"]
      }
    }
  }
};

writeFileSync(
  join(dist, "manifest.json"),
  JSON.stringify(firefoxManifest, null, 2) + "\n"
);

// 复制其余文件（不含根清单、构建脚本、生成脚本、文档）
const skipTopLevel = new Set([
  "manifest.json",
  "build-firefox.mjs",
  "pack.mjs",
  "make-icons.ps1",
  "README.md",
  "artifacts",
  "dist-firefox",
  "pack-tmp",
  "icons-src",
  ".git",
  ".gitignore"
]);
for (const name of readdirSync(root)) {
  if (skipTopLevel.has(name)) continue;
  cpSync(join(root, name), join(dist, name), { recursive: true });
}

console.log("Done. Output:", dist);
console.log("Load in Firefox: about:debugging -> This Firefox -> Load Temporary Add-on -> dist-firefox/manifest.json");
