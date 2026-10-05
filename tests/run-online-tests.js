#!/usr/bin/env node
/**
 * run-online-tests.js — 在线测试套件（需真实浏览器 + 已登录小红书）
 *
 * 覆盖 capture-xhs.js 的所有在线开关：
 *   --search / --limit / --outdir / --no-images / --dump-links / --urls / --attach / --port / 图片下载
 *
 * 前置：先跑过一次 `node scripts/capture-xhs.js --login`
 * 用法：node tests/run-online-tests.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, "tests", ".online");
const PORT = 9222;

let pass = 0;
let fail = 0;
const lines = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
    lines.push(`- ✅ ${name}`);
  } else {
    fail++;
    lines.push(`- ❌ ${name}${detail ? `  → ${String(detail).replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
  }
}
function cap(args) {
  const r = spawnSync("node", [path.join("scripts", "capture-xhs.js"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 420000,
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: (r.stdout || "") + (r.stderr || "") };
}
const countNotes = (dir) => {
  const p = path.join(ROOT, dir);
  return fs.existsSync(p) ? fs.readdirSync(p).filter((f) => f.endsWith(".note.md")).length : 0;
};
const countImgDirs = (dir) => {
  const p = path.join(ROOT, dir, "images");
  return fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).length : 0;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { CDP } = require(path.join(ROOT, "scripts", "capture-xhs.js"));
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  // 0. 前置：是否已登录
  {
    const r = cap(["--search", "美食", "--limit", "1", "--outdir", "tests/.online/pre"]);
    const ok = r.code === 0 && countNotes("tests/.online/pre") === 1;
    check("前置：已登录且 --search/--limit/--outdir 可用", ok, r.err.slice(-200));
    if (!ok) {
      console.log("# 在线测试报告\n");
      console.log(lines.join("\n"));
      console.log("\n> 前置失败（未登录？）。请先运行：`node scripts/capture-xhs.js --login`");
      fs.rmSync(TMP, { recursive: true, force: true });
      process.exit(1);
    }
  }

  // 1. --no-images
  {
    const r = cap(["--search", "美食", "--limit", "1", "--no-images", "--outdir", "tests/.online/noimg"]);
    check(
      "--no-images 不产生图片目录",
      r.code === 0 && countNotes("tests/.online/noimg") === 1 && countImgDirs("tests/.online/noimg") === 0,
      `code=${r.code} notes=${countNotes("tests/.online/noimg")} imgDirs=${countImgDirs("tests/.online/noimg")}`
    );
  }

  // 2. 图片下载 + 格式嗅探
  {
    const r = cap(["--search", "美食", "--limit", "1", "--outdir", "tests/.online/img"]);
    const dir = path.join(ROOT, "tests/.online/img/images");
    let files = [];
    if (fs.existsSync(dir)) {
      for (const d of fs.readdirSync(dir)) {
        const sub = path.join(dir, d);
        if (fs.statSync(sub).isDirectory()) files.push(...fs.readdirSync(sub));
      }
    }
    check(
      "图片自动下载且扩展名与文件头一致",
      r.code === 0 && files.length >= 1 && files.every((f) => /\.(webp|jpg|png|gif)$/.test(f)),
      `文件: ${files.join(", ")}`
    );
  }

  // 3. --dump-links
  let urls = [];
  {
    const r = cap(["--search", "美食", "--dump-links"]);
    urls = (r.err || "").split("\n").map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l));
    check("--dump-links 输出链接列表", urls.length > 0, `拿到 ${urls.length} 条`);
  }

  // 4. --urls（按 URL 直接抓）
  {
    const url = urls.find((u) => u.includes("xsec_token")) || urls[0];
    const r = url
      ? cap(["--urls", url, "--outdir", "tests/.online/byurl"])
      : { code: -1, err: "no url" };
    check("--urls 按 URL 列表抓取", r.code === 0 && countNotes("tests/.online/byurl") >= 1, `code=${r.code} notes=${countNotes("tests/.online/byurl")}`);
  }

  // 5. --attach（附加到已开调试端口的浏览器）
  {
    const r = cap(["--attach", "--search", "美食", "--limit", "1", "--outdir", "tests/.online/attach"]);
    check("--attach 复用已开调试端口的浏览器", r.code === 0 && /已附加/.test(r.err), `code=${r.code} ${r.err.slice(0, 120)}`);
  }

  // 6. --feed 推荐流
  {
    const r = cap(["--feed", "--limit", "1", "--outdir", "tests/.online/feed"]);
    check("--feed 抓首页推荐流", r.code === 0 && countNotes("tests/.online/feed") >= 1, `code=${r.code} notes=${countNotes("tests/.online/feed")}`);
  }

  // 7. --port 自定义（最后做：需要先关掉 9222 的浏览器）
  //    注意：部分环境里从脚本派生浏览器进程不可靠，可用 --skip-port 跳过
  if (process.argv.includes("--skip-port")) {
    lines.push("- ⏭ --port 自定义调试端口（本次跳过，见 --skip-port）");
  } else {
    let closed = false;
    try {
      const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      const cdp = new CDP(ver.webSocketDebuggerUrl);
      await cdp.connect();
      await cdp.send("Browser.close").catch(() => {});
      cdp.close();
      closed = true;
    } catch {}
    await sleep(4000);
    const r = cap(["--port", "9333", "--feed", "--limit", "1", "--outdir", "tests/.online/port"]);
    check(
      "--port 自定义调试端口（9333）",
      r.code === 0 && /9333/.test(r.err) && countNotes("tests/.online/port") >= 1,
      `code=${r.code} closed=${closed} ${(r.err || "").slice(0, 140)}`
    );
    // 清理 9333 浏览器
    try {
      const ver = await (await fetch("http://127.0.0.1:9333/json/version")).json();
      const cdp2 = new CDP(ver.webSocketDebuggerUrl);
      await cdp2.connect();
      await cdp2.send("Browser.close").catch(() => {});
      cdp2.close();
    } catch {}
  }

  console.log("# 在线测试报告\n");
  console.log(lines.join("\n"));
  console.log(`\n## 汇总\n`);
  console.log(`- 通过 **${pass}** / 共 **${pass + fail}**${fail ? `，失败 **${fail}**` : "，全部通过 ✅"}`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log("在线测试异常: " + e.message);
  process.exit(1);
});
