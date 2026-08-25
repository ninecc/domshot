# DOMShot 品牌规范

## 定位

DOMShot 是面向开发、设计与内容工作者的网页元素捕获工具。品牌表达强调“精确、清晰、高效”，产品文案使用直接的操作动词，不使用夸张口号。

DOMShot 是独立产品；SnapDOM 是其 DOM 渲染与图片生成引擎。对外统一使用 `Powered by SnapDOM` 表达技术归属，不暗示 DOMShot 由 ZumerLab 或 SnapDOM 官方开发、认可或背书。

## 品牌层级

- `DOMShot` 是插件、浏览器工具栏、文档标题和下载文件的主品牌。
- `Powered by SnapDOM` 是技术归属，作为次级信息展示并链接到 <https://snapdom.dev/>。
- 不将 SnapDOM 字标与 DOMShot 图标组合成一个 Logo，不把 DOMShot 的视觉资产称为 SnapDOM 官方资产。
- 未获得单独授权前，技术归属使用纯文字，不使用 SnapDOM 官方 Logo。

## Logo

- 横向标志由取景图标和 `DOMShot` 字标组成，用于弹窗页头等宽空间。
- 图标标志用于浏览器工具栏和小尺寸入口；最小显示尺寸为 16px，32px 以上为推荐尺寸。
- 浅色背景使用全彩标志；深色背景使用反白版本。
- 不拉伸、旋转或改变图标与字标的相对比例。

### 品牌资产

- Icon 集合展示图：[`assets/logos/icon-only/logo_evergreen_icon-collection_20260825.png`](../assets/logos/icon-only/logo_evergreen_icon-collection_20260825.png)
- 插件运行时图标位于 `public/`，集合展示图仅作为 DOMShot 的品牌源资产和设计参考，不进入扩展构建产物。

## 色彩

| 名称 | 色值 | 用途 |
| --- | --- | --- |
| 取景蓝 | `#2563EB` | 主操作、选区与 DOMShot 字标 |
| 提取紫 | `#8B5CF6` | 渐变终点、辅助强调 |
| 识别青 | `#08BDF4` | 图标图像语义 |
| 深夜蓝 | `#0F172A` | 标题与主要文字 |
| 石板灰 | `#64748B` | 辅助文字与图标 |
| 画布白 | `#F8FAFC` | 页面背景 |
| 成功绿 | `#10B981` | 成功状态 |
| 错误红 | `#EF4444` | 错误状态 |

蓝紫渐变仅用于 Logo、当前选中状态和主要下载操作；普通容器使用白色与中性边框，避免界面被品牌色淹没。

## 字体与图标

- 界面字体：`Inter / SF Pro Text / PingFang SC`，采用系统字体回退，避免额外网络请求。
- 字标使用 800 字重；界面标题使用 600–700 字重；辅助文字不低于 8px（仅限 360px 浏览器弹窗）。
- 功能图标以 1.5–2px 圆角线框为主；状态必须同时使用文字或符号，不能只靠颜色表达。

## 交互层级

常用操作与输出格式、清晰度始终直接可见。字体嵌入等低频设置放入右上角设置按钮，默认收起。界面暂不展示或注册功能快捷键。

## 许可表达

- 工程仓库和发布包必须保留 `THIRD_PARTY_NOTICES.md` 中的 SnapDOM MIT License 全文。
- `Powered by SnapDOM` 是产品技术归属，不替代 MIT License 要求的版权与许可声明。
- SnapDOM 的 MIT License 只覆盖对应第三方软件，不自动成为 DOMShot 自身的许可证。
