<p align="center">
  <img src="extension/icons/ai-translate-light.svg" alt="OpenTransAI 图标" width="88" height="88">
</p>

<h1 align="center">OpenTransAI</h1>

<p align="center">轻量的 Chrome AI 翻译扩展 · 划词翻译 · 图片与截图翻译 · X / Reddit 原位翻译</p>

<p align="center">
  <a href="#快速开始"><img src="https://img.shields.io/badge/Chrome-123%2B-4285F4?style=flat-square&amp;logo=googlechrome&amp;logoColor=white" alt="Chrome 123+"></a>
  <a href="extension/manifest.json"><img src="https://img.shields.io/badge/Manifest-V3-34A853?style=flat-square" alt="Manifest V3"></a>
  <a href="#开发"><img src="https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?style=flat-square&amp;logo=javascript&amp;logoColor=black" alt="原生 JavaScript"></a>
  <a href="https://polyformproject.org/licenses/noncommercial/1.0.0"><img src="https://img.shields.io/badge/License-PolyForm_Noncommercial-7057FF?style=flat-square" alt="License: PolyForm Noncommercial 1.0.0"></a>
  <a href="https://github.com/szj-coder/OpenTransAI/stargazers"><img src="https://img.shields.io/github/stars/szj-coder/OpenTransAI?style=flat-square" alt="GitHub Stars"></a>
  <a href="https://github.com/szj-coder/OpenTransAI/issues"><img src="https://img.shields.io/github/issues/szj-coder/OpenTransAI?style=flat-square" alt="GitHub Issues"></a>
</p>

使用你自己的 AI 服务、模型和 API Key，无需注册项目账号或部署后端。翻译请求由扩展直接发送到你配置的 AI 服务，不经过项目方服务器。

## 功能

- **划词翻译**：选中文字后点击翻译，自动识别语言，在当前页面查看流式译文。
- **原位翻译**：在 X / Twitter 帖子及 Reddit 标题、正文和评论旁点击“AI 翻译”，支持随时恢复原文。
- **图片与截图**：右键图片选择翻译，或右键工具栏扩展图标选择“框选截图翻译”；图片识别需要视觉模型。
- **阅读浮窗**：支持切换目标语言、复制、重译、固定浮窗，以及浅色与深色样式。

<p align="center">
  <img src="docs/images/translation-example.jpg" alt="OpenTransAI 划词翻译示例，译文为演示数据" width="960">
</p>

## 快速开始

需要 **Chrome 123+**。加载源码无需 Node.js 或安装依赖。

1. 下载并解压本仓库，或克隆到本地。
2. 打开 `chrome://extensions`，开启 **开发者模式**，点击 **加载已解压的扩展程序**，选择仓库中的 **`extension` 文件夹**。
3. 点击工具栏中的 OpenTransAI 图标，填写 **协议、API 地址、模型、API Key 和默认语言**，保存配置并允许访问对应服务地址。可先用 **测试连接** 检查配置，测试成功后仍需保存。
4. 刷新网页，即可使用划词、图片或原位翻译。

更新扩展文件后，请重新加载扩展并刷新网页。Chrome 内部页面、扩展商店和浏览器内置 PDF 阅读器不支持。

## 配置 AI 服务

| 协议 | 示例基础地址 |
| --- | --- |
| OpenAI 兼容（含 DeepSeek、自定义服务） | `https://api.openai.com/v1` 或 `https://api.deepseek.com/v1` |
| Anthropic | `https://api.anthropic.com/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta` |

填写服务商实际可用的 **Model ID**。接口需支持 JSON 输出，流式显示需支持 SSE；图片翻译还需模型支持视觉输入，文字连接测试通过不代表支持图片。

默认目标语言为简体中文，支持 16 种目标语言。原文与默认语言不同时译为默认语言，相同时译为英语；也可在浮窗中手动切换目标语言。

本机 OpenAI 兼容服务可填写 `http://127.0.0.1:端口/v1`，远程地址须使用 HTTPS。扩展不内置模型，是否完全在本机处理取决于你配置的服务。

## 隐私

- **按需发送**：主动触发翻译后才发送所选文字、图片或确认后的截图选区，不上传整页或浏览历史。
- **本地配置**：设置与 API Key 保存在当前浏览器的 `chrome.storage.local`，仅扩展可信页面可访问，不做云同步。
- **无项目中转**：无项目账号、广告、遥测或持久化翻译历史；使用云端 AI 时，内容会发送至对应服务商。

本地存储不是加密密钥链，请勿将真实 API Key 提交到仓库。请求失败时，可从设置页右上角打开 **诊断日志**；日志仅本地保存，不记录 Key、原文、译文或图片。

## 开发

原生 HTML、CSS 和 JavaScript，采用 Manifest V3，无第三方运行依赖。需要 **Node.js 18+**；打包另需系统 `zip` 命令，无需 `npm install`。

```sh
npm test         # 单元测试
npm run check    # 清单、语法、CSP 与资源检查
npm run preview  # 交互预览：http://127.0.0.1:4173/
npm run package  # 输出 dist/OpenTransAI/ 和 dist/OpenTransAI.zip
```

预览使用模拟 AI 响应，请勿填写真实 Key。使用打包产物时，解压 ZIP 后加载其中的 `OpenTransAI` 文件夹。

更多说明：[图片交互规范](docs/image-translation-interaction-spec.md) · [图片翻译验收](docs/image-translation-verification.md) · [历史验证记录](docs/verification.md)。

## 许可与商业授权

采用 **[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)**。协议未许可的商业用途须另行取得书面授权，可通过 [Issues](https://github.com/szj-coder/OpenTransAI/issues) 咨询；具体权利与义务以协议原文为准。
