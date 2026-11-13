import {defineConfig, type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {IncomingMessage} from 'node:http';

// 控制台的小后台：读写设置、接收拖进来的素材、启动导出。只在本机运行。
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const settingsFile = path.join(root, 'src/settings.json');
const defaultsFile = path.join(root, 'src/settings.default.json');
const uploadDir = path.join(root, 'public/uploads');
const ALLOWED = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov'];

type Job = {state: 'idle' | 'running' | 'done' | 'error'; progress: number; file: string; error: string};
let job: Job = {state: 'idle', progress: 0, file: '', error: ''};

const readBody = (req: IncomingMessage, limit: number) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('文件太大'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const startRender = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const name = `App预览视频-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.mp4`;
  const out = path.join(root, 'out', name);
  job = {state: 'running', progress: 0, file: '', error: ''};
  // 用当前这个 node 直接跑 Remotion 的入口脚本：Mac / Windows 都能用，也不依赖系统 PATH
  const child = spawn(process.execPath, [path.join(root, 'node_modules/@remotion/cli/remotion-cli.js'), 'render', 'src/index.ts', 'AppPreview', out, '--props=src/settings.json'], {cwd: root});
  let log = '';
  const onData = (b: Buffer) => {
    const text = b.toString();
    log = (log + text).slice(-4000);
    const all = [...text.matchAll(/(?:Rendered|Encoded)\s+(\d+)\/(\d+)/g)];
    const last = all[all.length - 1];
    if (last) job.progress = Math.max(job.progress, Math.min(0.99, Number(last[1]) / Number(last[2])));
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => (job = {state: 'error', progress: 0, file: '', error: String(e)}));
  child.on('close', (code) => {
    if (code !== 0) {
      job = {state: 'error', progress: 0, file: '', error: log.split('\n').filter(Boolean).slice(-3).join(' ')};
      return;
    }
    // 桌面的位置：普通桌面，或 Windows 上被 OneDrive 接管的桌面；都没有就留在工程的 out 文件夹
    const desktop = [path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'OneDrive', 'Desktop'), path.join(os.homedir(), 'OneDrive', '桌面')].find((d) => fs.existsSync(d));
    try {
      if (!desktop) throw new Error('no desktop');
      fs.copyFileSync(out, path.join(desktop, name));
      job = {state: 'done', progress: 1, file: path.join(desktop, name), error: ''};
    } catch {
      job = {state: 'done', progress: 1, file: out, error: ''};
    }
  });
};

const api = (): Plugin => ({
  name: 'control-api',
  configureServer(server) {
    // 刚上传的素材直接从磁盘读给页面（Vite 只认启动时就存在的文件）
    const TYPES: Record<string, string> = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime'};
    server.middlewares.use('/uploads', (req, res, next) => {
      const name = path.basename(decodeURIComponent((req.url ?? '').split('?')[0]));
      const file = path.join(uploadDir, name);
      const type = TYPES[path.extname(name).toLowerCase()];
      if (!type || !fs.existsSync(file)) return next();
      const size = fs.statSync(file).size;
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      res.setHeader('Content-Type', type);
      res.setHeader('Accept-Ranges', 'bytes');
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : size - 1;
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', end - start + 1);
        fs.createReadStream(file, {start, end}).pipe(res);
      } else {
        res.setHeader('Content-Length', size);
        fs.createReadStream(file).pipe(res);
      }
    });
    server.middlewares.use('/api', async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const send = (code: number, data: unknown) => {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(data));
      };
      try {
        if (url.pathname === '/props' && req.method === 'GET') return send(200, JSON.parse(fs.readFileSync(settingsFile, 'utf8')));
        if (url.pathname === '/props' && req.method === 'POST') {
          const data = JSON.parse((await readBody(req, 2e6)).toString('utf8'));
          fs.writeFileSync(settingsFile, JSON.stringify(data, null, 2));
          return send(200, {ok: true});
        }
        if (url.pathname === '/reset' && req.method === 'POST') {
          fs.copyFileSync(defaultsFile, settingsFile);
          return send(200, JSON.parse(fs.readFileSync(settingsFile, 'utf8')));
        }
        if (url.pathname === '/upload' && req.method === 'POST') {
          const original = path.basename(url.searchParams.get('name') ?? 'file');
          const ext = path.extname(original).toLowerCase();
          if (!ALLOWED.includes(ext)) return send(400, {error: '只支持图片（png / jpg / webp）和视频（mp4 / mov）'});
          const body = await readBody(req, 300e6);
          fs.mkdirSync(uploadDir, {recursive: true});
          const name = `${Date.now()}${ext}`;
          fs.writeFileSync(path.join(uploadDir, name), body);
          return send(200, {file: `uploads/${name}`});
        }
        if (url.pathname === '/render' && req.method === 'POST') {
          if (job.state !== 'running') startRender();
          return send(200, job);
        }
        if (url.pathname === '/render' && req.method === 'GET') return send(200, job);
        send(404, {error: 'not found'});
      } catch (e) {
        send(500, {error: String(e instanceof Error ? e.message : e)});
      }
    });
  },
});

export default defineConfig({
  root: here,
  publicDir: path.join(root, 'public'),
  plugins: [react(), api()],
  server: {port: 5173, strictPort: false, host: '127.0.0.1', watch: {ignored: ['**/public/**', '**/out/**', '**/src/settings*.json']}},
});
