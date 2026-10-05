# notes/ — 小红书页面 HTML（自动化抓取 / 手动另存）

小红书有登录墙 + 反爬，**直接抓链接不可行**。两条路都能把页面 HTML 落到这里：

## 方式一：自动化抓取（推荐）

```bash
node scripts/capture-xhs.js --login                        # 首次：启动浏览器扫码登录一次
node scripts/capture-xhs.js --search "减脂餐" --limit 10    # 之后全自动，按关键词批量抓
node scripts/capture-xhs.js --feed --limit 5                # 首页推荐流
node scripts/capture-xhs.js --urls urls.txt                 # 或按 URL 列表抓
```

用 CDP 驱动**你自己的浏览器**正常加载页面，登录态天然继承，不碰反爬。每次产出：

- `notes/<id>.note.md` —— 可直接用的笔记文本（标题 / 正文 / 标签），从页面状态直出
- `notes/<id>.html` —— 原始 HTML（留档）
- `notes/images/<id>/NN.webp` —— **笔记图片**（格式按文件头嗅探）

> **为什么要图片**：小红书很多图文笔记的正文在图片里，`desc` 只有标题 + 一句短描述。拿到图后走 `references/screenshot-ocr.md` 的视觉转写补全。

## 方式二：手动另存

1. 在**已登录**的浏览器里正常打开笔记详情页（`www.xiaohongshu.com/explore/…`）。
2. `Ctrl+S` → 保存类型选 **「网页，仅 HTML」**（不是「单一文件 .mhtml」，也不是「全部」）。
3. 存进本目录，文件名随意（建议用赛道命名，如 `01-职场.html`、`02-健身.html`）。

## 怎么解析

```bash
# 单个文件（输出到 stdout）
node scripts/extract-xhs-html.js notes/01-职场.html

# 批量：每个 html 产出一个同名 .note.md
node scripts/extract-xhs-html.js notes/*.html --outdir out/

# 再逐个拆解
node scripts/breakdown.js out/01-职场.note.md
```

## 解析器会怎么处理

1. 优先读页面注入的 `window.__INITIAL_STATE__`（最准）；
2. 失败则退回 DOM（class/id 含 title/desc/tag）；
3. 再失败则全文兜底，并标注「可能不准」；
4. 若检测到是**登录页 / 验证页**，会打 `⚠️` 告警。

> 若脚本报警，说明保存时未登录或页面没加载完——重新登录后刷新页面再存一次。
