// 打包脚本：生成用于上传 Firefox 商店和 Edge 商店的压缩包
// 用法：node pack.mjs
// 输出：
//   artifacts/multitab-edge.mv3.zip    （Chromium/Edge 版，根目录文件）
//   artifacts/multitab-firefox.mv3.zip （Firefox 版，dist-firefox/ 内容）
//
// 说明：
//   - Edge 直接读取根目录 manifest.json（service_worker 后台）
//   - Firefox 版由 build-firefox.mjs 生成到 dist-firefox/（background.scripts + gecko ID）
//   - 两个压缩包内容均以 manifest.json 为根目录结构（商店上传要求）

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const distFirefox = join(root, "dist-firefox");
const artifacts = join(root, "artifacts");
const tmp = join(root, "pack-tmp");
const edgeTmp = join(tmp, "edge");
const firefoxZip = join(artifacts, "multitab-firefox.mv3.zip");
const edgeZip = join(artifacts, "multitab-edge.mv3.zip");

function execNode(args) {
  const r = spawnSync("node", args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`Command failed: node ${args.join(" ")}`);
  }
}

function compress(srcDir, outZip) {
  // AMO 要求 zip 条目路径使用 "/" 分隔符，Compress-Archive 在 Windows 上会生成 "\" 导致验证失败，
  // 因此用 .NET ZipArchive 手动逐文件写入并标准化路径。
  // 通过临时 .ps1 文件执行，避免内联命令的引号/转义问题。
  const ps1 = join(tmp, "zip.ps1");
  writeFileSync(
    ps1,
    [
      'Add-Type -AssemblyName System.IO.Compression',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `$root = '${srcDir.replace(/'/g, "''")}'`,
      `$out = '${outZip.replace(/'/g, "''")}'`,
      'if (-not (Test-Path $root)) { throw "Source not found: $root" }',
      "if (Test-Path $out) { Remove-Item $out -Force }",
      '$zip = [System.IO.Compression.ZipFile]::Open($out, "Create")',
      'try {',
      '  Get-ChildItem -Path $root -Recurse -File | ForEach-Object {',
      '    $entryName = $_.FullName.Substring($root.Length + 1).Replace("\\", "/")',
      '    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName) | Out-Null',
      '    Write-Host ("  + " + $entryName)',
      '  }',
      '} finally {',
      '  $zip.Dispose()',
      '}'
    ].join("\r\n"),
    "utf8"
  );
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1],
    { cwd: root, stdio: "inherit" }
  );
  if (r.status !== 0) {
    throw new Error(`Zip creation failed for ${outZip}`);
  }
  rmSync(ps1, { force: true });
}

// 版本号自增：每次打包前 patch 位 +1（1.1.0 -> 1.1.1）
// 以根目录 manifest.json 的 version 为唯一来源，写回后再构建，保证源清单与商店包一致
function bumpVersion() {
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const parts = String(manifest.version).split(".").map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  manifest.version = parts.join(".");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Version bumped to ${manifest.version}`);
  return manifest.version;
}

console.log("Packing store zips...");

// 0. 版本号自动升级 +0.0.1
bumpVersion();

// 1. 清理上次运行可能残留的临时/输出目录（例如中途崩溃遗留的 pack-tmp）
for (const dir of [artifacts, tmp, distFirefox]) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 2. 构建 Firefox 版（Chromium 版清单即根目录文件，无需构建）
execNode(["build-firefox.mjs"]);

// 3. 准备输出目录
mkdirSync(artifacts, { recursive: true });
mkdirSync(tmp, { recursive: true });

// 4. Edge 包：将根目录的可发布文件复制到临时目录再压缩（排除开发用文件）
mkdirSync(edgeTmp, { recursive: true });
const skipTopLevel = new Set([
  "README.md",
  "make-icons.ps1",
  "build-firefox.mjs",
  "pack.mjs",
  "dist-firefox",
  "pack-tmp",
  "artifacts",
  "icons-src",
  ".git",
  ".gitignore"
]);
for (const name of readdirSync(root)) {
  if (skipTopLevel.has(name)) continue;
  cpSync(join(root, name), join(edgeTmp, name), { recursive: true });
}
compress(edgeTmp, edgeZip);

// 5. Firefox 包：压缩 dist-firefox 内容
compress(distFirefox, firefoxZip);

// 6. 清理临时目录
rmSync(tmp, { recursive: true, force: true });

// 7. 校验并输出结果
for (const zip of [firefoxZip, edgeZip]) {
  if (!existsSync(zip)) throw new Error(`Missing artifact: ${zip}`);
  const size = statSync(zip).size;
  console.log(`OK  ${zip}  (${(size / 1024).toFixed(1)} KB)`);
}
console.log("All artifacts ready.");
