# OpenTransAI Implementation Plan

**Goal:** 可加载的简洁 Chrome 划词 AI 翻译扩展。

**Architecture:** content.js 捕获选区、绘制 Shadow DOM；background.js 与 service.js 管理可信设置、消息与请求；core.js 管理语言方向、校验、提供商协议；options 和 popup 提供配置与开关。

**Tech Stack:** Manifest V3、原生 ES modules、Node 18 内置测试，无运行依赖。

**Spec:** docs/design.md

## Global Constraints

仅点击后调用 AI；Key 仅本地 trusted storage；默认简体中文；同语言转英语；无提交、发布或用户浏览器设置修改。

## Tasks

- [x] 1. tests/core.test.mjs 先覆盖语言变体、错误方向、接口校验、三种协议、失败与超时；运行 `npm test`，再创建 extension/lib/core.js，使测试通过。
- [x] 2. tests/service.test.mjs 验证内容脚本不可读写 Key、请求只能使用已保存配置；实现 extension/lib/service.js 与 background.js。
- [x] 3. 创建 extension/options.html、options.js、ui.css、popup.html、popup.js 与 content.js；使用同一视觉系统，实现设置、草稿切换、连接测试、划词按钮、loading/result/error 与复制。
- [x] 4. 创建 manifest.json、图标和 scripts/check.mjs、package.mjs；`npm run check` 检查 JS 语法、所有 manifest 资源、禁止远程执行资源，`npm run package` 输出加载目录与 zip。
- [x] 5. tests/browser.html 与浏览器隔离适配器仅用于本地测试，加载实际生产内容脚本；通过浏览器验证选区、点击、译文安全渲染、错误、失效响应与响应式设置页。检查截图与概念的一致性。
- [x] 6. 完成 README 安装、各服务配置、翻译规则、隐私边界与验证说明；运行 `npm test`、`npm run check`、`git diff --check` 并交付扩展与 zip。
