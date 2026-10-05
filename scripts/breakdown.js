#!/usr/bin/env node
/**
 * breakdown.js — 图文爆款确定性拆解脚本（零依赖，Node >= 16）
 *
 * 用法：
 *   node scripts/breakdown.js <file.md> [--platform xhs|wechat]
 *   node scripts/breakdown.js --text "标题\n正文..." [--platform xhs|wechat]
 *
 * 输出：Markdown 事实骨架（确定性字段），供 AI 补充定性分析。
 */
"use strict";

const fs = require("fs");
const path = require("path");

// ---------- 工具 ----------
function isEmojiCodePoint(cp) {
  return (
    (cp >= 0x1f000 && cp <= 0x1faff) || // 表情、象形文字、区域指示符等
    (cp >= 0x2600 && cp <= 0x27bf) || // 杂项符号、装饰符号
    (cp >= 0x2b00 && cp <= 0x2bff) // 其他符号和箭头
  );
}

function countEmoji(text) {
  let n = 0;
  for (const ch of text) {
    if (isEmojiCodePoint(ch.codePointAt(0))) n += 1;
  }
  return n;
}

// 简单的平台猜测（可被 --platform 覆盖）
function guessPlatform(text) {
  const tags = (text.match(/#[\u4e00-\u9fa5A-Za-z0-9_/-]+/g) || []).length;
  const emoji = countEmoji(text);
  const len = text.length;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const shortLines = lines.filter((l) => l.trim().length <= 40).length;
  let xhs = 0;
  let wechat = 0;
  if (tags >= 2) xhs += 2;
  if (emoji / Math.max(1, len) > 0.005) xhs += 2;
  if (lines.length > 0 && shortLines / lines.length > 0.6) xhs += 2;
  if (len > 1500) wechat += 2;
  if (tags === 0 && emoji / Math.max(1, len) <= 0.005) wechat += 2;
  return xhs >= wechat ? "小红书 (猜测)" : "公众号 / 长文体 (猜测)";
}

// 情绪词（内置小词表，仅作密度信号，非情绪分析）
const POS_WORDS = ["涨粉", "爆款", "月入", "变现", "赚钱", "逆袭", "翻身", "干货", "收藏", "省钱", "搞钱", "副业", "自由", "上岸", "瘦了", "变美", "成功", "高效", "轻松", "好用", "划算"];
const NEG_WORDS = ["焦虑", "内耗", "踩坑", "后悔", "亏", "穷", "累", "崩溃", "破防", "emo", "迷茫", "熬夜", "胖", "贵", "难", "坑", "劝退", "放弃", "失败"];

function countHits(text, words) {
  let n = 0;
  for (const w of words) if (text.includes(w)) n += 1;
  return n;
}

const CTA_WORDS = ["关注", "点赞", "收藏", "评论", "私信", "加微信", "加我", "扫码", "链接", "转发", "在看", "分享", "留言", "扣1", "扣 1", "评论区", "主页", "橱窗", "下单", "链接在", "推荐", "试试", "入手", "买它", "闭眼入", "无限回购", "加购", "囤"];
const STRUCT_WORDS = ["首先", "其次", "然后", "最后", "第一", "第二", "第三", "总结", "总之", "1.", "2.", "3.", "①", "②", "③", "第一步", "第二步", "第三步"];

function countWords(text, words) {
  const hits = [];
  for (const w of words) if (text.includes(w)) hits.push(w);
  return hits;
}

function analyze(text) {
  const lines = text.split(/\r?\n/);
  let titleIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      titleIdx = i;
      break;
    }
  }
  const title = titleIdx >= 0 ? lines[titleIdx].trim() : "(无)";
  const body = titleIdx >= 0 ? lines.slice(titleIdx + 1).join("\n") : text;
  const totalChars = text.length;
  const bodyChars = body.length;
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const emoji = countEmoji(text);
  const tags = text.match(/#[\u4e00-\u9fa5A-Za-z0-9_/-]+/g) || [];
  const numbers = text.match(/\d+(\.\d+)?(万|千|亿|k|w|K|W|元|块|¥|%)?/g) || [];
  const questions = /[?？]/.test(title);
  const cta = countWords(text, CTA_WORDS);
  // 结尾区 = 去掉纯标签段后的**最后一段**（避免 "#好物分享" 之类被误判为 CTA；
  // 用最后一段而非末 2 段，是为了区分「正文提及」与「结尾号召」）
  const nonTagParas = paragraphs.filter(
    (p) => p.replace(/#[\u4e00-\u9fa5A-Za-z0-9_/-]+/g, "").trim().length > 0
  );
  const tail = (nonTagParas.length ? nonTagParas : paragraphs).slice(-1).join("\n");
  const ctaTail = countWords(tail, CTA_WORDS);
  const cnNumbers = text.match(/[零一二三四五六七八九十百千万亿两]/g) || [];
  const struct = countWords(text, STRUCT_WORDS);
  const pos = countHits(text, POS_WORDS);
  const neg = countHits(text, NEG_WORDS);
  return {
    title,
    bodyChars,
    paragraphs: paragraphs.length,
    totalChars,
    emoji,
    emojiDensity: emoji / Math.max(1, totalChars),
    tags: [...new Set(tags)],
    numbers: numbers.length,
    cnNumbers: cnNumbers.length,
    questions,
    cta: [...new Set(cta)],
    ctaTail: [...new Set(ctaTail)],
    struct: [...new Set(struct)],
    pos,
    neg,
  };
}

function render(platform, r) {
  const pct = (x) => (x * 100).toFixed(2) + "%";
  return [
    "# 拆解事实骨架（确定性）",
    "",
    `- 平台：${platform}`,
    `- 标题：${r.title}`,
    `- 正文字数：${r.bodyChars}（总 ${r.totalChars}）`,
    `- 段落数：${r.paragraphs}`,
    `- emoji 数量：${r.emoji}（密度 ${pct(r.emojiDensity)}）`,
    `- 标签：${r.tags.length ? r.tags.join(" ") : "(无)"}`,
    `- 阿拉伯数字 / 金额：${r.numbers} 处；中文数字：${r.cnNumbers} 处（含"一起 / 一定"等非数量用法，仅作参考）`,
    `- 标题含问句 / 悬念：${r.questions ? "是" : "否"}`,
    `- CTA / 引导词：全文命中 ${r.cta.length ? r.cta.join("、") : "无"}${
      r.ctaTail.length
        ? `；结尾区命中（疑似真实 CTA）${r.ctaTail.join("、")}`
        : "；结尾区无命中（多为正文提及，非真实 CTA）"
    }`,
    `- 结构信号词：${r.struct.length ? r.struct.join("、") : "(无)"}`,
    `- 情绪词命中：正向 ${r.pos} 处 / 负向 ${r.neg} 处`,
    "",
    "> 以上为脚本确定性统计；钩子类型、情绪曲线、痛点、标题公式、热梗等定性字段需 AI 结合 references/viral-formulas.md 与 references/trend-meme-detection.md 补充。",
    "> 注：平台为启发式猜测，长文 / 新闻体也会落入「公众号 / 长文体」；CTA 为关键词命中，需按结尾区位置判断真伪。",
  ].join("\n");
}

// ---------- 主流程 ----------
function main() {
  const args = process.argv.slice(2);
  let text = null;
  let platformHint = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--text") {
      text = args[++i];
    } else if (a === "--platform") {
      platformHint = args[++i];
    } else if (!text) {
      const p = path.resolve(a);
      if (!fs.existsSync(p)) {
        console.error(`文件不存在: ${p}`);
        process.exit(1);
      }
      text = fs.readFileSync(p, "utf8");
    }
  }
  if (!text || !text.trim()) {
    console.error("用法: node scripts/breakdown.js <file.md> [--platform xhs|wechat]");
    console.error('      node scripts/breakdown.js --text "标题\\n正文..." [--platform xhs|wechat]');
    process.exit(1);
  }
  const platform =
    platformHint === "xhs" ? "小红书" : platformHint === "wechat" ? "公众号" : guessPlatform(text);
  const r = analyze(text);
  console.log(render(platform, r));
}

main();
