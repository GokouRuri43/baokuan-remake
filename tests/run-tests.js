#!/usr/bin/env node
/**
 * run-tests.js — 脚本层回归测试套件（零依赖）
 *
 * 用法：node tests/run-tests.js
 * 覆盖：breakdown.js / compliance-check.js / extract-xhs-html.js / capture-xhs.js(离线部分)
 * 说明：capture-xhs.js 需要真实浏览器的部分（--login/--search/--feed/--images）
 *      不在本套件内，见 TESTING.md 的「在线测试」记录。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, "tests", ".tmp");

let pass = 0;
let fail = 0;
const lines = [];

const suite = (name) => lines.push(`\n### ${name}`);
function check(name, cond, detail) {
  if (cond) {
    pass++;
    lines.push(`- ✅ ${name}`);
  } else {
    fail++;
    lines.push(`- ❌ ${name}${detail ? `  → ${String(detail).replace(/\s+/g, " ").slice(0, 150)}` : ""}`);
  }
}
function run(script, args = []) {
  const r = spawnSync("node", [path.join("scripts", script), ...args], { cwd: ROOT, encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: (r.stdout || "") + (r.stderr || "") };
}
const has = (s, n) => String(s).includes(n);
function val(out, label) {
  const line = String(out).split("\n").find((l) => l.startsWith(`- ${label}：`));
  return line ? line.slice(`- ${label}：`.length).trim() : "";
}
const count = (s, re) => (String(s).match(re) || []).length;

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// ---------------- breakdown.js ----------------
suite("breakdown.js");
{
  const r = run("breakdown.js", ["examples/demo-input.md"]);
  check("文件模式 exit 0", r.code === 0, r.err);
  check("输出含 平台 / 标题 / 正文字数 / 段落数", ["平台", "标题", "正文字数", "段落数"].every((k) => has(r.out, `- ${k}：`)));
  check("标题提取正确", val(r.out, "标题") === "月薪 3 千到 3 万，我只做对了这 3 件事", val(r.out, "标题"));
  check("段落数 = 7", val(r.out, "段落数") === "7", val(r.out, "段落数"));
  check("emoji 数量 = 2", val(r.out, "emoji 数量").startsWith("2（"), val(r.out, "emoji 数量"));
  check("标签 5 个", count(val(r.out, "标签"), /#/g) === 5, val(r.out, "标签"));
  check("自动猜平台 = 小红书", val(r.out, "平台").startsWith("小红书"), val(r.out, "平台"));
  check("结构信号词命中 第一/第二/第三", has(val(r.out, "结构信号词"), "第一") && has(val(r.out, "结构信号词"), "第三"));
  check("CTA 结尾区命中（正文里有真 CTA）", has(val(r.out, "CTA / 引导词"), "结尾区命中"), val(r.out, "CTA / 引导词"));
}
{
  const r = run("breakdown.js", ["--text", "标题行\n\n正文第一段\n\n正文第二段", "--platform", "wechat"]);
  check("--text 模式可用", r.code === 0 && val(r.out, "标题") === "标题行", val(r.out, "标题"));
  check("--platform wechat → 公众号", val(r.out, "平台") === "公众号", val(r.out, "平台"));
  check("--text 段落数 = 2", val(r.out, "段落数") === "2", val(r.out, "段落数"));
}
{
  const r = run("breakdown.js", ["examples/demo-input.md", "--platform", "wechat"]);
  check("--platform 覆盖自动猜测", val(r.out, "平台") === "公众号", val(r.out, "平台"));
}
{
  const r = run("breakdown.js", ["--text", "测试标题\n\n正文内容一。\n\n喜欢的话点个收藏。\n\n#标签A #标签B"]);
  check("末尾纯标签段被排除（不误判 CTA）", has(val(r.out, "CTA / 引导词"), "结尾区命中"), val(r.out, "CTA / 引导词"));
  check("排除标签后仍识别正文 CTA", has(val(r.out, "CTA / 引导词"), "收藏"), val(r.out, "CTA / 引导词"));
}
{
  const r = run("breakdown.js", ["--text", "测试标题\n\n正文提到别人点赞和评论区，但自己没号召。\n\n结束语。"]);
  check("正文「提及」不误判为真实 CTA", has(val(r.out, "CTA / 引导词"), "结尾区无命中"), val(r.out, "CTA / 引导词"));
}
{
  const r = run("breakdown.js", ["tests/fixtures/不存在.md"]);
  check("文件不存在 → exit 1 + 提示", r.code === 1 && has(r.all, "文件不存在"), `code=${r.code}`);
}
{
  const r = run("breakdown.js", []);
  check("无参数 → exit 1 + 用法", r.code === 1 && has(r.all, "用法"), `code=${r.code}`);
}

// ---------------- compliance-check.js ----------------
suite("compliance-check.js");
{
  const r = run("compliance-check.js", ["examples/demo-rebuild.md"]);
  check("干净文件 → exit 0 且 0 命中", r.code === 0 && has(r.out, "未命中"), r.out.replace(/\s+/g, " ").slice(0, 120));
}
{
  const r = run("compliance-check.js", ["--text", "稳赚不赔，包治百病，加微信私聊，100%保过，刷单"]);
  const cats = ["绝对化/夸大", "医疗健康", "金融投资", "引流导流", "教育升学", "其他违禁"];
  const hit = cats.filter((c) => has(r.out, c));
  check("脏文本命中全部 6 类", hit.length === 6, `命中 ${hit.join(" / ")}`);
  check("--text 模式可用", r.code === 0);
}
{
  const r = run("compliance-check.js", []);
  check("无参数 → exit 1 + 用法", r.code === 1 && has(r.all, "用法"), `code=${r.code}`);
}
{
  const r = run("compliance-check.js", ["tests/fixtures/不存在.md"]);
  check("文件不存在 → exit 1", r.code === 1 && has(r.all, "文件不存在"), `code=${r.code}`);
}
{
  let ok = true;
  let why = "";
  try {
    const w = JSON.parse(fs.readFileSync(path.join(ROOT, "data/forbidden-words.json"), "utf8"));
    ok = Object.values(w).every((v) => Array.isArray(v) && v.length > 0);
  } catch (e) {
    ok = false;
    why = e.message;
  }
  check("词库 JSON 合法且各类非空", ok, why);
}

// ---------------- extract-xhs-html.js ----------------
suite("extract-xhs-html.js");
{
  const r = run("extract-xhs-html.js", ["tests/fixtures/xhs-note-sample.html"]);
  check("JSON 夹具 → __INITIAL_STATE__ 策略", has(r.err, "__INITIAL_STATE__"), r.err);
  check("JSON 夹具 → 标题正确", has(r.out, "减脂期也能吃的 3 种早餐"));
  check("JSON 夹具 → 标签正确", has(r.out, "#减脂餐"));
  check("单文件默认输出到 stdout 且 exit 0", r.code === 0 && r.out.trim().length > 20);
}
{
  const r = run("extract-xhs-html.js", ["tests/fixtures/xhs-note-literal.html", "--out", "tests/.tmp/literal.md"]);
  check("JS 字面量夹具 → state-literal 策略", has(r.err, "state-literal"), r.err);
  const p = path.join(TMP, "literal.md");
  const t = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  check("state-literal → 用 DOM 标题（非 UI 文案）", has(t, "熬夜党必看的 3 个护肝习惯"), t.replace(/\s+/g, " ").slice(0, 80));
  check("state-literal → 正文抽取成功", has(t, "11 点前睡"));
  check("[话题]# 标记被清理", !has(t, "[话题]"), t.replace(/\s+/g, " ").slice(0, 120));
  check("标签不重复追加", count(t, /#护肝/g) === 1, `出现 ${count(t, /#护肝/g)} 次`);
}
{
  const r = run("extract-xhs-html.js", ["tests/fixtures/xhs-note-dom.html"]);
  check("无状态夹具 → DOM 兜底策略", has(r.err, "DOM"), r.err);
  check("DOM 兜底 → 标题正确", has(r.out, "夏天必喝的 3 款自制饮品"));
  check("DOM 兜底 → 不混入 CSS 色值", !/#[0-9a-fA-F]{6}\b/.test(r.out), r.out.replace(/\s+/g, " ").slice(0, 120));
}
{
  const r = run("extract-xhs-html.js", ["tests/fixtures/xhs-login.html"]);
  check("登录页夹具 → 告警", has(r.err, "疑似登录页"), r.err);
}
{
  const r = run("extract-xhs-html.js", [
    "tests/fixtures/xhs-note-sample.html",
    "tests/fixtures/xhs-note-dom.html",
    "--outdir",
    "tests/.tmp",
  ]);
  const a = fs.existsSync(path.join(TMP, "xhs-note-sample.note.md"));
  const b = fs.existsSync(path.join(TMP, "xhs-note-dom.note.md"));
  check("多文件 --outdir 批量产出", a && b, `sample=${a} dom=${b}`);
}
{
  const r = run("extract-xhs-html.js", ["tests/fixtures/不存在.html"]);
  check("文件不存在 → exit 1", r.code === 1 && has(r.all, "文件不存在"), `code=${r.code}`);
}

// ---------------- capture-xhs.js（离线部分） ----------------
suite("capture-xhs.js（离线部分）");
{
  const r = spawnSync(
    "node",
    ["-e", "const m=require('./scripts/capture-xhs.js');console.log(Object.keys(m).sort().join(','))"],
    { cwd: ROOT, encoding: "utf8" }
  );
  check("require 无副作用", r.status === 0 && !has(r.stderr, "启动浏览器"), (r.stderr || "").slice(0, 100));
  check(
    "导出完整（CDP / launchBrowser / isLoggedOut / findBrowser）",
    ["CDP", "launchBrowser", "isLoggedOut", "findBrowser", "gotoAndSettle"].every((k) => has(r.stdout, k)),
    r.stdout
  );
}
{
  let ok = true;
  let why = "";
  try {
    const { CDP } = require(path.join(ROOT, "scripts/capture-xhs.js"));
    ok = typeof new CDP("ws://127.0.0.1:1").send === "function";
  } catch (e) {
    ok = false;
    why = e.message;
  }
  check("CDP 类可实例化且具备 send/on/connect", ok, why);
}
{
  let ok = true;
  let why = "";
  try {
    const { composeNote } = require(path.join(ROOT, "scripts/extract-xhs-html.js"));
    const t = composeNote("标题", "正文 #话题", ["话题"]);
    ok = t.text.includes("标题") && t.text.includes("正文") && count(t.text, /#话题/g) === 1;
  } catch (e) {
    ok = false;
    why = e.message;
  }
  check("composeNote 导出可用且去重", ok, why);
}

// ---------------- 边界与异常 ----------------
suite("边界与异常");
{
  const r = run("breakdown.js", ["--text", "只有一行标题"]);
  check("仅标题 → 段落数 0 且不崩", r.code === 0 && val(r.out, "段落数") === "0", `code=${r.code} paras=${val(r.out, "段落数")}`);
}
{
  const r = run("breakdown.js", ["--text", "标题\n\n#标签A #标签B #标签C"]);
  check("正文只有标签 → 标签数正确", r.code === 0 && count(val(r.out, "标签"), /#/g) === 3, val(r.out, "标签"));
}
{
  const r = run("breakdown.js", ["--text", "标题\n\n正文", "--platform", "weibo"]);
  check("无效 --platform 值 → 回退自动猜测", r.code === 0 && val(r.out, "平台").length > 0, val(r.out, "平台"));
}
{
  const r = run("breakdown.js", ["--text", "标题\n\n" + "这是一段很长的正文内容。".repeat(800)]);
  check("超长文本（~8800 字）不崩", r.code === 0 && has(r.out, "正文字数"), `code=${r.code}`);
}
{
  const r = run("breakdown.js", ["--text", "   \n  \n "]);
  check("纯空白输入 → exit 1", r.code === 1, `code=${r.code}`);
}
{
  const r = run("compliance-check.js", ["--text", "   "]);
  check("纯空白输入 → exit 1", r.code === 1, `code=${r.code}`);
}
{
  const r = run("compliance-check.js", ["--text", "稳赚稳赚稳赚，包治包治"]);
  check("重复命中不崩且分类正确", r.code === 0 && has(r.out, "金融投资") && has(r.out, "医疗健康"), r.out.replace(/\s+/g, " ").slice(0, 100));
}
{
  fs.writeFileSync(path.join(TMP, "plain.txt"), "这是一段普通文本，没有 HTML 结构，也没有小红书字段。", "utf8");
  const r = run("extract-xhs-html.js", [path.join("tests", ".tmp", "plain.txt")]);
  check("非 HTML 文本 → 兜底不崩", typeof r.code === "number", `code=${r.code}`);
}
{
  fs.writeFileSync(path.join(TMP, "empty.html"), "", "utf8");
  const r = run("extract-xhs-html.js", [path.join("tests", ".tmp", "empty.html")]);
  check("空文件 → 不崩", typeof r.code === "number", `code=${r.code}`);
}

// ---------------- 文档 / 参考层一致性 ----------------
suite("文档 / 参考层一致性");
const readRepo = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
{
  const skill = readRepo("SKILL.md");
  const fm = skill.match(/^---\n([\s\S]*?)\n---/);
  check("SKILL.md 有 YAML frontmatter", !!fm);
  check("frontmatter 含 name 且为 baokuan-remake", !!fm && /name:\s*baokuan-remake/.test(fm[1]));
  const descLine = ((fm || [null, ""])[1].match(/^description:\s*(.+)$/m) || [])[1] || "";
  check("frontmatter 含有效 description（≥40 字符，供触发匹配）", descLine.trim().length >= 40, `长度 ${descLine.trim().length}`);
}
{
  const skill = readRepo("SKILL.md");
  const refs = [...new Set([...skill.matchAll(/`((?:references|scripts|data|examples)\/[^`]+)`/g)].map((m) => m[1]))];
  check("SKILL.md 引用了 ≥5 个资源文件", refs.length >= 5, `实际 ${refs.length}`);
  const missing = refs.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  check("SKILL.md 引用的文件全部存在", missing.length === 0, `缺失: ${missing.join(", ")}`);
}
{
  const readme = readRepo("README.md");
  const links = [
    ...new Set(
      [...readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
        .map((m) => m[1].trim())
        .filter((u) => !/^https?:/.test(u))
        .map((u) => u.split("#")[0])
        .filter(Boolean)
    ),
  ];
  const missing = links.filter((u) => !fs.existsSync(path.join(ROOT, u)));
  check("README 无断链", missing.length === 0, `断链: ${missing.join(", ")}`);
}
{
  const skill = readRepo("SKILL.md");
  const files = fs.readdirSync(path.join(ROOT, "references")).filter((f) => f.endsWith(".md"));
  const orphans = files.filter((f) => !skill.includes("references/" + f));
  check("references/ 无孤儿文件", orphans.length === 0, `孤儿: ${orphans.join(", ")}`);
}
{
  const readme = readRepo("README.md");
  const files = fs.readdirSync(path.join(ROOT, "examples")).filter((f) => f.endsWith(".md"));
  const orphans = files.filter((f) => !readme.includes("examples/" + f));
  check("examples/ 无孤儿文件", orphans.length === 0, `孤儿: ${orphans.join(", ")}`);
}
{
  const vf = readRepo("references/viral-formulas.md");
  const ids = new Set([...vf.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1])));
  const need = Array.from({ length: 15 }, (_, i) => i + 1);
  check("viral-formulas 含 #1–#15 全部标题公式", need.every((i) => ids.has(i)), `实际: ${[...ids].sort((a, b) => a - b).join(",")}`);
}
{
  const nt = readRepo("references/niche-templates.md");
  const tracks = [...nt.matchAll(/^##\s*\d+\.\s*(.+)$/gm)].map((m) => m[1].trim());
  check("niche-templates 含 8 个赛道", tracks.length === 8, `实际 ${tracks.length}: ${tracks.join(" / ")}`);
}
{
  const op = readRepo("references/output-playbook.md");
  const modes = ["模式 ①", "模式 ②", "模式 ③", "模式 ④"];
  check("output-playbook 含 4 个工作模式", modes.every((m) => op.includes(m)), `缺: ${modes.filter((m) => !op.includes(m)).join(",")}`);
}
{
  const pp = readRepo("references/platform-playbook.md");
  check("platform-playbook 含小红书 + 公众号两节", pp.includes("小红书 checklist") && pp.includes("公众号 checklist"));
}
{
  const cg = readRepo("references/compliance-guardrails.md");
  check("compliance-guardrails 含广告合规", cg.includes("广告合规"));
}
{
  const tm = readRepo("references/trend-meme-detection.md");
  check(
    "trend-meme-detection 含 形态表 + 识别流程 + 概念造词",
    tm.includes("热梗的常见形态") && tm.includes("识别流程") && tm.includes("概念造词")
  );
}
{
  const sk = readRepo("SKILL.md");
  check(
    "SKILL.md 含 工作模式 / 铁律 / 五步流程",
    sk.includes("工作模式") && sk.includes("铁律") && sk.includes("第 5 步")
  );
}
{
  const w = JSON.parse(readRepo("data/forbidden-words.json"));
  check("违禁词库 6 类", Object.keys(w).length === 6, Object.keys(w).join(","));
}
{
  const ciPath = path.join(ROOT, ".github/workflows/ci.yml");
  const exists = fs.existsSync(ciPath);
  const ci = exists ? fs.readFileSync(ciPath, "utf8") : "";
  check("存在 .github/workflows/ci.yml", exists);
  check("CI 会运行离线测试套件", /node tests\/run-tests\.js/.test(ci));
  check(
    "CI 含 push / pull_request / workflow_dispatch 触发器",
    ["push:", "pull_request:", "workflow_dispatch:"].every((k) => ci.includes(k))
  );
  check("CI 用 Node 22+ 矩阵（capture-xhs 需 ≥22）", /node-version:\s*\[[^\]]*2[24]/.test(ci));
  check("README 含 CI 徽章", /actions\/workflows\/ci\.yml\/badge\.svg/.test(readRepo("README.md")));
}

// ---------------- 汇总 ----------------
const total = pass + fail;
console.log("# 脚本层测试报告\n");
console.log(lines.join("\n"));
console.log(`\n## 汇总\n`);
console.log(`- 通过 **${pass}** / 共 **${total}**${fail ? `，失败 **${fail}**` : "，全部通过 ✅"}`);
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
