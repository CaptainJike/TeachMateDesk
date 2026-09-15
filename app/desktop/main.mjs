import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let localServer;
let localPort;
let backendUrl;
let mainWindow;

function configFilePath() {
  return path.join(app.getPath("userData"), ".env");
}

function readModelConfig() {
  const values = {};
  const configPath = configFilePath();
  if (fs.existsSync(configPath)) {
    for (const rawLine of fs.readFileSync(configPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return {
    provider: values.PI_MODEL_PROVIDER || process.env.PI_MODEL_PROVIDER || "deepseek",
    modelId: values.PI_MODEL_ID || process.env.PI_MODEL_ID || "deepseek-flash",
    baseUrl: values.PI_MODEL_BASE_URL || process.env.PI_MODEL_BASE_URL || "https://api.deepseek.com",
    supportsImages: values.PI_MODEL_SUPPORTS_IMAGES !== "false",
    keyConfigured: Boolean(values.PI_MODEL_API_KEY || process.env.PI_MODEL_API_KEY)
  };
}

function saveModelConfig(config) {
  const provider = String(config?.provider || "deepseek").trim();
  const modelId = String(config?.modelId || "deepseek-flash").trim();
  const baseUrl = String(config?.baseUrl || "https://api.deepseek.com").trim().replace(/\/+$/, "");
  let apiKey = String(config?.apiKey || "").trim();
  if (!apiKey) {
    const existing = fs.existsSync(configFilePath()) ? fs.readFileSync(configFilePath(), "utf8").match(/^PI_MODEL_API_KEY=(.*)$/m) : null;
    apiKey = existing?.[1]?.trim() || process.env.PI_MODEL_API_KEY || "";
  }
  if (!provider || !modelId || !baseUrl || !apiKey) throw new Error("请完整填写模型服务商、模型、接口地址和 API Key");
  const dataDir = app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true });
  const contents = [
    `PI_MODEL_PROVIDER=${provider}`,
    `PI_MODEL_ID=${modelId}`,
    `PI_MODEL_API_KEY=${apiKey}`,
    `PI_MODEL_BASE_URL=${baseUrl}`,
    "PI_MODEL_SUPPORTS_IMAGES=true",
    ""
  ].join("\n");
  fs.writeFileSync(configFilePath(), contents, { encoding: "utf8", mode: 0o600 });
  process.env.PI_MODEL_PROVIDER = provider;
  process.env.PI_MODEL_ID = modelId;
  process.env.PI_MODEL_API_KEY = apiKey;
  process.env.PI_MODEL_BASE_URL = baseUrl;
  process.env.PI_MODEL_SUPPORTS_IMAGES = "true";
  return readModelConfig();
}

ipcMain.handle("teachmate:get-model-config", () => readModelConfig());
ipcMain.handle("teachmate:save-model-config", (_event, config) => saveModelConfig(config));

function createApplicationMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        { label: "配置 AI 模型", click: () => mainWindow?.webContents.send("teachmate:open-model-config") },
        { type: "separator" },
        { role: "quit", label: "退出" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "查看",
      submenu: [
        { role: "reload", label: "刷新页面" },
        { role: "forceReload", label: "强制刷新页面" },
        { type: "separator" },
        { role: "resetZoom", label: "恢复默认缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" }
      ]
    },
    { role: "window", label: "窗口" },
    {
      label: "帮助",
      submenu: [
        {
          label: "使用说明",
          click: () => dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "TeachMate 使用说明",
            message: "TeachMate 智能作业批改系统",
            detail: "1. 在“试卷管理”导入试卷和评分量规。\n2. 点击右上角“Agent池就绪 · 配置”填写 AI 模型和 API Key。\n3. 导入学生答卷后，在“批量智能批改”开始分析。\n4. 低置信度结果会进入教师复核，不会自动确认。"
          })
        },
        {
          label: "检查更新",
          click: () => dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "检查更新",
            message: `当前版本：${app.getVersion()}`,
            detail: "当前版本未配置在线更新源。发布服务器接入后，可在这里检查并下载安装新版本。"
          })
        },
        { type: "separator" },
        {
          label: "关于 TeachMate",
          click: () => dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "关于 TeachMate",
            message: "TeachMate 智能作业批改系统",
            detail: `版本 ${app.getVersion()}\n面向教师的试卷管理、多模态批改与证据复核工作台。`
          })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function resourcePath(...parts) {
  const base = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "..", "..");
  return path.join(base, ...parts);
}

function projectPath(...parts) {
  return path.resolve(__dirname, "..", ...parts);
}

function configureRuntimePaths() {
  const dataDir = app.getPath("userData");
  loadUserConfig(path.join(dataDir, ".env"));
  const uploadsDir = path.join(dataDir, "uploads");
  const logsDir = path.join(dataDir, "logs");
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  process.env.TEACHMATE_EMBEDDED = "1";
  process.env.PORT = "0";
  process.env.FILE_SERVER_URL = "";
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.LOGS_DIR = logsDir;
  process.env.SQLITE_DB_PATH = path.join(dataDir, "teachmate.sqlite");
  process.env.KB_DIR = app.isPackaged ? resourcePath("knowledge-base") : projectPath("..", "knowledge-base");
  process.env.WEB_DIST_DIR = app.isPackaged ? resourcePath("web-dist") : projectPath("web", "dist");
}

function loadUserConfig(configPath) {
  if (!fs.existsSync(configPath)) return;
  for (const rawLine of fs.readFileSync(configPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

async function startBackend() {
  if (localServer && backendUrl) return backendUrl;
  configureRuntimePaths();
  const serverEntry = app.isPackaged
    // Workspace packages are stored under node_modules in the asar archive.
    // The previous path pointed to `app.asar/server/...`, which is not a
    // directory electron-builder creates for workspace dependencies.
    ? path.join(__dirname, "node_modules", "@teachmate", "server", "dist", "main.js")
    : path.resolve(__dirname, "..", "server", "dist", "main.js");
  const { startServer } = await import(pathToFileURL(serverEntry).href);
  localServer = startServer(0);
  await new Promise((resolve, reject) => {
    localServer.once("listening", resolve);
    localServer.once("error", reject);
  });
  const address = localServer.address();
  localPort = typeof address === "object" && address ? address.port : address;
  backendUrl = `http://127.0.0.1:${localPort}`;
  return backendUrl;
}

async function createWindow() {
  try {
    const url = await startBackend();
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 1100,
      minHeight: 720,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    mainWindow.once("ready-to-show", () => mainWindow.show());
    mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:\/\//.test(target)) void shell.openExternal(target);
      return { action: "deny" };
    });
    await mainWindow.loadURL(url);
  } catch (error) {
    dialog.showErrorBox("TeachMate 启动失败", error instanceof Error ? error.stack || error.message : String(error));
    app.quit();
  }
}

app.whenReady().then(() => {
  createApplicationMenu();
  return createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (localServer) localServer.close();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
