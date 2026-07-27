import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || process.argv[2] || 4173);
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(ROOT, `.${requested}`);
  const relative = path.relative(ROOT, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (error, body) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.code || 'Read error');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Kaki Rally dev server: http://127.0.0.1:${port}/`);
});
