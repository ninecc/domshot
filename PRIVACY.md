# DOMShot Privacy Policy

Effective date: September 2, 2026

[简体中文](#简体中文)

DOMShot is a Chrome extension that converts webpage content selected by the user into local image files. This policy explains what information DOMShot processes, where it is stored, and the choices available to users.

## Information DOMShot processes

DOMShot processes information only to provide user-requested capture features:

- **Website content:** When a user starts a capture, DOMShot reads the selected element, visible area, or full page, including the styles, text, images, fonts, and layout needed to render the result.
- **Generated captures:** A completed image is kept in memory long enough to preview, copy, download, or save it.
- **Recent Captures:** This feature is disabled by default. When enabled, or when a user explicitly saves one capture, DOMShot stores the generated image and thumbnail together with its label, file name, format, dimensions, scale, size, creation time, and source website domain.
- **Preferences:** DOMShot stores settings such as image format, output scale, image quality, post-capture action, file naming, capture delay, rendering options, language, and appearance.
- **Image-source access:** If cross-origin images cannot be loaded, DOMShot identifies the affected image URLs and origins so the user can decide whether to grant access and retry the capture.

DOMShot does not require an account and does not include developer-operated analytics, advertising, or telemetry.

## Local storage and Chrome Sync

- Captures are generated locally in the browser and are not uploaded to servers operated by the DOMShot developer.
- Recent Captures are stored in the extension's local IndexedDB database. The history keeps up to 10 captures, up to 64 MB per capture and 256 MB in total. Older captures are removed when either limit is reached.
- Capture preferences, language, and appearance are stored with `chrome.storage.sync`. Chrome may synchronize these preferences through the user's Google account according to the user's Chrome settings and Google's policies. The DOMShot developer does not receive this synchronized data.
- Pending image-permission requests are stored temporarily with `chrome.storage.session`. They contain the source tab identifier, requested origins, language, appearance, and creation time. They are removed when completed or canceled and expire after approximately 10 minutes.

## Network requests and third parties

DOMShot does not send captures or browsing data to a developer-operated server.

When a user explicitly grants access to a blocked image source, the extension service worker requests that image directly from its source website. These requests omit cookies and referrer information. The source website may still receive ordinary network information, such as the user's IP address, as part of serving the image. DOMShot uses the response only to render the requested capture.

DOMShot includes SnapDOM as a bundled webpage-rendering library. SnapDOM runs locally as part of the extension; DOMShot does not send capture data to a SnapDOM service. Third-party license information is available in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## Permissions

DOMShot uses the following Chrome permissions:

- `activeTab`: accesses the current tab after the user starts a capture.
- `scripting`: injects the bundled selection and capture script into the active tab after a user action.
- `storage`: stores preferences and temporary permission-flow state.
- `clipboardWrite`: writes a generated image to the clipboard when the user chooses Copy or enables automatic copy.
- Optional site access: requested for specific image-source websites only after the user chooses to reload blocked cross-origin images. Granted access remains available for later captures until the user removes it in Chrome.

## Retention and user controls

- Recent Captures is disabled by default.
- Users can save or remove an individual capture without changing the global preference.
- An individual deletion can be undone for approximately five seconds. After the undo period, the item is unavailable and is purged from local history.
- Users can clear all Recent Captures from the extension.
- Chrome manages synchronized preferences and granted site permissions. Users can change the preferences in DOMShot and remove site access through Chrome's extension settings.
- Uninstalling DOMShot removes its local extension data, including the local Recent Captures database. Chrome may separately manage previously synchronized preferences according to the user's Chrome Sync settings.

## Data use and sharing

DOMShot does not sell user data, transfer it for advertising, use it for purposes unrelated to webpage capture, or use it to determine creditworthiness or for lending purposes. DOMShot does not share captures with the developer or unrelated third parties.

## Changes to this policy

This policy may be updated when DOMShot's data practices change. The effective date at the top of this document identifies the latest revision.

## Contact

Questions or privacy requests can be submitted through the [DOMShot GitHub issue tracker](https://github.com/ninecc/domshot/issues).

---

# 简体中文

生效日期：2026 年 9 月 2 日

DOMShot 是一款 Chrome 扩展，用于将用户主动选择的网页内容转换为本地图片文件。本政策说明 DOMShot 会处理哪些信息、信息存储在哪里，以及用户可以如何管理这些信息。

## DOMShot 处理的信息

DOMShot 仅为提供用户主动请求的截图功能处理以下信息：

- **网站内容：** 用户发起截图时，DOMShot 会读取所选元素、当前可见区域或完整页面，以及生成结果所需的样式、文字、图片、字体和布局信息。
- **生成的截图：** 截图完成后，图片会在内存中保留必要时间，用于预览、复制、下载或保存。
- **最近截图：** 此功能默认关闭。启用后，或用户单独保存某张截图时，DOMShot 会保存生成的图片和缩略图，以及标签、文件名、格式、尺寸、输出倍率、文件大小、创建时间和来源网站域名。
- **偏好设置：** DOMShot 会保存图片格式、输出倍率、图片质量、截图后操作、文件命名、截图延迟、渲染选项、语言和外观等设置。
- **图片来源访问：** 跨域图片无法加载时，DOMShot 会识别相关图片 URL 和来源网站，以便用户决定是否授权并重新截图。

DOMShot 不要求注册账号，也不包含由开发者运营的分析、广告或遥测服务。

## 本地存储与 Chrome 同步

- 截图在浏览器本地生成，不会上传到 DOMShot 开发者运营的服务器。
- 最近截图保存在扩展的本地 IndexedDB 数据库中，最多保留 10 张、单张不超过 64 MB、总计不超过 256 MB。达到任一限制时，会自动移除较早的截图。
- 截图偏好、语言和外观通过 `chrome.storage.sync` 保存。Chrome 可能根据用户的 Chrome 设置和 Google 政策，通过用户的 Google 账号同步这些偏好；DOMShot 开发者不会收到这些同步数据。
- 待处理的图片授权请求通过 `chrome.storage.session` 临时保存，其中包括来源标签页标识、请求的网站来源、语言、外观和创建时间。请求完成或取消时会被移除，并在约 10 分钟后失效。

## 网络请求与第三方

DOMShot 不会将截图或浏览数据发送到开发者运营的服务器。

仅当用户明确允许访问被阻止的图片来源时，扩展的 Service Worker 才会直接向对应来源网站请求图片。请求不会携带 Cookie 或来源页面信息；来源网站在提供图片时仍可能获得常规网络信息，例如用户的 IP 地址。DOMShot 仅使用响应内容生成用户请求的截图。

DOMShot 将 SnapDOM 作为网页渲染库随扩展一同打包。SnapDOM 在扩展中本地运行，DOMShot 不会将截图数据发送到 SnapDOM 服务。第三方许可信息见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

## 权限

DOMShot 使用以下 Chrome 权限：

- `activeTab`：用户发起截图后访问当前标签页。
- `scripting`：用户操作后，向当前标签页注入随扩展打包的元素选择和截图脚本。
- `storage`：保存偏好设置及授权流程的临时状态。
- `clipboardWrite`：用户选择复制或启用截图后自动复制时，将生成的图片写入剪贴板。
- 可选网站访问权限：仅在用户选择重新加载被阻止的跨域图片后，针对具体图片来源网站申请。已授予的权限会保留供后续截图使用，直到用户在 Chrome 中移除。

## 保留期限与用户控制

- 最近截图默认关闭。
- 用户可以单独保存或移除当前截图，而不改变全局设置。
- 删除单条截图后，可在约五秒内撤销。撤销时间结束后，该截图将无法访问，并会从本地历史记录中清理。
- 用户可以在扩展中清空全部最近截图。
- 同步偏好和网站权限由 Chrome 管理。用户可以在 DOMShot 中修改偏好，并通过 Chrome 的扩展设置移除网站访问权限。
- 卸载 DOMShot 会删除扩展的本地数据，包括本地最近截图数据库。Chrome 可能根据用户的 Chrome 同步设置单独管理此前同步的偏好。

## 数据使用与共享

DOMShot 不会出售用户数据、将数据用于广告、将数据用于与网页截图无关的目的，也不会将数据用于信用评估或贷款。DOMShot 不会与开发者或无关第三方共享截图。

## 政策更新

当 DOMShot 的数据处理方式发生变化时，本政策可能会更新。文档顶部的生效日期表示最近一次修订时间。

## 联系方式

如有隐私相关问题或请求，请通过 [DOMShot GitHub Issues](https://github.com/ninecc/domshot/issues) 联系。
