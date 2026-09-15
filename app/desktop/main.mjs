import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let localServer;
let localPort;
let backendUrl;

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
    const window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 1100,
      minHeight: 720,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    window.once("ready-to-show", () => window.show());
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:\/\//.test(target)) void shell.openExternal(target);
      return { action: "deny" };
    });
    await window.loadURL(url);
  } catch (error) {
    dialog.showErrorBox("TeachMate 启动失败", error instanceof Error ? error.stack || error.message : String(error));
    app.quit();
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  if (localServer) localServer.close();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
