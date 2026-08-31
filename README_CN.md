# DOMShot

[English](./README.md) · 简体中文

DOMShot 是一个 Chrome Manifest V3 扩展，用于捕获指定 DOM 元素或完整页面，并导出 PNG、JPG 和 WebP 图片。

**Powered by [SnapDOM](https://snapdom.dev/)。** DOMShot 使用 [`@zumer/snapdom`](https://www.npmjs.com/package/@zumer/snapdom) 作为 DOM 渲染与图片生成引擎。DOMShot 是独立开发的项目，不是 ZumerLab 或 SnapDOM 的官方产品，也不代表其认可或背书。

## 功能

- 捕获前高亮元素并显示元素信息。
- 捕获单个元素或完整页面 DOM。
- 导出 PNG、JPG、WebP，支持 1×、2×、3× 输出。
- 在页面内预览、复制和下载图片。
- 页面缩放或双指缩放时保持插件界面尺寸稳定。
- 图片仅在浏览器本地处理，不会上传。

## 从源码安装

环境要求：Node.js 20.11+、Google Chrome 120+。

```bash
npm install
npm run build
```

打开 `chrome://extensions`，启用**开发者模式**，选择**加载已解压的扩展程序**，然后选择生成的 `dist` 目录。

在普通网页中打开 DOMShot，选择**提取页面元素**或**捕获完整页面**，再从页面内预览复制或下载结果。元素选择期间可按 `Esc` 退出。

## 设置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| 图片格式 | PNG | PNG 保留透明背景；JPG 和 WebP 使用白色背景。 |
| 输出清晰度 | 2× | 将导出图片的像素尺寸放大为 1×、2× 或 3×。 |
| JPG/WebP 图片质量 | 92% | 控制有损格式的导出质量，仅在选择 JPG 或 WebP 时显示。 |
| 语言 | 自动 | 浏览器为中文时使用中文，其他语言使用英文；手动选择会覆盖浏览器语言。 |
| 截图完成后 | 预览 | 截图成功后显示预览、自动复制或自动下载。 |
| 文件命名 | 智能 | 整页截图使用页面标题，元素截图使用元素名称；也可选择页面标题或仅使用时间。 |
| 嵌入网页字体 | 开启 | 提升自定义字体还原度，但会增加处理时间。 |
| 精确布局协调 | 关闭 | 改善行内元素和表格单元格的文字换行，处理时间可能接近翻倍。 |
| 保留外层阴影 | 关闭 | 保留截图根元素周围的阴影和轮廓。 |
| 优化内嵌图片 | 开启 | 将内嵌位图压缩至显示分辨率，减小文件体积。 |
| 截图前等待 | 不等待 | 可在截图前等待 0.5、1 或 2 秒，让页面内容完成加载或稳定。 |

设置会自动保存。

## 隐私与权限

DOMShot 不申请持久读取全部网站的权限，也不包含遥测或图片上传服务。

- `activeTab`：用户主动操作后访问当前标签页。
- `scripting`：按需注入截图脚本。
- `storage`：保存截图设置。
- `clipboardWrite`：复制生成的图片。

## 开发与测试

```bash
npm run dev       # 源码变化时持续构建
npm run typecheck # 检查 TypeScript
npm test          # 构建并运行浏览器行为测试
npm run check     # 类型检查、changelog 校验和测试
```

浏览器测试通过 `puppeteer-core` 使用本机 Chrome。需要使用其他 Chrome 或 Chromium 时，可设置 `DOMSHOT_CHROME_PATH`。详情参见 [test/README.md](./test/README.md)。

## Changelog 与发布

每个 PR 必须在 [`.changes`](./.changes/README.md) 中提交一份经过审核的 JSON fragment；仅内部改动则添加 `changelog: skip` 标签。Fragment 只描述用户可以观察到的结果，并由 `npm run changelog:check` 校验；开发者不直接编辑 `CHANGELOG.md`。

本地准备版本：

```bash
npm run release:prepare -- 0.2.0
```

该命令会校验并消费所有 fragment、生成 [`CHANGELOG.md`](./CHANGELOG.md) 的新版本章节，并同步更新 `package.json`、`package-lock.json` 和 `public/manifest.json` 中的版本号。GitHub 的 **Prepare release** 工作流执行相同流程，并创建 `release/v*` PR 供审核。

仓库维护者需要创建 `changelog: skip` 标签、允许 GitHub Actions 创建 PR，并将 `CI / check` 设置为 `main` 的必需状态检查。发布工作流会为自动生成的 PR 显式触发 CI。

## 已知限制

- `chrome://` 页面和扩展商店等受保护页面不允许注入脚本。
- 缺少合适 CORS 响应头的跨域图片或字体可能无法嵌入。
- 超大页面受浏览器内存和 Canvas 最大尺寸限制。
- 视频、Canvas、WebGL、动画和高度动态的内容可能与页面显示存在差异。

## 许可

DOMShot 按 [MIT License](./LICENSE) 发布，构建时也会将许可复制到发布目录中。

SnapDOM 由 ZumerLab 提供，并按 MIT License 发布。其版权声明和许可收录在 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)，构建时也会复制到发布目录中。
