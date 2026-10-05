#!/usr/bin/env node
/**
 * capture-xhs.js — 用真实浏览器（CDP）自动抓取小红书页面 HTML，零依赖（Node >= 22）
 *
 * 原理：用 CDP 驱动一个**你自己的浏览器实例**（专用 profile，登录一次后长期有效），
 *      正常加载页面并把 DOM 存成本地 HTML —— 不碰反爬、不伪造签名，登录态天然继承。
 *
 * 用法：
 *   # 1) 首次：启动浏览器并登录小红书（扫一次码，profile 会记住）
 *   node scripts/capture-xhs.js --login
 *
 *   # 2) 按关键词批量抓笔记（自动从搜索结果拿带 xsec_token 的链接）
 *   node scripts/capture-xhs.js --search "减脂餐" --limit 10
 *
 *   # 3) 按 URL 列表抓（每行一个，可含 xsec_token）
 *   node scripts/capture-xhs.js --urls urls.txt
 *
 *   # 4) 附加到已开启调试端口的浏览器
 *   node scripts/capture-xhs.js --attach --port 9222 --search "职场"
 *
 * 产物：notes/<id>.html —— 可直接喂给 scripts/extract-xhs-html.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { composeNote } = require("./extract-xhs-html.js");

const ROOT = path.resolve(__dirname, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 按文件头判断真实图片格式（小红书 CDN 常给 WebP，但 URL 后缀不可靠）
function sniffImageExt(buf) {
  if (buf.length > 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.slice(0, 3).toString("ascii") === "GIF") return "gif";
  return "bin";
}

// ---------- 浏览器定位 ----------
function findBrowser() {
  const cands = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(process.env.LOCALAPPDATA || "", "Microsoft\\Edge\\Application\\msedge.exe"),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error("找不到 Chrome / Edge，可用 --exe <路径> 指定");
}

// ---------- CDP 客户端 ----------
class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(this.wsUrl);
      } catch (e) {
        return reject(new Error("WebSocket 不可用（需要 Node >= 22）：" + e.message));
      }
      this.ws = ws;
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")));
      ws.addEventListener("message", (ev) => {
        let msg;
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
        } catch {
          return;
        }
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        } else if (msg.method) {
          for (const l of this.listeners) l(msg);
        }
      });
    });
  }
  send(method, params = {}, sessionId, timeoutMs = 60000) {
    const id = ++this.seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, timeoutMs);
    });
  }
  on(fn) {
    this.listeners.push(fn);
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

// ---------- 浏览器启动 / 连接 ----------
async function waitForPort(port, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return await r.json();
    } catch {}
    await sleep(500);
  }
  throw new Error(`等不到调试端口 ${port}（浏览器没启动成功？）`);
}

function launchBrowser({ exe, profileDir, port, headless }) {
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking",
    "--disable-features=Translate",
  ];
  if (headless) args.push("--headless=new");
  args.push("about:blank");
  const child = spawn(exe, args, { detached: true, stdio: "ignore" });
  child.unref();
  return child;
}

// ---------- 页面操作 ----------
async function newPage(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  // 注意：**不要**开 Runtime.enable / Page.enable。
  // 小红书页面日志量极大，开启后 CDP 事件会把 WebSocket 淹掉，导致 Runtime.evaluate 长时间无响应。
  // 我们用轮询判断就绪，不需要任何 CDP 事件。
  return { targetId, sessionId };
}

async function evalJs(cdp, sessionId, expression, tries = 2, timeoutMs = 25000) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await cdp.send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
        timeoutMs
      );
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "页面脚本异常");
      return r.result && r.result.value;
    } catch (e) {
      lastErr = e;
      await sleep(1500);
    }
  }
  throw lastErr;
}

async function gotoAndSettle(cdp, sessionId, url, { waitMs = 3500, wantNote = false } = {}) {
  // 注意：小红书页面常让 Page.navigate 不返回响应（风控脚本卡住渲染器），
  // 所以不等它的响应，改为轮询页面就绪状态。
  // 轮询用**短超时 + 不重试**：被风控返回空白页时快速失败，而不是挂几分钟。
  cdp.send("Page.navigate", { url }, sessionId).catch(() => {});
  await sleep(waitMs);
  const t0 = Date.now();
  let evalErrors = 0;
  while (Date.now() - t0 < 30000) {
    let ready = false;
    try {
      ready = await evalJs(
        cdp,
        sessionId,
        wantNote
          ? `!!(document.querySelector('#detail-desc') || window.__INITIAL_STATE__ || document.body.innerText.length > 200)`
          : `document.readyState === 'complete'`,
        1,
        8000
      );
    } catch {
      evalErrors++;
    }
    if (ready) return true;
    await sleep(1000);
  }
  return { ready: false, evalErrors };
}

function isLoginUrl(u) {
  return /\/login|\/404/.test(u || "");
}

// 未登录时页面会内嵌登录面板（URL 不一定跳转），用文案判断最可靠
async function isLoggedOut(cdp, sessionId) {
  try {
    return await evalJs(
      cdp,
      sessionId,
      `/(登录后推荐|登录后查看|扫码登录|手机号登录)/.test(document.body.innerText)`
    );
  } catch {
    return false;
  }
}

// 采集笔记链接：优先从页面状态取「id + xsecToken」（href 里常常没有 token，会 404）
const HARVEST_EXPR = `(() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href*="/explore/"]')) if (a.href) out.push(a.href);
  const S = window.__INITIAL_STATE__ || {};
  const pick = (v) => (v && (v._rawValue || v._value)) || v;
  const lists = [
    pick(S.search && S.search.feeds),
    pick(S.feed && S.feed.feeds),
    pick(S.homefeed && S.homefeed.feeds),
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const it of list) {
      if (!it || typeof it !== 'object') continue;
      const id = it.id || it.noteId || (it.noteCard && (it.noteCard.noteId || it.noteCard.id));
      const tok = it.xsecToken || (it.noteCard && it.noteCard.xsecToken);
      if (id && tok) out.push('/explore/' + id + '?xsec_token=' + encodeURIComponent(tok) + '&xsec_source=pc_search');
    }
  }
  return JSON.stringify([...new Set(out)]);
})()`;

// 从页面状态取笔记正文字段 + 图片（图文帖的正文常常在图片里，必须连图一起取）
const NOTE_STATE_EXPR = `(() => {
  const S = window.__INITIAL_STATE__ || {};
  const pick = (v) => (v && (v._rawValue || v._value)) || v;
  const map = S.note && pick(S.note.noteDetailMap);
  let node = null;
  if (map) {
    const vals = map instanceof Map ? [...map.values()] : Object.values(map || {});
    for (const e of vals) {
      const n = e && (e.note || e);
      if (n && typeof n.desc === 'string' && n.desc.length) { node = n; break; }
    }
  }
  if (!node) return JSON.stringify({});
  const tags = Array.isArray(node.tagList) ? node.tagList.map(t => t && t.name).filter(Boolean) : [];
  const images = Array.isArray(node.imageList) ? node.imageList.map(img => {
    if (!img) return null;
    const info = Array.isArray(img.infoList) ? img.infoList : [];
    const dft = info.find(x => x && x.imageScene === 'WB_DFT') || info[0];
    return (dft && dft.url) || img.urlDefault || img.urlPre || null;
  }).filter(Boolean) : [];
  return JSON.stringify({ title: node.title || '', desc: node.desc || '', tags, images, type: node.type || '' });
})()`;

// ---------- 主流程 ----------
async function main() {
  const argv = process.argv.slice(2);
  const opt = { port: 9222, outdir: "notes", limit: 12, headless: false, attach: false, login: false, images: true, delay: 2500 };
  let search = null;
  let urlsArg = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--search") search = argv[++i];
    else if (a === "--urls") urlsArg = argv[++i];
    else if (a === "--limit") opt.limit = parseInt(argv[++i], 10);
    else if (a === "--outdir") opt.outdir = argv[++i];
    else if (a === "--port") opt.port = parseInt(argv[++i], 10);
    else if (a === "--profile") opt.profile = argv[++i];
    else if (a === "--exe") opt.exe = argv[++i];
    else if (a === "--headless") opt.headless = true;
    else if (a === "--attach") opt.attach = true;
    else if (a === "--feed") opt.feed = true;
    else if (a === "--dump-links") opt.dumpLinks = true;
    else if (a === "--delay") opt.delay = parseInt(argv[++i], 10);
    else if (a === "--no-images") opt.images = false;
    else if (a === "--login") opt.login = true;
    else if (!search && !urlsArg && !a.startsWith("--")) urlsArg = a;
  }

  const outdir = path.resolve(ROOT, opt.outdir);
  fs.mkdirSync(outdir, { recursive: true });
  const profileDir = path.resolve(opt.profile || path.join(ROOT, ".browser-profile"));

  // 1. 起浏览器 / 连浏览器
  if (!opt.attach) {
    let ver = null;
    try {
      ver = await waitForPort(opt.port, 1200);
    } catch {}
    if (!ver) {
      const exe = opt.exe || findBrowser();
      console.error(`启动浏览器: ${exe}`);
      console.error(`  调试端口 ${opt.port} / profile ${profileDir}`);
      launchBrowser({ exe, profileDir, port: opt.port, headless: opt.headless });
      ver = await waitForPort(opt.port);
    }
    console.error(`已连接: ${ver.Browser} (${ver["Web Contents"] ?? "?"})`);
  } else {
    const ver = await waitForPort(opt.port);
    console.error(`已附加: ${ver.Browser}`);
  }

  const ver = await (await fetch(`http://127.0.0.1:${opt.port}/json/version`)).json();
  const cdp = new CDP(ver.webSocketDebuggerUrl);
  await cdp.connect();

  // 启动时清理遗留标签页：长时间运行后标签页堆积会让渲染器卡死（Runtime.evaluate 超时）
  try {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const stale = (targetInfos || []).filter(
      (t) => t.type === "page" && (t.url === "about:blank" || /xiaohongshu\.com/.test(t.url || ""))
    );
    // 必须保留至少一个标签页：全部关掉会让浏览器退出，后续 createTarget 会超时
    let closedTabs = 0;
    for (const t of stale.slice(0, Math.max(0, stale.length - 1))) {
      await cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
      closedTabs++;
    }
    if (closedTabs) console.error(`已清理 ${closedTabs} 个遗留标签页`);
  } catch {}

  // 2. --login：打开小红书，等用户扫码
  if (opt.login) {
    const { sessionId, targetId } = await newPage(cdp);
    cdp.send("Page.navigate", { url: "https://www.xiaohongshu.com/explore" }, sessionId).catch(() => {});
    console.error("\n👉 浏览器已打开。请在窗口里**登录小红书**（扫码一次即可）。");
    console.error("   登录完成后本脚本会自动保存 profile，之后无需再登录。\n");
    const t0 = Date.now();
    let logged = false;
    let tick = 0;
    while (Date.now() - t0 < 300000) {
      await sleep(3000);
      if (!(await isLoggedOut(cdp, sessionId))) {
        logged = true;
        break;
      }
      const el = Math.round((Date.now() - t0) / 1000);
      if (el - tick >= 15) {
        tick = el;
        console.error(`  仍在等待扫码登录… 已等 ${el}s`);
      }
    }
    console.error(logged ? "✅ 已登录，profile 已保存。" : "⚠️ 5 分钟内未检测到登录完成。");
    await cdp.send("Target.closeTarget", { targetId });
    cdp.close();
    process.exit(logged ? 0 : 1);
  }

  // 3. 收集目标 URL —— 全程复用同一个标签页
  // （每篇笔记都新建标签会让浏览器逐渐卡死，出现 Target.createTarget 超时）
  const page = await newPage(cdp);
  const sessionId = page.sessionId;
  let targets = [];
  if (search || opt.feed) {
    const url = search
      ? `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(search)}&source=web_explore_feed`
      : `https://www.xiaohongshu.com/explore`;
    console.error(search ? `搜索: ${search}` : "抓取首页推荐流");
    const settled = await gotoAndSettle(cdp, sessionId, url, { waitMs: 9000 });
    if (settled !== true) {
      console.error(
        `⚠️ 页面 30s 未渲染（evaluate 失败 ${settled.evalErrors} 次）。` +
          "常见原因：小红书风控限流（搜索页返回空白）。建议：等待冷却 10-30 分钟，或降低抓取频率。"
      );
    }
    const cur = await evalJs(cdp, sessionId, "location.href");
    if (isLoginUrl(cur) || (await isLoggedOut(cdp, sessionId))) {
      console.error("❌ 未登录（页面提示「登录后推荐 / 登录后查看」）。请先运行: node scripts/capture-xhs.js --login");
      await cdp.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
      process.exit(2);
    }
    // 限流检测：小红书会返回「请求太频繁，请一分钟后再试」（feed 与 search 都可能中）
    try {
      const limited = await evalJs(
        cdp,
        sessionId,
        `document.body.innerText.includes('请求太频繁') || !!document.querySelector('[class*=captcha]')`
      );
      if (limited) {
        console.error("⛔ 触发小红书限流：「请求太频繁，请一分钟后再试」。");
        console.error("   → 已抓到的内容仍有效。请冷却 15–30 分钟后重试，并降低频率");
        console.error("     （建议 --delay 5000 以上，批次之间间隔 ≥5 分钟）。");
        await cdp.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
        process.exit(3);
      }
    } catch {}
    // 推荐流是懒加载，需要滚动几屏
    if (!search) {
      for (let s = 0; s < 5; s++) {
        await evalJs(cdp, sessionId, "window.scrollTo(0, document.body.scrollHeight)");
        await sleep(2000);
      }
    }
    const hrefs = await evalJs(cdp, sessionId, HARVEST_EXPR);
    const raw = JSON.parse(hrefs || "[]").map((u) => {
      try {
        return new URL(u, "https://www.xiaohongshu.com").href;
      } catch {
        return u;
      }
    });
    // 去重：同一笔记常有「带 token / 不带 token」两个链接，优先保留带 xsec_token 的
    const byId = new Map();
    for (const u of raw) {
      const m = u.match(/\/explore\/([0-9a-f]{16,})/);
      const key = m ? m[1] : u;
      const prev = byId.get(key);
      if (!prev || (!prev.includes("xsec_token") && u.includes("xsec_token"))) byId.set(key, u);
    }
    const list = [...byId.values()];
    const withTok = list.filter((u) => u.includes("xsec_token"));
    console.error(`去重后 ${list.length} 条，带 xsec_token ${withTok.length} 条`);
    if (opt.dumpLinks) {
      console.error("--- 抓到的链接（前 15 条） ---");
      list.slice(0, 15).forEach((u) => console.error(u));
      await cdp.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
      cdp.close();
      process.exit(0);
    }
    // 没 token 的笔记页会 404，优先只用带 token 的
    targets = (withTok.length ? withTok : list).slice(0, opt.limit);
    console.error(`拿到 ${list.length} 条链接，取前 ${targets.length} 条`);
  } else if (urlsArg) {
    const p = path.resolve(urlsArg);
    targets = fs.existsSync(p)
      ? fs.readFileSync(p, "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => /^https?:/.test(s))
      : urlsArg.split(",").map((s) => s.trim()).filter((s) => /^https?:/.test(s));
  }

  if (!targets.length) {
    console.error("没有可抓取的目标。用 --search <关键词> 或 --urls <文件|逗号列表>。");
    cdp.close();
    process.exit(1);
  }

  // 4. 逐个抓取
  let ok = 0;
  let blocked = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const idm = t.match(/\/explore\/([0-9a-f]{16,})/) || t.match(/\/item\/([0-9a-f]{16,})/);
    const name = `${String(i + 1).padStart(2, "0")}-${idm ? idm[1].slice(0, 8) : "note"}.html`;
    const outFile = path.join(outdir, name);
    try {
      await gotoAndSettle(cdp, sessionId, t, { waitMs: 4000, wantNote: true });
      const cur = await evalJs(cdp, sessionId, "location.href");
      const html = await evalJs(cdp, sessionId, "document.documentElement.outerHTML");
      if (isLoginUrl(cur) || (await isLoggedOut(cdp, sessionId))) {
        blocked++;
        console.error(`[${i + 1}/${targets.length}] ⛔ 被拦截/需登录: ${cur.slice(0, 100)}`);
      } else {
        fs.writeFileSync(outFile, html, "utf8");
        // 直接从页面状态写干净的 .note.md（比事后解析 HTML 可靠）
        let st = {};
        try {
          st = JSON.parse((await evalJs(cdp, sessionId, NOTE_STATE_EXPR)) || "{}");
        } catch {}
        const extras = [];
        if (st.desc || st.title) {
          fs.writeFileSync(outFile.replace(/\.html$/, ".note.md"), composeNote(st.title, st.desc, st.tags).text, "utf8");
          extras.push("note.md");
        }
        // 下载图片：图文帖的正文常常在图片里，配合 references/screenshot-ocr.md 做视觉转写
        if (opt.images && Array.isArray(st.images) && st.images.length) {
          const dir = path.join(outdir, "images", path.basename(outFile, ".html"));
          fs.mkdirSync(dir, { recursive: true });
          let n = 0;
          for (const u of st.images) {
            n++;
            try {
              const res = await fetch(u, { headers: { referer: "https://www.xiaohongshu.com/" } });
              if (!res.ok) throw new Error("HTTP " + res.status);
              const buf = Buffer.from(await res.arrayBuffer());
              const ext = sniffImageExt(buf);
              fs.writeFileSync(path.join(dir, String(n).padStart(2, "0") + "." + ext), buf);
            } catch (e) {
              console.error(`     图片 ${n} 下载失败: ${e.message}`);
            }
          }
          extras.push(n + " 张图");
        }
        ok++;
        console.error(
          `[${i + 1}/${targets.length}] ✅ ${name}  (${html.length} 字符${extras.length ? " + " + extras.join(" + ") : ""})`
        );
      }
    } catch (e) {
      console.error(`[${i + 1}/${targets.length}] ❌ ${e.message}`);
    }
    await sleep(opt.delay); // 限速，别把账号搞风控（--delay 可调，默认 2500ms）
  }
  await cdp.send("Target.closeTarget", { targetId: page.targetId }).catch(() => {});

  cdp.close();
  console.error(`\n完成：成功 ${ok} 条，失败/拦截 ${blocked + (targets.length - ok - blocked)} 条 -> ${outdir}`);
  console.error(`下一步：node scripts/extract-xhs-html.js ${path.relative(ROOT, outdir)}/*.html --outdir out`);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("错误: " + e.message);
    process.exit(1);
  });
}

module.exports = { CDP, waitForPort, newPage, evalJs, gotoAndSettle, isLoginUrl, isLoggedOut, findBrowser, launchBrowser };
