# DOMShot

DOMShot 是一个独立开发的 Chrome Manifest V3 扩展，用于选择网页元素或捕获完整页面，并导出 PNG、JPG 或 WebP 图片。

**Powered by [SnapDOM](https://snapdom.dev/)**：DOMShot 使用 [`@zumer/snapdom`](https://www.npmjs.com/package/@zumer/snapdom) 作为 DOM 渲染与图片生成引擎。DOMShot 并非 ZumerLab 或 SnapDOM 官方产品，也不代表其认可或背书。

## 功能

- 悬停高亮并显示元素名称、尺寸，单击后截图
- 截取整个页面 DOM，而不局限于可见视口
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

## 第三方软件与许可

SnapDOM 由 ZumerLab 提供，并以 MIT License 发布。其版权声明、许可条款与免责声明完整收录在 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)，构建时也会复制到发布目录中。

SnapDOM 的软件许可不等同于 DOMShot 自身的项目许可；除第三方组件各自授予的权利外，DOMShot 暂未声明独立的开源许可证。
