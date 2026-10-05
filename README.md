# baokuan-remake · 爆款复刻 Skill

[![CI](https://github.com/GokouRuri43/baokuan-remake/actions/workflows/ci.yml/badge.svg)](https://github.com/GokouRuri43/baokuan-remake/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

把一篇小红书 / 公众号爆款「拆」成可复用的公式（**结构 + 热梗**），再帮你**写出一条能发的爆款**——模仿爆款，或从你自己的想法出发。

> **别人只拆结构，我们还拆热梗，并直接给你稿**：输入爆款（或只给一个想法），输出 ① 拆解报告（结构层 + 热梗层）+ ② 可直接发布的原创图文 / 批量变体。

## 为什么做这个

- 想做小红书 / 公众号副业、涨粉、带货的人很多，但「不知道写什么、怎么写爆款」。
- 同类 skill 大多只做**结构拆解**或**写作助手**，会系统性漏掉**梗驱动型爆款**——那种「无 CTA、无清单、无情绪词」却几万赞的帖子：它踩在热梗上（如「胆子真是肥嘟嘟的」）。本 skill **强制联网验证热梗**，说清「为什么是**现在**爆」。
- 拆完不止步：直接给**能发出去的稿**，不是提纲。

## 功能

**两种分析层**：结构层（标题公式 / 钩子 / 情绪曲线 / 信息结构）+ 热梗层（联网验证梗的出处 / 含义 / 时效 / 传播机制）。

**四种工作模式**：

| 模式 | 用户给什么 | 产出 |
|---|---|---|
| ① 拆解 | 一篇爆款 | 拆解报告（结构 + 热梗） |
| ② 模仿复刻 | 爆款 + 你的选题 | 同公式 + 同梗结构的原创图文 |
| ③ 想法构筑 | 一个想法 / 产品 / 关键词 | 从零匹配公式 + 热梗，构筑一条 |
| ④ 批量变体 | 一个选题 | 3–5 条不同公式 / 梗的变体，供 A/B 测试 |

完整方法论见 [`SKILL.md`](SKILL.md)。

## 快速开始

### 作为 Codex / Claude Code Skill 使用

把本仓库放入技能的 skills 目录即可（目录名 `baokuan-remake`），触发词：`拆解爆款`、`复刻笔记`、`写一条爆款`、`追热梗`、`小红书起号`、`公众号爆文`。

### 拆解脚本

```bash
node scripts/breakdown.js examples/demo-input.md
# 或直接贴文本
node scripts/breakdown.js --text "标题..." --platform xhs
```

### 合规扫描

```bash
node scripts/compliance-check.js examples/demo-rebuild.md
# 或直接贴文本
node scripts/compliance-check.js --text "稳赚不赔..."
```

### 小红书：自动化抓取（CDP 驱动真实浏览器）

**直接抓链接不可行**（登录墙 + 反爬，见 [`TESTING.md`](TESTING.md)）。本仓库改用 **CDP 驱动你自己的浏览器**正常加载页面再存 HTML——不碰反爬，登录态天然继承。

```bash
# ① 首次：启动浏览器并登录小红书（扫一次码，profile 会记住）
node scripts/capture-xhs.js --login

# ② 按关键词批量抓（自动从页面状态取带 xsec_token 的链接）
node scripts/capture-xhs.js --search "减脂餐" --limit 10

# ③ 抓首页推荐流 / 按 URL 列表抓
node scripts/capture-xhs.js --feed --limit 5
node scripts/capture-xhs.js --urls urls.txt

# ④ 拆解（note.md 已由抓取直出，无需再解析 HTML）
node scripts/breakdown.js notes/xx.note.md
```

每次抓取同时产出：

| 产物 | 说明 |
|---|---|
| `notes/<id>.note.md` | **可直接用的笔记文本**（标题 / 正文 / 标签），从页面状态直出 |
| `notes/<id>.html` | 原始 HTML（留档 / 手动排查） |
| `notes/images/<id>/NN.webp` | **笔记图片**（格式按文件头嗅探，非 URL 后缀） |

> **为什么要抓图片**：小红书大量图文笔记的**正文在图里**，`desc` 只有标题 + 一句短描述。取到图片后走 [`references/screenshot-ocr.md`](references/screenshot-ocr.md) 的视觉转写即可补全。
>
> **手动兜底**：浏览器里 `Ctrl+S` 存为「网页，仅 HTML」→ `node scripts/extract-xhs-html.js notes/*.html --outdir out/`。
>
> 全程零依赖（Node ≥ 22，用内置 WebSocket 走 CDP）。浏览器 profile 存在 `.browser-profile/`（含登录态，**已 gitignore**）。

四个脚本均零依赖（Node ≥ 16，`capture-xhs.js` 需 ≥ 22）。违禁 / 敏感词库在 `data/forbidden-words.json`，可按平台扩充。

## Demo

- 爆款输入：[`examples/demo-input.md`](examples/demo-input.md)（合成示例）
- 拆解报告：[`examples/demo-breakdown.md`](examples/demo-breakdown.md)
- 复刻成品：[`examples/demo-rebuild.md`](examples/demo-rebuild.md)
- **热梗识别 + 输出**：[`examples/demo-trend-meme.md`](examples/demo-trend-meme.md)（识别「胆子真是肥嘟嘟的」热梗并产出）
- **想法构筑**：[`examples/demo-from-idea.md`](examples/demo-from-idea.md)（只给一个想法 → 完整爆款）
- **真实数据四模式实测**：[`examples/demo-live-xhs.md`](examples/demo-live-xhs.md)（10 条真抓取笔记 + 40 张图的拆解 / 模仿 / 构筑 / 批量）

## 测试

```bash
node tests/run-tests.js          # 离线回归：73 项，覆盖全部脚本的所有模式与边界
node tests/run-online-tests.js   # 在线回归：需先 --login（可加 --skip-port）
```

- **CI**：每次 push / PR 自动跑离线 73 项（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)，Node 22 + 24 双版本矩阵）
- **完整测试报告（含全部结果与原始输出）**：[`TEST-REPORT.md`](TEST-REPORT.md)
- 实测过程记录与已知局限：[`TESTING.md`](TESTING.md)

> 在线套件**不进 CI**：它需要真实浏览器 + 已登录的小红书账号，登录凭据绝不能放进 CI。

## 合规声明

- **只拆结构 + 梗，不抄内容**：产出必须原创，禁止洗稿、禁止仿冒身份。
- **不臆断热梗**：梗必须联网验证，搜不到就写「未能验证」。
- 拆解是方法论，**不保证爆款、不保证涨粉**，发布前请人工复核。
- 违禁 / 敏感词库非穷尽，需结合平台最新规则。

详见 [`references/compliance-guardrails.md`](references/compliance-guardrails.md)。

## 目录结构

```
.
├── SKILL.md                          # 核心方法论（Agent 入口）
├── .github/workflows/ci.yml          # CI：每次 push/PR 跑离线 68 项测试
├── scripts/
│   ├── breakdown.js                  # 确定性拆解脚本（零依赖）
│   ├── compliance-check.js           # 违禁 / 敏感词扫描（零依赖）
│   ├── extract-xhs-html.js           # 另存 HTML → 笔记文本（绕过反爬）
│   └── capture-xhs.js                # CDP 驱动真实浏览器抓取（零依赖）
├── references/
│   ├── trend-meme-detection.md       # 热梗 / 趋势识别（联网验证 + 嫁接）
│   ├── output-playbook.md            # 输出模式（模仿 / 构筑 / 批量）
│   ├── viral-formulas.md             # 标题公式 / 钩子 / 情绪曲线 / 信息结构
│   ├── niche-templates.md            # 8 大垂直赛道模板
│   ├── platform-playbook.md          # 小红书 vs 公众号 差异表
│   ├── screenshot-ocr.md             # 截图视觉转写方法
│   └── compliance-guardrails.md      # 原创护栏 / 违禁词 / 去 AI 味
├── data/
│   └── forbidden-words.json          # 违禁 / 敏感词库（可扩充）
├── examples/                         # 完整演示（拆解 / 复刻 / 热梗 / 想法构筑 / 真实数据四模式）
├── tests/
│   ├── run-tests.js                  # 离线回归套件（73 项）
│   ├── run-online-tests.js           # 在线回归套件（需先 --login）
│   └── fixtures/                     # 解析器测试夹具
├── TEST-REPORT.md                    # 完整测试报告（结果 + 原始输出）
├── TESTING.md                        # 实测记录（过程 + 已知局限）
├── README.md
└── LICENSE
```

## Roadmap

- [x] 标题公式库扩充 + 情绪曲线变体 + 8 大垂直赛道模板
- [x] 违禁词库 + 自动化扫描器（`compliance-check.js`）
- [x] 截图 OCR（代理视觉转写）
- [x] 热梗 / 趋势识别（联网验证）+ 输出模式手册（模仿 / 构筑 / 批量）
- [x] 小红书「另存 HTML → 解析」（`extract-xhs-html.js`，绕过反爬的合法路径）
- [x] 小红书**自动化抓取**（`capture-xhs.js`，CDP 驱动真实浏览器，一次登录长期有效）
- [ ] 链接**直接**抓取（小红书登录墙 + 反爬，**已验证不可行**）
- [ ] 独立 OCR（tesseract.js，脱离代理也能用，暂不计划）
- [ ] 更多垂直赛道模板 + 违禁词库按平台持续更新

## License

[MIT](LICENSE)
