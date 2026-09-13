# TeachMate 桌面客户端

桌面客户端把 React 工作台、Express API、SQLite、上传文件和知识库放进一个可分发的应用中。运行时数据写入 Electron 的 `userData` 目录，升级或重新安装不会覆盖老师已有的试卷、答卷和批改记录。

## 本地开发

```bash
cd app
pnpm install
pnpm build
pnpm --filter @teachmate/desktop dev
```

## 构建分发包

```bash
cd app
pnpm desktop:package
```

`electron-builder` 会在仓库根目录的 `release/` 下生成当前操作系统的安装包和 portable/zip 包：

- Windows：NSIS 安装程序和 portable `.exe`
- macOS：`.dmg` 和 `.zip`
- Linux：AppImage 和 `.zip`

Windows 与 macOS 的安装包需要分别在对应平台构建。正式发布时请配置 Windows 代码签名，以及 macOS 的 Apple Developer 签名和公证。

## 模型配置

客户端不内置 API Key。可以在应用的 userData 目录创建 `.env`（Windows 可在 `%APPDATA%/TeachMate/.env` 附近查找，macOS 为 `~/Library/Application Support/TeachMate/.env`），写入 `PI_MODEL_API_KEY` 及模型配置；桌面入口会在启动时读取它。模型调用仍需要网络连接；SQLite、图片和知识库索引可以本地运行。
