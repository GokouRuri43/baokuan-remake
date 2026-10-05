#!/usr/bin/env node
/**
 * compliance-check.js — 违禁 / 敏感词确定性扫描（零依赖，Node >= 16）
 * 词库：data/forbidden-words.json（可按平台持续扩充）
 *
 * 用法：
 *   node scripts/compliance-check.js <file.md>
 *   node scripts/compliance-check.js --text "..."
 *
 * 输出：Markdown 扫描结果（命中词按类别列出）。词库非穷尽，需人工复核。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const WORDLIST = path.join(__dirname, "..", "data", "forbidden-words.json");

function loadWords() {
  const raw = fs.readFileSync(WORDLIST, "utf8");
  return JSON.parse(raw);
}

function main() {
  const args = process.argv.slice(2);
  let text = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--text") {
      text = args[++i];
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
    console.error("用法: node scripts/compliance-check.js <file.md>");
    console.error('      node scripts/compliance-check.js --text "..."');
    process.exit(1);
  }

  const words = loadWords();
  const lines = ["# 违禁 / 敏感词扫描结果", ""];
  let total = 0;
  for (const [cat, list] of Object.entries(words)) {
    const hits = [];
    for (const w of list) {
      if (text.includes(w)) hits.push(w);
    }
    if (hits.length) {
      total += hits.length;
      lines.push(`- **${cat}**：${hits.join("、")}（${hits.length} 处）`);
    }
  }
  if (total === 0) {
    lines.push("- ✅ 未命中内置词库中的违禁 / 敏感词。");
  }
  lines.push("", `> 命中 ${total} 处。词库非穷尽，需结合平台最新规则人工复核。`);
  console.log(lines.join("\n"));
}

main();
