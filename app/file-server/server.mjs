import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置文件目录与服务端口
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8002;
const UPLOAD_DIR = path.resolve(__dirname, 'uploads');

// 确保存储目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 常见文件 MIME 类型映射
const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  // 统一设置跨域与基础响应头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(reqUrl.pathname);

  // 1. 根目录 / 或 /list：展示当前可访问的文件列表与 URL 示例
  if (pathname === '/' || pathname === '/list') {
    fs.readdir(UPLOAD_DIR, (err, files) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '无法读取文件目录' }));
        return;
      }

      const fileList = files.map((fileName) => {
        const filePath = path.join(UPLOAD_DIR, fileName);
        const stats = fs.statSync(filePath);
        return {
          fileName,
          sizeKB: (stats.size / 1024).toFixed(2),
          url: `http://localhost:${PORT}/files/${encodeURIComponent(fileName)}`,
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'TeachMate File Server Running',
        port: PORT,
        uploadDirectory: UPLOAD_DIR,
        totalFiles: fileList.length,
        files: fileList,
      }, null, 2));
    });
    return;
  }

  // 2. 文件映射读取：/files/:filename
  if (pathname.startsWith('/files/')) {
    const rawFileName = pathname.replace('/files/', '');
    if (!rawFileName) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('缺少文件名');
      return;
    }

    // 防止路径穿越攻击 (Directory Traversal)
    const safePath = path.normalize(path.join(UPLOAD_DIR, rawFileName));
    if (!safePath.startsWith(UPLOAD_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('非法文件访问路径');
      return;
    }

    if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`文件不存在: ${rawFileName}`);
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(safePath);

    // 支持 Range 请求（断点续传/流式读取）
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(safePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(safePath).pipe(res);
    }
    return;
  }

  // 404 处理
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Route Not Found. Use /files/<filename> or /list');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(` TeachMate 文件映射服务已启动!`);
  console.log(` 本地访问:   http://localhost:${PORT}`);
  console.log(` 存储目录:   ${UPLOAD_DIR}`);
  console.log(` 文件URL格式: http://localhost:${PORT}/files/<文件名>`);
  console.log('====================================================');
});
