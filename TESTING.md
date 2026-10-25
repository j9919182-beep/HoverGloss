# 开发与发布验证

当前版本：v0.9.31 Preview。只检查本次修改影响的内容；界面修改不要求逐页遍历用户文档。

## 不构建即可试用

仓库包含浏览器需要的运行文件、PDF.js、OCR 及模型推理代码。加载扩展不需要安装依赖。完整源码和发布包都应包含 `vendor/`，不要只提交最初的几个 JS 文件。

开发检查需要 Node.js 20+（GitHub 工作流使用 Node.js 24）：

```sh
npm run check
```

该命令是全套逻辑与结构检查，可能较慢。日常修改按影响选用：

| 修改范围 | 定向命令 |
| --- | --- |
| 句子/段落边界 | `npm run test:sentences`，`node tests/pdf-cross-page.test.cjs` |
| PDF 会话、进度与取文 | `node tests/pdf-reader-session.test.cjs`，`npm run test:pdf-copy` |
| 字幕开关、准备取消、偏好 | `node tests/cc-toggle.test.cjs`，`node tests/cc-preferences.test.cjs` |
| 学习记录、导入恢复 | `node tests/learning-store.test.cjs`，`node tests/learning-import.test.cjs` |
| 英法路由与本机翻译 | `node tests/browser-translator.test.cjs`，`node tests/worker.test.cjs` |
| 设置、弹窗与导入界面 | `npm run test:ui`（需 Playwright） |

运行浏览器测试时可安装 `playwright@1.62.1` 和对应 Chromium；Windows 测试优先使用已安装 Edge。也可把 `PLAYWRIGHT_MODULE` 设为 Playwright 模块的绝对路径。跨页 PDF 夹具通过真实 PDF.js 生成文字层，翻译回复为模拟数据。

`node tests/fresh-install-browser.test.cjs` 使用独立临时浏览器配置加载真实未打包扩展，检查设置页、空白英法学习库及字幕端口；不会下载模型或采集声音。部分浏览器发行版不允许命令行加载扩展，需要用户在开发人员模式手动加载。

## 重建可选运行库

仅修改运行库源码时需要安装开发依赖。使用已有 pnpm 锁文件：

```sh
pnpm install --frozen-lockfile
pnpm run build:aligner
pnpm run build:asr
```

OCR 重建的固定来源、完整性和路径参数见 [vendor/local-ocr/README.md](vendor/local-ocr/README.md) 与 [scripts/build-local-ocr.cjs](scripts/build-local-ocr.cjs)。

## 发布材料

`node scripts/prepare-release.cjs` 生成安装包、完整源码包、文件清单、SHA-256 校验和及本地准备报告，输出到忽略提交的 `dist/`。脚本不创建 Git 提交、标签或远程 Release，也不覆盖已有产物。

[发布前清单](docs/RELEASE-CHECKLIST.md)记录当前本地证据与尚需人工完成的真实模型/网站测试。GitHub 工作流配置不等于远程 CI 已通过。

## 测试边界

- 模拟 AI/模型/字幕只验证取文、状态、权限与渲染，不能据此宣称真实翻译或语音识别准确率。
- 干净浏览器配置的本机 API 可能不可用；记录检测结果，不把界面打开成功写成模型可用。
- 真实语言包下载、设备兼容性、真人发音质量、真实 YouTube/B站连续字幕需要人工验证。
- 问题反馈使用脱敏或自建样例，不把私人 PDF、学习库导出或密钥加入测试仓库。

旧版详细开发记录保留于 [历史测试快照](docs/archive/TESTING.md)，不是当前验证通过证明。
