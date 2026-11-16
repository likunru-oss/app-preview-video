// 在 Node 里算出所有音效的时间点（秒）和总时长，给打包脚本生成 <audio> 标签用
import fs from 'node:fs';
import {FPS, scenesOf, sceneCues, totalFrames, type Props} from '../src/AppPreview';
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) as Props;
let from = 0;
const cues: {at: number; name: string; volume: number}[] = [];
for (const sc of scenesOf(p)) {
  for (const c of sceneCues(p, sc)) cues.push({at: (from + c.at) / FPS, name: c.name, volume: p.样式.音效音量 * (c.gain ?? 1)});
  from += sc.frames;
}
const pages = [] as {src: string; start: number; seconds: number}[];
from = 0;
for (const sc of scenesOf(p)) {
  const pg = typeof sc.id === 'number' ? p.页面[sc.id] : null;
  if (pg && pg.类型 === '功能页') {
    const rec = {开始: 0, 速度: 1, ...(pg.录屏 ?? {})};
    for (const src of [pg.截图, pg.尾帧?.图片 ?? ''])
      if (/\.(mp4|mov|webm)$/i.test(src)) pages.push({src, start: rec.开始, seconds: (sc.frames / FPS) * rec.速度});
  }
  from += sc.frames;
}
console.log(JSON.stringify({cues, seconds: totalFrames(p) / FPS, videos: pages}));
