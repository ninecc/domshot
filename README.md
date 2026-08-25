# SnapDOM 取景器

基于 [SnapDOM](https://snapdom.dev/docs/) 的 Chrome Manifest V3 扩展。它可以在当前网页中选择任意 DOM 元素，保留计算样式、伪元素、字体与图片，并导出 PNG、JPG 或 WebP。

## 功能

- 悬停高亮并显示元素名称、尺寸，单击后截图
- 截取整个页面 DOM，而不是只截可见视口
- 1× / 2× / 3× 输出，支持嵌入网页字体
- 页面内预览、复制到剪贴板、下载图片
- `Esc` 退出选择，所有图片只在本地浏览器中处理
- 仅使用 `activeTab` 临时权限，不申请读取全部网站

## 本地运行

```bash
npm install
npm run check
npm run build
```

打开 `chrome://extensions`，启用“开发者模式”，选择“加载已解压的扩展程序”，然后选择本项目生成的 `dist` 目录。

开发时运行 `npm run dev`。修改源码后，在扩展管理页点击刷新；构建脚本会持续更新 `dist` 中的 JS。

## 已知限制

- Chrome、Edge 等浏览器自己的页面（例如 `chrome://extensions`）不允许扩展注入脚本。
- 缺少 CORS 响应头的跨域图片或字体可能无法嵌入；这是 Canvas 的浏览器安全限制。
- 特别大的完整页面会占用较多内存，建议先选择页面中的主要内容容器。
