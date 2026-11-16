// 导出视频：把设置打包成一个 HyperFrames 合成页，再用 HyperFrames 逐帧渲染、混音、编码成 MP4。
// 用法：node render/render.mjs [输出文件]   （默认 out/app-preview.mp4）
// 运行中会打印「PROGRESS 0.42」这样的进度行，控制台的导出按钮靠它显示进度。
import {build} from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'composition');
const BUILD = path.join(ROOT, 'out', '.build');
const outArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const target = path.resolve(outArg || path.join(ROOT, 'out', 'app-preview.mp4'));
const progress = (p) => console.log(`PROGRESS ${p.toFixed(3)}`);

// FFmpeg：优先环境变量，其次建工程时记下的免安装版（.ffmpeg-dir），再其次主目录 .local/ffmpeg，最后系统 PATH
const exe = (name) => (process.platform === 'win32' ? name + '.exe' : name);
const dirs = [];
try {
  dirs.push(fs.readFileSync(path.join(ROOT, '.ffmpeg-dir'), 'utf8').trim());
} catch {}
dirs.push(path.join(os.homedir(), '.local', 'ffmpeg'));
const findTool = (name, envVar) => {
  if (process.env[envVar]) return process.env[envVar];
  for (const d of dirs) if (d && fs.existsSync(path.join(d, exe(name)))) return path.join(d, exe(name));
  return name;
};
const FFMPEG = findTool('ffmpeg', 'HYPERFRAMES_FFMPEG_PATH');
const FFPROBE = findTool('ffprobe', 'HYPERFRAMES_FFPROBE_PATH');

const props = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/settings.json'), 'utf8'));
fs.mkdirSync(BUILD, {recursive: true});
fs.writeFileSync(path.join(BUILD, 'props.json'), JSON.stringify(props));

// 1. 算出音效时间点、总时长、用到的录屏
const common = {bundle: true, jsx: 'automatic', logLevel: 'warning', define: {'process.env.NODE_ENV': '"production"'}};
await build({...common, entryPoints: [path.join(ROOT, 'render/cues.tsx')], outfile: path.join(BUILD, 'cues.cjs'), platform: 'node', format: 'cjs'});
const {cues, seconds, videos} = JSON.parse(execFileSync(process.execPath, [path.join(BUILD, 'cues.cjs'), path.join(BUILD, 'props.json')], {encoding: 'utf8'}));
progress(0.02);

// 2. 打包合成页
fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});
await build({...common, entryPoints: [path.join(ROOT, 'render/entry.tsx')], outfile: path.join(OUT, 'bundle.js'), format: 'iife', minify: true});

// 3. 复制设置里用到的素材（设置里任何指向 public/ 里文件的字符串），以及音效
const used = new Set();
const walk = (v) => {
  if (typeof v === 'string' && v && !v.includes('..') && fs.existsSync(path.join(ROOT, 'public', v)) && fs.statSync(path.join(ROOT, 'public', v)).isFile())
    used.add(v);
  else if (v && typeof v === 'object') Object.values(v).forEach(walk);
};
walk(props);
for (const f of fs.readdirSync(path.join(ROOT, 'public/sfx'))) used.add('sfx/' + f);

// 4. 录屏拆帧：只拆用得到的那一段，缩到手机屏幕宽度
const vframes = {};
for (const src of new Set(videos.map((v) => v.src))) {
  const ranges = videos.filter((v) => v.src === src);
  const start = Math.min(...ranges.map((r) => r.start));
  const end = Math.max(...ranges.map((r) => r.start + r.seconds)) + 0.2;
  const dir = 'vframes/' + src.replace(/\W/g, '_');
  fs.mkdirSync(path.join(OUT, dir), {recursive: true});
  execFileSync(FFMPEG, [
    '-v',
    'error',
    '-ss',
    String(start),
    '-t',
    String(end - start),
    '-i',
    path.join(ROOT, 'public', src),
    '-vf',
    'scale=720:-2',
    '-r',
    '60',
    '-q:v',
    '4',
    path.join(OUT, dir, '%05d.jpg'),
  ]);
  // 偏移：拆出来的第 1 张对应录屏的第 start 秒
  vframes['/' + src] = {dir: '/' + dir, fps: 60, count: fs.readdirSync(path.join(OUT, dir)).length, start};
  used.delete(src);
}
for (const f of used) {
  fs.mkdirSync(path.dirname(path.join(OUT, f)), {recursive: true});
  fs.copyFileSync(path.join(ROOT, 'public', f), path.join(OUT, f));
}
progress(0.08);

// 5. 合成页 HTML：画面交给 bundle.js，音效用带时间的 <audio> 标签交给 HyperFrames 混音
const audio = cues
  .map(
    (c, i) =>
      `  <audio id="sfx-${i}" data-start="${c.at.toFixed(3)}" data-duration="${c.name === 'chime' ? 2 : 0.7}" data-track-index="${i + 1}" data-volume="${c.volume.toFixed(2)}" src="sfx/${c.name}.wav"></audio>`,
  )
  .join('\n');
fs.writeFileSync(
  path.join(OUT, 'index.html'),
  `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #fff; }
  * { box-sizing: border-box; }
  #stage { position: relative; width: 886px; height: 1920px; overflow: hidden; }
  #app { position: absolute; inset: 0; }
</style></head>
<body>
<div id="stage" data-composition-id="app-preview" data-start="0" data-width="886" data-height="1920" data-duration="${seconds}" data-fps="30">
  <div id="app" class="clip" data-start="0" data-duration="${seconds}" data-track-index="0"></div>
${audio}
</div>
<script>window.__PROPS = ${JSON.stringify(props)}; window.__VFRAMES = ${JSON.stringify(vframes)};</script>
<script src="bundle.js"></script>
</body></html>
`,
);

if (process.argv.includes('--build-only')) {
  console.log(`BUILT ${OUT} (${seconds}s, ${cues.length} sounds, ${Object.keys(vframes).length} videos)`);
  process.exit(0);
}

// 6. HyperFrames 渲染。不发使用统计；有系统 Chrome 就用它，避免再下载一份
const chrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/google-chrome',
].find((c) => fs.existsSync(c));
const env = {
  ...process.env,
  DO_NOT_TRACK: '1',
  HYPERFRAMES_NO_TELEMETRY: '1',
  HYPERFRAMES_FFMPEG_PATH: FFMPEG,
  HYPERFRAMES_FFPROBE_PATH: FFPROBE,
  ...(chrome && !process.env.HYPERFRAMES_BROWSER_PATH ? {HYPERFRAMES_BROWSER_PATH: chrome} : {}),
};
fs.mkdirSync(path.dirname(target), {recursive: true});
const cli = path.join(ROOT, 'node_modules/hyperframes/bin/hyperframes.mjs');
const child = spawn(process.execPath, [cli, 'render', OUT, '-o', target, '--no-browser-gpu', '--quality', 'delivery'], {env, cwd: ROOT});
let log = '';
const onData = (b) => {
  const text = b.toString();
  log = (log + text).slice(-6000);
  const all = [...text.matchAll(/(\d{1,3})%/g)];
  if (all.length) progress(0.08 + 0.92 * Math.min(0.99, Number(all[all.length - 1][1]) / 100));
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);
child.on('close', (code) => {
  if (code === 0 && fs.existsSync(target)) {
    progress(1);
    console.log(`OUTPUT ${target}`);
  } else {
    console.error(
      log
        .split('\n')
        .filter((l) => /✗|error|failed/i.test(l))
        .slice(-4)
        .join('\n') || log.slice(-800),
    );
    process.exit(1);
  }
});
