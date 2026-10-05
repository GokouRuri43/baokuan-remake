#!/usr/bin/env node
/**
 * extract-xhs-html.js — 从「另存为」的小红书网页 HTML 中提取笔记文本
 *
 * 为什么用它：小红书有登录墙 + 反爬，抓取工具拿不到正文。
 * 但你可以用**已登录的浏览器**正常打开笔记，另存为 HTML —— 本脚本只解析本地文件，不碰网络。
 *
 * 用法：
 *   node scripts/extract-xhs-html.js <input.html>
 *   node scripts/extract-xhs-html.js <input.html> --out <out.md>
 *   node scripts/extract-xhs-html.js a.html b.html --outdir <dir>
 *
 * 输出：规范化的笔记文本（标题 / 正文 / 标签），可直接喂给 scripts/breakdown.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

// ---------- 工具 ----------
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function stripTags(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|section|article|span)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 策略 1：解析 window.__INITIAL_STATE__（小红书把笔记数据注入在这里）
function parseInitialState(html) {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!m) return null;
  const raw = m[1];
  const attempts = [
    () => JSON.parse(raw),
    // 小红书 SSR 会把整个 JSON 再转义一层：{\"global\":...} —— 先反转义再解析
    () => JSON.parse(JSON.parse('"' + raw + '"')),
    () => JSON.parse(raw.replace(/\bundefined\b/g, "null")),
  ];
  for (const fn of attempts) {
    try {
      const v = fn();
      if (v && typeof v === "object") return v;
    } catch {}
  }
  return null;
}

// 策略 1b：`window.__INITIAL_STATE__` 其实是 **JS 字面量**（含 new Map([]) / undefined），
// JSON.parse 必然失败；改为定向抽取字段，且**不 eval 不可信内容**。
function extractFromStateLiteral(html) {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!m) return null;
  const raw = m[1];
  const strRe = (key) => new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "g");

  // 1) 取「最长的 desc」——笔记正文通常是所有 desc 里最长的那个
  let best = { len: 0, value: "", index: -1 };
  for (const mm of raw.matchAll(strRe("desc"))) {
    let v;
    try {
      v = JSON.parse('"' + mm[1] + '"');
    } catch {
      continue;
    }
    if (v.length > best.len) best = { len: v.length, value: v, index: mm.index };
  }
  if (best.len < 20) return null;

  // 2) 同一对象里，title 在 desc 之前 → 取最近的
  let title = "";
  let tIdx = -1;
  for (const mm of raw.matchAll(strRe("title"))) {
    if (mm.index < best.index && mm.index > tIdx) {
      tIdx = mm.index;
      try {
        title = JSON.parse('"' + mm[1] + '"');
      } catch {}
    }
  }

  // 3) tagList 在 desc 之后 → 就近取
  let tags = [];
  const tl = raw.slice(best.index, best.index + 6000).match(/"tagList"\s*:\s*\[([\s\S]*?)\]/);
  if (tl) {
    tags = [...tl[1].matchAll(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
      .map((x) => {
        try {
          return JSON.parse('"' + x[1] + '"');
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
  return { title, desc: best.value, tags };
}

// 在对象树里找「最像笔记」的节点
function findNoteNode(root) {
  let best = null;
  const seen = new Set();
  (function walk(o) {
    if (!o || typeof o !== "object" || seen.has(o)) return;
    seen.add(o);
    if (typeof o.desc === "string" && o.desc.trim().length > 0) {
      const score = o.desc.length + (o.title ? 10 : 0) + (o.tagList ? 5 : 0);
      if (!best || score > best.score) best = { score, node: o };
    }
    for (const k of Object.keys(o)) walk(o[k]);
  })(root);
  return best ? best.node : null;
}

// 组装规范化笔记文本（两个策略共用）：清理话题标记、避免标签重复追加
function composeNote(title, desc, tags) {
  const d = (desc || "")
    .trim()
    .replace(/\[话题\]#?/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  const t = (tags || []).filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  const rest = t.filter((x) => !d.includes("#" + x));
  const parts = [];
  if (title && title.trim()) parts.push(title.trim(), "");
  if (d) parts.push(d, "");
  if (rest.length) parts.push(rest.map((x) => (x.startsWith("#") ? x : "#" + x)).join(" "));
  return { text: parts.join("\n").trim() + "\n", tags: [...new Set(t)] };
}

function buildFromNode(node) {
  const title = (node.title || "").trim();
  let tags = [];
  if (Array.isArray(node.tagList)) {
    tags = node.tagList.map((t) => (typeof t === "string" ? t : t && t.name)).filter(Boolean);
  }
  const composed = composeNote(title, node.desc || "", tags);
  return { text: composed.text, title, tags: composed.tags, strategy: "__INITIAL_STATE__" };
}

// 笔记标题在 DOM 里更可靠（<h1 class="title"> 或 id="detail-title"）
function grabDomTitle(html) {
  const m =
    html.match(/<[^>]*id="detail-title"[^>]*>([\s\S]*?)<\/(?:h1|div|span)>/i) ||
    html.match(/<[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/(?:h1|div|span)>/i);
  if (!m) return "";
  const t = stripTags(m[1]).replace(/\n+/g, " ").trim();
  return t.length >= 2 && t.length <= 80 ? t : "";
}

// 策略 2：从已渲染的 DOM 里抠（class/id 含 title/desc/tag）
function buildFromDom(html) {
  const grab = (re) => {
    const m = html.match(re);
    return m ? stripTags(m[1]).replace(/\n+/g, " ").trim() : "";
  };
  const title = grabDomTitle(html);
  const desc = grab(/<[^>]*id="detail-desc"[^>]*>([\s\S]*?)<\/div>/i) ||
    grab(/<[^>]*(?:id|class)="[^"]*(?:desc|content)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span)>/i);
  // 标签只从正文里取；扫整个 HTML 会抓到 CSS 色值（#000000D9 / #eee 之类）
  const tags = [...desc.matchAll(/#[\u4e00-\u9fa5A-Za-z0-9_]+/g)].map((m) => m[0]);
  const composed = composeNote(title, desc, [...new Set(tags)]);
  return { text: composed.text, title, tags: composed.tags, strategy: "DOM" };
}

function extract(html) {
  // 登录页 / 验证页提示（登录墙的文案形态多样：扫码 / 手机号登录 / 登录后推荐…）
  const loginish =
    /\/login|请登录|扫码|手机号登录|登录后推荐|登录后查看|环境异常|完成验证/.test(html) &&
    !/detail-desc|__INITIAL_STATE__/.test(html);

  const state = parseInitialState(html);
  if (state) {
    const node = findNoteNode(state);
    if (node) return { ...buildFromNode(node), loginish: false };
  }
  // JS 字面量定向抽取（小红书 SSR 的常态：JSON.parse 永远失败）
  const lit = extractFromStateLiteral(html);
  if (lit) {
    const title = grabDomTitle(html) || lit.title;
    const composed = composeNote(title, lit.desc, lit.tags);
    return { text: composed.text, title, tags: composed.tags, strategy: "state-literal", loginish: false };
  }
  const dom = buildFromDom(html);
  if (dom.text.trim().length > 30) return { ...dom, loginish };

  const fallback = stripTags(html);
  return {
    text: fallback.slice(0, 4000) + "\n",
    title: "",
    tags: [],
    strategy: "全文兜底（可能不准）",
    loginish,
  };
}

// ---------- 主流程 ----------
function main() {
  const argv = process.argv.slice(2);
  const files = [];
  let outFile = null;
  let outDir = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") outFile = argv[++i];
    else if (argv[i] === "--outdir") outDir = argv[++i];
    else files.push(argv[i]);
  }
  if (!files.length) {
    console.error("用法: node scripts/extract-xhs-html.js <input.html> [--out <out.md>]");
    console.error("      node scripts/extract-xhs-html.js a.html b.html --outdir <dir>");
    process.exit(1);
  }

  let failed = 0;
  for (const f of files) {
    const p = path.resolve(f);
    if (!fs.existsSync(p)) {
      console.error(`文件不存在: ${p}`);
      failed++;
      continue;
    }
    const html = fs.readFileSync(p, "utf8");
    const r = extract(html);
    // 正文里不放元信息注释，否则会被 breakdown.js 当成标题
    const body = r.text;

    if (files.length === 1 && !outFile && !outDir) {
      console.error(`[${r.strategy}] title: ${r.title || "(笔记无独立标题)"}`);
      console.log(body);
    } else {
      const target = outFile
        ? path.resolve(outFile)
        : path.join(outDir ? path.resolve(outDir) : path.dirname(p), path.basename(p).replace(/\.html?$/i, "") + ".note.md");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body, "utf8");
      console.error(`${path.basename(p)} -> ${target}  [${r.strategy}]${r.loginish ? "  ⚠️ 疑似登录页/未登录" : ""}`);
    }
    if (r.loginish) console.error(`⚠️ ${path.basename(p)}：疑似登录页或验证页，笔记内容可能不完整`);
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { extract, composeNote };
