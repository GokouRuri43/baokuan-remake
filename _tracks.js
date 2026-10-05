// 赛道定向采样分析器：按赛道聚合统计 + 高频标签 + 标题样本
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = "notes/tracks";
if (!fs.existsSync(ROOT)) {
  console.log("还没有 notes/tracks/ 数据");
  process.exit(0);
}

const tracks = fs
  .readdirSync(ROOT)
  .filter((d) => fs.statSync(path.join(ROOT, d)).isDirectory())
  .sort();

const L = [];
const summary = [];
const globalTags = {};

for (const t of tracks) {
  const dir = path.join(ROOT, t);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".note.md")).sort();
  const rows = [];
  const tagCount = {};

  for (const f of files) {
    const p = path.join(dir, f);
    const text = fs.readFileSync(p, "utf8");
    const r = spawnSync("node", ["scripts/breakdown.js", p], { encoding: "utf8" });
    const o = r.stdout || "";
    const get = (label) => {
      const l = o.split("\n").find((x) => x.startsWith(`- ${label}：`));
      return l ? l.slice(label.length + 3).trim() : "";
    };
    const tags = get("标签").match(/#[^\s#]+/g) || [];
    for (const tg of tags) {
      tagCount[tg] = (tagCount[tg] || 0) + 1;
      globalTags[tg] = (globalTags[tg] || 0) + 1;
    }
    rows.push({
      f,
      title: get("标题"),
      chars: parseInt(get("正文字数"), 10) || 0,
      tags: tags.length,
      paras: parseInt(get("段落数"), 10) || 0,
      cta: /结尾区命中/.test(get("CTA / 引导词")),
      struct: get("结构信号词") !== "(无)" && get("结构信号词") !== "",
    });
  }

  const n = rows.length;
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  summary.push({
    track: t,
    n,
    avgChars: n ? Math.round(sum("chars") / n) : 0,
    medChars: n ? rows.map((r) => r.chars).sort((a, b) => a - b)[Math.floor(n / 2)] : 0,
    avgTags: n ? (sum("tags") / n).toFixed(1) : "0",
    zeroText: rows.filter((r) => r.chars === 0).length,
    cta: rows.filter((r) => r.cta).length,
    struct: rows.filter((r) => r.struct).length,
    topTags: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 8),
    rows,
  });
}

const total = summary.reduce((a, s) => a + s.n, 0);
L.push("# 赛道定向采样报告");
L.push("");
L.push(`> 按 8 个赛道关键词分别搜索抓取（每赛道 10 条），逐篇跑 \`scripts/breakdown.js\`。`);
L.push(`> 样本合计 **${total}** 篇。生成时间 ${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
L.push("");
L.push("## 一、赛道对比");
L.push("");
L.push("| 赛道 | 样本 | 平均字数 | 中位字数 | 零文字 | 平均标签 | 有CTA | 有结构词 |");
L.push("|---|---|---|---|---|---|---|---|");
for (const s of summary) {
  L.push(
    `| ${s.track} | ${s.n} | ${s.avgChars} | ${s.medChars} | ${s.zeroText} | ${s.avgTags} | ${s.cta} | ${s.struct} |`
  );
}
L.push("");
L.push("## 二、各赛道高频标签");
L.push("");
for (const s of summary) {
  L.push(`**${s.track}**：${s.topTags.map((x) => `${x[0]}(${x[1]})`).join("、") || "（无）"}`);
  L.push("");
}
L.push("## 三、全赛道高频标签 TOP 20");
L.push("");
const gTop = Object.entries(globalTags).sort((a, b) => b[1] - a[1]).slice(0, 20);
L.push(gTop.map((x) => `${x[0]}(${x[1]})`).join("、"));
L.push("");
L.push("## 四、各赛道标题样本");
L.push("");
for (const s of summary) {
  L.push(`### ${s.track}`);
  L.push("");
  for (const r of s.rows) {
    L.push(`- ${(r.title || "(无标题)").slice(0, 58)}  \`${r.chars}字/${r.tags}标签\``);
  }
  L.push("");
}

fs.writeFileSync("TRACK-ANALYSIS.md", L.join("\n"), "utf8");
console.log(`赛道 ${summary.length} 个 · 样本 ${total} 篇`);
for (const s of summary) console.log(`  ${s.track}: ${s.n} 篇 · 均 ${s.avgChars} 字 · 均 ${s.avgTags} 标签`);
console.log("已写出 TRACK-ANALYSIS.md");
