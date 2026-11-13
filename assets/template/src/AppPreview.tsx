import React from 'react';
import {AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame} from 'remotion';
import {z} from 'zod';
import {zColor} from '@remotion/zod-types';

/* ========= 可调内容的定义 =========
   视频 = 开场 + 任意多个页面 + 结尾。页面有两种：功能页（标题 + 手机画面）和卡片页（标题 + 一组卡片）。
   所有内容存在 src/settings.json，由控制台（control/）读写。 */
const 图片 = z.string(); // 留空 = 占位；填 public/ 里的文件名或 http 链接 = 显示图片；功能页也可以填 .mp4 / .mov 录屏
const 时长 = z.number().min(1).max(8).step(0.5); // 秒
const 百分比 = z.number().min(0).max(100).step(0.5);
// 讲解区域：截图上的一块位置（百分比）和一句说明
const 高亮 = z.array(z.object({文字: z.string(), 左: 百分比, 上: 百分比, 宽: 百分比, 高: 百分比}));

// —— 动效选项：控制台里每一项都是一排可点的选项 ——
const 转场 = z.enum(['上推', '左推', '右推', '圆形扩散', '三角推进', '向下擦除', '缩放', '淡入', '直接切换']);
const 配色 = z.enum(['蓝底', '白底', '深色底']);
const 标题动画 = z.enum(['弹出', '上滑', '淡入', '打字', '逐字弹出']);
const 手机进场 = z.enum(['从下升起', '从左滑入', '从右滑入', '放大出现', '倾斜转正', '直接出现']);
const 手机动态 = z.enum(['缓慢放大', '上下漂浮', '轻微摆动', '静止']);
const 讲解效果 = z.enum(['放大弹出', '镜头推近', '描边闪烁']);
const 图标动画 = z.enum(['旋转弹出', '从上落下', '放大淡入', '翻转']);
const 卡片动画 = z.enum(['两侧飞入', '原地弹出', '从上落下', '翻牌']);
const 标志动画 = z.enum(['弹出', '放大淡入', '从下升起']);
const 行驶方式 = z.enum(['匀速', '缓起缓停', '走走停停']);
export const OPTIONS = {
  转场: 转场.options,
  配色: 配色.options,
  标题动画: 标题动画.options,
  手机进场: 手机进场.options,
  手机动态: 手机动态.options,
  讲解效果: 讲解效果.options,
  图标动画: 图标动画.options,
  卡片动画: 卡片动画.options,
  标志动画: 标志动画.options,
  行驶方式: 行驶方式.options,
};

const 功能页 = z.object({
  类型: z.literal('功能页'),
  名称: z.string(), // 只在控制台的页签上显示，不出现在视频里
  第一行: z.string(),
  第二行: z.string(),
  截图: 图片,
  示意: z.string(), // 没放截图时播放哪个示意动画；'无' = 只显示占位
  高亮,
  时长,
  转场,
  配色,
  标题动画,
  手机进场,
  手机动态,
  讲解效果,
  显示手指: z.boolean(),
  压暗背景: z.boolean(),
  讲解停留: z.number().min(0.6).max(2.5).step(0.1), // 每个讲解区域停留几秒
  // 让截图里的小车沿路线往前开。左/上/宽/高 是小车在截图上的位置（百分比）
  小车: z.object({
    开启: z.boolean(),
    左: 百分比,
    上: 百分比,
    宽: 百分比,
    高: 百分比,
    距离: z.number().min(5).max(40).step(1), // 往前开多远，占屏幕高度的百分比
    方式: 行驶方式,
    变灰轨迹: z.boolean(), // 开过的路线是否变成灰色
  }),
  // 在画面上先弹出一条红色提示，再换成一条绿色提示（比如「无信号」→「离线地图」）
  提示: z.object({开启: z.boolean(), 红色文字: z.string(), 绿色文字: z.string()}),
});
const 卡片页 = z.object({
  类型: z.literal('卡片页'),
  名称: z.string(),
  第一行: z.string(),
  第二行: z.string(),
  时长,
  转场,
  配色,
  标题动画,
  卡片动画,
  卡片: z.array(z.object({文字: z.string(), 图片, 色相: z.number().min(0).max(360).step(5)})),
});

export const schema = z.object({
  品牌: z.object({
    标语: z.string(),
    主色: zColor(),
    深色: zColor(),
    背景色: zColor(),
    图标: 图片,
    字标: 图片,
  }),
  开场: z.object({图标大小: z.number().min(120).max(500).step(10), 时长, 图标动画}),
  页面: z.array(z.discriminatedUnion('类型', [功能页, 卡片页])),
  结尾: z.object({字标宽度: z.number().min(300).max(820).step(10), 时长, 转场, 标志动画}),
  样式: z.object({
    标题字号: z.number().min(50).max(130).step(2),
    手机宽度: z.number().min(420).max(760).step(10),
    弹跳感: z.number().min(0).max(10).step(1), // 0 = 平稳，10 = 很弹
    逐词间隔: z.number().min(1).max(15).step(1),
    音效音量: z.number().min(0).max(1).step(0.05), // 0 = 静音
  }),
});
export type Props = z.infer<typeof schema>;
export type Page = Props['页面'][number];
export type FeaturePage = Extract<Page, {类型: '功能页'}>;
export type CardPage = Extract<Page, {类型: '卡片页'}>;

export const FPS = 30;
const OVERLAP = 20; // 每页多留 20 帧，等下一页的转场盖住它
const W = 886;
const H = 1920;
// Mac 上是 SF，Windows 上是 Segoe UI。想要两边完全一致，换成随工程打包的字体
const FONT = '-apple-system, "SF Pro Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

// 一条视频里的所有段落，按顺序：开场、各个页面、结尾
export type Scene = {id: 'intro' | 'end' | number; name: string; frames: number};
export const scenesOf = (p: Props): Scene[] => [
  {id: 'intro', name: '开场', frames: Math.round(p.开场.时长 * FPS)},
  ...p.页面.map((pg, i) => ({id: i, name: pg.名称, frames: Math.round(pg.时长 * FPS)})),
  {id: 'end', name: '结尾', frames: Math.round(p.结尾.时长 * FPS)},
];
export const totalFrames = (p: Props) => scenesOf(p).reduce((n, s) => n + s.frames, 0);

// 控制台「加一页」时用的初始内容
export const newFeaturePage = (): FeaturePage => ({
  类型: '功能页',
  名称: '新功能',
  第一行: 'Your headline',
  第二行: 'goes here',
  截图: '',
  示意: '无',
  高亮: [],
  时长: 4,
  转场: '上推',
  配色: '蓝底',
  标题动画: '弹出',
  手机进场: '从下升起',
  手机动态: '缓慢放大',
  讲解效果: '放大弹出',
  显示手指: true,
  压暗背景: true,
  讲解停留: 1,
  小车: {开启: false, 左: 46, 上: 69, 宽: 8, 高: 7.5, 距离: 18, 方式: '匀速', 变灰轨迹: true},
  提示: {开启: false, 红色文字: 'No signal', 绿色文字: 'Offline map'},
});
export const newCardPage = (): CardPage => ({
  类型: '卡片页',
  名称: '卡片',
  第一行: 'Everything',
  第二行: 'you need',
  时长: 3,
  转场: '向下擦除',
  配色: '白底',
  标题动画: '弹出',
  卡片动画: '两侧飞入',
  卡片: [
    {文字: 'ONE', 图片: '', 色相: 205},
    {文字: 'TWO', 图片: '', 色相: 150},
    {文字: 'THREE', 图片: '', 色相: 30},
    {文字: 'FOUR', 图片: '', 色相: 280},
  ],
});

/* ========= 通用 ========= */
const Ctx = React.createContext<Props>(null as unknown as Props);
const useProps = () => React.useContext(Ctx);
const useDamping = () => 20 - useProps().样式.弹跳感 * 1.2;
const useSpring = (delay = 0, stiffness = 110) => {
  const frame = useCurrentFrame();
  const damping = useDamping();
  return spring({frame: frame - delay, fps: FPS, config: {damping, stiffness}});
};
const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const resolveSrc = (src: string) => {
  const s = src.trim();
  if (!s) return null;
  return /^(https?:|data:)/.test(s) ? s : staticFile(s);
};

const Placeholder: React.FC<{label: string; hue: number; style?: React.CSSProperties}> = ({label, hue, style}) => (
  <div
    style={{
      background: `linear-gradient(135deg, hsl(${hue},70%,62%), hsl(${hue + 40},75%,45%))`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      color: 'rgba(255,255,255,.9)',
      fontFamily: FONT,
      fontWeight: 700,
      fontSize: 40,
      letterSpacing: 2,
      ...style,
    }}
  >
    {label}
  </div>
);

// 两行标题，动画方式可选
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const Title: React.FC<{lines: string[]; colors: [string, string]; anim: z.infer<typeof 标题动画>; top?: number}> = ({lines, colors, anim, top = 150}) => {
  const frame = useCurrentFrame();
  const damping = useDamping();
  const {样式} = useProps();
  let typed = 0; // 打字效果：前面几行已经打完的字数
  return (
    <div
      style={{position: 'absolute', top, width: '100%', textAlign: 'center', fontFamily: FONT, fontSize: 样式.标题字号, lineHeight: 1.08, letterSpacing: -1.5}}
    >
      {lines.map((w, i) => {
        if (!w.trim()) return null;
        const delay = 5 + i * 样式.逐词间隔;
        const base: React.CSSProperties = {fontWeight: i === 0 ? 700 : 800, color: colors[i]};
        if (anim === '打字') {
          const start = 5 + typed * 1.3;
          typed += w.length;
          const n = Math.max(0, Math.floor((frame - start) / 1.3));
          return (
            <div key={i} style={base}>
              <span>{w.slice(0, n)}</span>
              <span style={{opacity: 0}}>{w.slice(n)}</span>
            </div>
          );
        }
        if (anim === '逐字弹出') {
          return (
            <div key={i} style={base}>
              {[...w].map((ch, j) => {
                const s = spring({frame: frame - delay - j * 1.5, fps: FPS, config: {damping, stiffness: 180}});
                return (
                  <span
                    key={j}
                    style={{display: 'inline-block', transform: `translateY(${(1 - s) * 60}px) scale(${0.4 + 0.6 * s})`, opacity: clamp01(s * 1.5)}}
                  >
                    {ch === ' ' ? ' ' : ch}
                  </span>
                );
              })}
            </div>
          );
        }
        if (anim === '上滑') {
          const t = interpolate(frame, [delay, delay + 14], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
          return (
            <div key={i} style={{...base, transform: `translateY(${(1 - t) * 90}px)`, opacity: t}}>
              {w}
            </div>
          );
        }
        if (anim === '淡入') {
          return (
            <div key={i} style={{...base, opacity: interpolate(frame, [delay, delay + 16], [0, 1], clamp)}}>
              {w}
            </div>
          );
        }
        const s = spring({frame: frame - delay, fps: FPS, config: {damping, stiffness: 140}});
        return (
          <div key={i} style={{...base, transform: `translateY(${(1 - s) * 70}px) scale(${0.7 + 0.3 * s})`, opacity: clamp01(s)}}>
            {w}
          </div>
        );
      })}
    </div>
  );
};

/* ========= 交互小零件 ========= */
// 手指点击：一个半透明圆点移过来、按下、荡开一圈波纹。x / y 是所在容器里的像素坐标
const Tap: React.FC<{x: number; y: number; at: number}> = ({x, y, at}) => {
  const f = useCurrentFrame() - at;
  if (f < -10 || f > 22) return null;
  const appear = interpolate(f, [-10, 0], [0, 1], clamp);
  const press = interpolate(f, [0, 4, 10], [1, 0.72, 1], clamp);
  const ripple = interpolate(f, [2, 18], [0, 1], clamp);
  const out = interpolate(f, [14, 22], [1, 0], clamp);
  return (
    <div
      style={{position: 'absolute', left: x, top: y, zIndex: 50, opacity: appear * out, transform: `translate(${(1 - appear) * 40}px, ${(1 - appear) * 60}px)`}}
    >
      <div
        style={{
          position: 'absolute',
          left: -45,
          top: -45,
          width: 90,
          height: 90,
          borderRadius: '50%',
          border: '5px solid rgba(255,255,255,.95)',
          boxShadow: '0 0 0 2px rgba(0,0,0,.15)',
          transform: `scale(${1 + ripple * 1.6})`,
          opacity: (1 - ripple) * 0.9,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: -38,
          top: -38,
          width: 76,
          height: 76,
          borderRadius: '50%',
          background: 'rgba(255,255,255,.55)',
          border: '4px solid rgba(255,255,255,.95)',
          boxShadow: '0 6px 18px rgba(0,0,0,.35)',
          transform: `scale(${press})`,
        }}
      />
    </div>
  );
};

type Spot = {文字: string; 左: number; 上: number; 宽: number; 高: number};
// 讲解的节奏：第一个在第几帧出现、每隔多少帧换下一个、每个停留多少帧
type SpotTiming = {first: number; every: number; hold: number};
const spotTiming = (停留秒: number): SpotTiming => {
  const hold = Math.round(停留秒 * FPS);
  return {first: 34, every: hold + 8, hold};
};
const spotK = (frame: number, i: number, tm: SpotTiming, damping: number) => {
  const t0 = tm.first + i * tm.every;
  const a = spring({frame: frame - t0, fps: FPS, config: {damping, stiffness: 150}});
  const b = spring({frame: frame - t0 - tm.hold, fps: FPS, config: {damping: 20, stiffness: 160}});
  return Math.max(0, a - b);
};
const useSpotK = (i: number, tm: SpotTiming) => spotK(useCurrentFrame(), i, tm, useDamping());

const B = 14; // 手机边框宽度
// 说明文字的小胶囊。s 是这块区域当前被放大到几倍（不放大就是 1）
const SpotLabel: React.FC<{spot: Spot; k: number; s: number; iw: number; ih: number}> = ({spot, k, s, iw, ih}) => {
  const {品牌} = useProps();
  const rw = (spot.宽 / 100) * iw;
  const rh = (spot.高 / 100) * ih;
  const l = (spot.左 / 100) * iw;
  const t = (spot.上 / 100) * ih;
  const cx = (spot.左 + spot.宽 / 2) / 100;
  const left = cx > 0.7 ? B + l + rw / 2 + (rw * s) / 2 : cx < 0.3 ? B + l + rw / 2 - (rw * s) / 2 : B + l + rw / 2;
  const shift = cx > 0.7 ? '-100%' : cx < 0.3 ? '0%' : '-50%';
  const origin = cx > 0.7 ? '100% 50%' : cx < 0.3 ? '0% 50%' : '50% 50%';
  const below = t + rh / 2 < ih * 0.55;
  const top = below ? B + t + rh / 2 + (rh * s) / 2 + 18 : B + t + rh / 2 - (rh * s) / 2 - 18 - 70;
  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 21,
        left,
        top,
        transformOrigin: origin,
        transform: `translateX(${shift}) scale(${Math.min(1, k * 1.2)})`,
        opacity: Math.min(1, k * 3),
        background: 品牌.深色,
        color: 'white',
        fontFamily: FONT,
        fontWeight: 800,
        fontSize: 38,
        padding: '14px 30px',
        borderRadius: 40,
        whiteSpace: 'nowrap',
        boxShadow: '0 10px 30px rgba(0,0,0,.3)',
      }}
    >
      {spot.文字}
    </div>
  );
};

// 讲解效果 1「放大弹出」：把这块区域抠出来放大，浮在手机上面
const SpotPop: React.FC<{spot: Spot; i: number; tm: SpotTiming; url: string; iw: number; ih: number}> = ({spot, i, tm, url, iw, ih}) => {
  const k = useSpotK(i, tm);
  if (k < 0.01) return null;
  const rw = (spot.宽 / 100) * iw;
  const rh = (spot.高 / 100) * ih;
  const l = (spot.左 / 100) * iw;
  const t = (spot.上 / 100) * ih;
  const target = Math.max(1.22, Math.min(2.2, 270 / rw));
  const s = 1 + (target - 1) * k;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          zIndex: 20,
          left: B + l,
          top: B + t,
          width: rw,
          height: rh,
          overflow: 'hidden',
          borderRadius: 18 / s,
          transform: `scale(${s})`,
          boxShadow: `0 ${20 / s}px ${50 / s}px rgba(0,0,0,.45)`,
          outline: `${5 / s}px solid white`,
          opacity: Math.min(1, k * 4),
        }}
      >
        <Img src={url} style={{position: 'absolute', left: -l, top: -t, width: iw, height: ih, maxWidth: 'none'}} />
      </div>
      <SpotLabel spot={spot} k={k} s={s} iw={iw} ih={ih} />
    </>
  );
};

// 讲解效果 3「描边闪烁」：不放大，在原位置画一个发光的框
const SpotRing: React.FC<{spot: Spot; i: number; tm: SpotTiming; iw: number; ih: number; dim: boolean}> = ({spot, i, tm, iw, ih, dim}) => {
  const {品牌} = useProps();
  const frame = useCurrentFrame();
  const k = useSpotK(i, tm);
  if (k < 0.01) return null;
  const pulse = 1 + 0.025 * Math.sin(frame / 2.5);
  return (
    <div
      style={{
        position: 'absolute',
        left: (spot.左 / 100) * iw,
        top: (spot.上 / 100) * ih,
        width: (spot.宽 / 100) * iw,
        height: (spot.高 / 100) * ih,
        boxSizing: 'border-box',
        border: '5px solid white',
        borderRadius: 16,
        boxShadow: `0 0 0 4px ${品牌.主色}, 0 0 34px 8px ${品牌.主色}${dim ? `, 0 0 0 3000px rgba(8,16,32,${0.55 * Math.min(1, k)})` : ''}`,
        opacity: Math.min(1, k * 3),
        transform: `scale(${pulse * (1.2 - 0.2 * Math.min(1, k))})`,
      }}
    />
  );
};

const SpotDim: React.FC<{n: number; tm: SpotTiming}> = ({n, tm}) => {
  const frame = useCurrentFrame();
  const start = tm.first - 4;
  const end = tm.first + (n - 1) * tm.every + tm.hold;
  const o = interpolate(frame, [start, start + 8, end, end + 10], [0, 0.5, 0.5, 0], clamp);
  return <div style={{position: 'absolute', inset: 0, background: `rgba(8,16,32,${o})`}} />;
};

// 小车行驶：把小车从截图上抠出来往前移动，原位置和开过的路段用旁边的路线补上
type Truck = FeaturePage['小车'];
const TruckDrive: React.FC<{url: string; iw: number; ih: number; cfg: Truck; dur: number}> = ({url, iw, ih, cfg, dur}) => {
  const frame = useCurrentFrame();
  const end = Math.max(30, dur - 5);
  const p =
    cfg.方式 === '匀速'
      ? interpolate(frame, [12, end], [0, 1], clamp)
      : cfg.方式 === '缓起缓停'
        ? interpolate(frame, [12, end], [0, 1], {...clamp, easing: Easing.inOut(Easing.cubic)})
        : interpolate(frame, [12, 12 + (end - 12) * 0.38, 12 + (end - 12) * 0.6, end], [0, 0.5, 0.5, 1], {...clamp, easing: Easing.inOut(Easing.quad)});
  const bl = (cfg.左 / 100) * iw;
  const bt = (cfg.上 / 100) * ih;
  const bw = (cfg.宽 / 100) * iw;
  const bh = (cfg.高 / 100) * ih;
  const d = p * (cfg.距离 / 100) * ih;
  // 取小车下面（灰色、已开过）或上面（蓝色、还没开）的一小条路线，拉长后当补丁
  const stripH = 0.008 * ih;
  const stripY = cfg.变灰轨迹 ? bt + bh + 0.022 * ih : bt - 0.016 * ih;
  const patch = (left: number, top: number, width: number, height: number) => {
    const K = height / stripH;
    return (
      <div style={{position: 'absolute', left, top, width, height, overflow: 'hidden'}}>
        <Img src={url} style={{position: 'absolute', left: -left, top: -stripY * K, width: iw, height: ih * K, maxWidth: 'none'}} />
      </div>
    );
  };
  return (
    <>
      {patch(bl, bt, bw, bh + 0.008 * ih)}
      {d > 0.5 && patch(bl + bw * 0.2, bt - d + bh * 0.5, bw * 0.6, d + 1)}
      <div
        style={{
          position: 'absolute',
          left: bl,
          top: bt - d,
          width: bw,
          height: bh,
          overflow: 'hidden',
          transform: `translateX(${Math.sin(frame / 6) * 0.5}px)`,
        }}
      >
        <Img src={url} style={{position: 'absolute', left: -bl, top: -bt, width: iw, height: ih, maxWidth: 'none'}} />
      </div>
    </>
  );
};

/* ========= 手机框：截图 / 录屏 / 示意操作 ========= */
const MOCK_W = 592;
const MOCK_H = 1283;
type PhoneFx = {
  手机进场: z.infer<typeof 手机进场>;
  手机动态: z.infer<typeof 手机动态>;
  讲解效果: z.infer<typeof 讲解效果>;
  显示手指: boolean;
  压暗背景: boolean;
  讲解停留: number;
  小车: Truck;
};
const Phone: React.FC<{
  src: string;
  label: string;
  hue: number;
  fx: PhoneFx;
  dur: number;
  spots?: Spot[];
  mock?: React.ReactNode;
  children?: React.ReactNode;
}> = ({src, label, hue, fx, dur, spots = [], mock, children}) => {
  const frame = useCurrentFrame();
  const damping = useDamping();
  const {品牌, 样式} = useProps();
  const e = useSpring(8, 90);
  const w = 样式.手机宽度;
  const iw = w - 28;
  const ih = (iw * MOCK_H) / MOCK_W; // 和 iPhone 截图同比例，讲解区域才能对准
  const url = resolveSrc(src);
  const isVideo = /\.(mp4|mov|webm)$/i.test(src.trim());
  const tm = spotTiming(fx.讲解停留);
  const useSpots = !!url && !isVideo && spots.length > 0;

  // 进场
  const enter: Record<PhoneFx['手机进场'], string> = {
    从下升起: `translateY(${(1 - e) * 500}px)`,
    从左滑入: `translateX(${-(1 - e) * 760}px)`,
    从右滑入: `translateX(${(1 - e) * 760}px)`,
    放大出现: `scale(${0.4 + 0.6 * e})`,
    倾斜转正: `perspective(1800px) translateY(${(1 - e) * 220}px) rotateY(${(1 - e) * -55}deg) rotateX(${(1 - e) * 14}deg)`,
    直接出现: '',
  };
  // 进场之后一直持续的轻微动态
  const idle: Record<PhoneFx['手机动态'], string> = {
    缓慢放大: `scale(${interpolate(frame, [0, 180], [1, 1.05], clamp)})`,
    上下漂浮: `translateY(${Math.sin(frame / 16) * 14}px)`,
    轻微摆动: `perspective(1800px) rotateY(${Math.sin(frame / 22) * 6}deg)`,
    静止: '',
  };

  // 讲解效果 2「镜头推近」：整个屏幕朝当前讲解的区域放大
  let cam = {k: 0, i: -1};
  if (useSpots && fx.讲解效果 === '镜头推近')
    spots.forEach((_, i) => {
      const k = spotK(frame, i, tm, damping);
      if (k > cam.k) cam = {k, i};
    });
  const camSpot = cam.i >= 0 ? spots[cam.i] : null;
  const camTarget = camSpot ? Math.max(1.25, Math.min(2.6, 75 / camSpot.宽)) : 1;
  const camStyle: React.CSSProperties = camSpot
    ? {transform: `scale(${1 + (camTarget - 1) * Math.min(1, cam.k)})`, transformOrigin: `${camSpot.左 + camSpot.宽 / 2}% ${camSpot.上 + camSpot.高 / 2}%`}
    : {};

  return (
    <div
      style={{
        position: 'absolute',
        left: (W - w) / 2,
        top: 470,
        width: w,
        height: ih + 28,
        transform: `${enter[fx.手机进场]} ${idle[fx.手机动态]}`.trim() || undefined,
        opacity: fx.手机进场 === '直接出现' ? 1 : clamp01(e * 1.5),
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: w * 0.13,
          border: '14px solid #0b0b0f',
          background: '#0b0b0f',
          overflow: 'hidden',
          boxShadow: '0 40px 100px rgba(0,0,0,.35)',
        }}
      >
        {url ? (
          isVideo ? (
            <OffthreadVideo src={url} muted style={{width: '100%', height: '100%', objectFit: 'cover'}} />
          ) : (
            <div style={{position: 'absolute', inset: 0, ...camStyle}}>
              <Img src={url} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top'}} />
              {fx.小车.开启 && <TruckDrive url={url} iw={iw} ih={ih} cfg={fx.小车} dur={dur} />}
            </div>
          )
        ) : mock ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: MOCK_W,
              height: MOCK_H,
              transform: `scale(${iw / MOCK_W})`,
              transformOrigin: '0 0',
              overflow: 'hidden',
            }}
          >
            {mock}
          </div>
        ) : (
          <Placeholder label={label} hue={hue} style={{width: '100%', height: '100%'}} />
        )}
        {useSpots && fx.讲解效果 === '放大弹出' && fx.压暗背景 && <SpotDim n={spots.length} tm={tm} />}
        {useSpots && fx.讲解效果 === '描边闪烁' && spots.map((sp, i) => <SpotRing key={i} spot={sp} i={i} tm={tm} iw={iw} ih={ih} dim={fx.压暗背景} />)}
        {children}
      </div>
      {useSpots &&
        spots.map((sp, i) => (
          <React.Fragment key={i}>
            {fx.显示手指 && <Tap x={B + ((sp.左 + sp.宽 / 2) / 100) * iw} y={B + ((sp.上 + sp.高 / 2) / 100) * ih} at={tm.first + i * tm.every - 6} />}
            {fx.讲解效果 === '放大弹出' && <SpotPop spot={sp} i={i} tm={tm} url={url!} iw={iw} ih={ih} />}
            {fx.讲解效果 === '描边闪烁' && <RingLabel spot={sp} i={i} tm={tm} iw={iw} ih={ih} />}
          </React.Fragment>
        ))}
      {camSpot && (
        <div
          style={{
            position: 'absolute',
            zIndex: 21,
            left: '50%',
            top: ih - 110,
            transform: `translateX(-50%) scale(${Math.min(1, cam.k * 1.2)})`,
            opacity: Math.min(1, cam.k * 3),
            background: 品牌.深色,
            color: 'white',
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: 38,
            padding: '14px 30px',
            borderRadius: 40,
            whiteSpace: 'nowrap',
            boxShadow: '0 10px 30px rgba(0,0,0,.3)',
          }}
        >
          {camSpot.文字}
        </div>
      )}
    </div>
  );
};
const RingLabel: React.FC<{spot: Spot; i: number; tm: SpotTiming; iw: number; ih: number}> = ({spot, i, tm, iw, ih}) => {
  const k = useSpotK(i, tm);
  return k < 0.01 ? null : <SpotLabel spot={spot} k={k} s={1} iw={iw} ih={ih} />;
};

/* ========= 转场：每页自己带入场遮罩，盖在上一页上面 ========= */
type Transition = z.infer<typeof 转场>;
const useEnterStyle = (t: Transition): React.CSSProperties => {
  const frame = useCurrentFrame();
  const damping = useDamping();
  const s = spring({frame, fps: FPS, config: {damping: Math.max(damping, 14), stiffness: 90}});
  switch (t) {
    case '上推':
      return {transform: `translateY(${(1 - s) * H}px)`};
    case '左推':
      return {transform: `translateX(${(1 - s) * W}px)`};
    case '右推':
      return {transform: `translateX(${-(1 - s) * W}px)`};
    case '圆形扩散':
      return {clipPath: `circle(${interpolate(frame, [0, 16], [0, 1400], {...clamp, easing: Easing.inOut(Easing.cubic)})}px at 50% 60%)`};
    case '三角推进': {
      const p = interpolate(frame, [0, 18], [0, 1], {...clamp, easing: Easing.in(Easing.cubic)});
      const apexY = interpolate(p, [0, 1], [H, -1600]);
      const halfW = interpolate(p, [0, 1], [0, 2600]);
      return {clipPath: `polygon(${W / 2}px ${apexY}px, ${W / 2 + halfW}px ${H}px, ${W / 2 - halfW}px ${H}px)`};
    }
    case '向下擦除':
      return {clipPath: `inset(0 0 ${interpolate(frame, [0, 14], [100, 0], {...clamp, easing: Easing.out(Easing.cubic)})}% 0)`};
    case '缩放': {
      const p = interpolate(frame, [0, 14], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
      return {transform: `scale(${0.55 + 0.45 * p})`, opacity: p, borderRadius: (1 - p) * 120, overflow: 'hidden'};
    }
    case '淡入':
      return {opacity: interpolate(frame, [0, 12], [0, 1], clamp)};
    case '直接切换':
      return {};
  }
};
// 背景配色 → 背景色和两行标题的颜色
const themeOf = (配色名: z.infer<typeof 配色>, 品牌: Props['品牌']): {bg: string; colors: [string, string]} =>
  配色名 === '白底'
    ? {bg: 品牌.背景色, colors: [品牌.深色, 品牌.主色]}
    : {bg: 配色名 === '蓝底' ? 品牌.主色 : 品牌.深色, colors: ['rgba(255,255,255,.88)', '#FFFFFF']};

/* ========= 开场：Logo 出现 ========= */
const Intro = () => {
  const {品牌, 开场} = useProps();
  const frame = useCurrentFrame();
  const s = useSpring(2, 100);
  const url = resolveSrc(品牌.图标);
  const t = interpolate(frame, [2, 20], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const anim: Record<Props['开场']['图标动画'], React.CSSProperties> = {
    旋转弹出: {transform: `scale(${Math.max(0, s)}) rotate(${(1 - s) * -20}deg)`},
    从上落下: {transform: `translateY(${-(1 - s) * 1100}px)`},
    放大淡入: {transform: `scale(${1.7 - 0.7 * t})`, opacity: t},
    翻转: {transform: `perspective(1400px) rotateY(${(1 - s) * 180}deg) scale(${0.6 + 0.4 * clamp01(s)})`, opacity: clamp01(s * 3)},
  };
  return (
    <AbsoluteFill style={{background: 品牌.背景色, alignItems: 'center', justifyContent: 'center'}}>
      <div style={anim[开场.图标动画]}>
        {url ? (
          <Img src={url} style={{width: 开场.图标大小}} />
        ) : (
          <Placeholder label="LOGO" hue={205} style={{width: 开场.图标大小, height: 开场.图标大小, borderRadius: 60}} />
        )}
      </div>
    </AbsoluteFill>
  );
};

/* ========= 示意动画（可选） =========
   功能页没放截图时，可以播放一段用代码画的「点一下 → 界面响应」示意动画。
   模板里默认没有：示意界面不是 App 的真实界面，不能用于提交。确实需要临时占位时，
   在这里登记：名字 → {node: 画面组件（画布 592×1283）, cues: 配套音效的时间点}。 */
const MOCKS: Record<string, {node: React.ReactNode; cues: Cue[]}> = {};

export const MOCK_NAMES = ['无', ...Object.keys(MOCKS)];

/* ========= 功能页：标题 + 手机（截图 / 录屏 / 示意动画） ========= */
const Feature: React.FC<{page: FeaturePage; dur: number; hue: number}> = ({page: p, dur, hue}) => {
  const {品牌} = useProps();
  const style = useEnterStyle(p.转场);
  const {bg, colors} = themeOf(p.配色, 品牌);
  return (
    <AbsoluteFill style={{background: bg, ...style}}>
      <Title lines={[p.第一行, p.第二行]} colors={colors} anim={p.标题动画} />
      <Phone src={p.截图} label={`${p.名称} 截图`} hue={hue} spots={p.高亮} mock={MOCKS[p.示意]?.node} fx={p} dur={dur}>
        {p.提示.开启 && <Badge red={p.提示.红色文字} green={p.提示.绿色文字} />}
      </Phone>
    </AbsoluteFill>
  );
};

// 盖在手机画面上的两条提示：先弹出红色的，再换成绿色的
const Badge: React.FC<{red: string; green: string}> = ({red, green}) => {
  const frame = useCurrentFrame();
  const damping = useDamping();
  const a = spring({frame: frame - 26, fps: FPS, config: {damping, stiffness: 150}});
  const b = spring({frame: frame - 56, fps: FPS, config: {damping, stiffness: 150}});
  const dim = interpolate(frame, [26, 36, 56, 66], [0, 0.35, 0.35, 0], clamp);
  const pill = (bg: string, s: number): React.CSSProperties => ({
    position: 'absolute',
    left: '50%',
    top: '42%',
    transform: `translate(-50%,-50%) scale(${Math.max(0, s)})`,
    background: bg,
    color: 'white',
    borderRadius: 60,
    padding: '26px 44px',
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    fontFamily: FONT,
    fontWeight: 800,
    fontSize: 44,
    whiteSpace: 'nowrap',
    boxShadow: '0 16px 40px rgba(0,0,0,.35)',
  });
  return (
    <>
      <div style={{position: 'absolute', inset: 0, background: `rgba(0,0,0,${dim})`}} />
      <div style={pill('#D93A3A', a * (1 - clamp01(b)))}>
        <svg width="54" height="44" viewBox="0 0 54 44">
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={i * 14} y={30 - i * 10} width="9" height={14 + i * 10} rx="2" fill="white" opacity={0.35} />
          ))}
          <line x1="2" y1="4" x2="52" y2="42" stroke="white" strokeWidth="5" strokeLinecap="round" />
        </svg>
        {red}
      </div>
      <div style={pill('#19A35B', b)}>
        <svg width="48" height="48" viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="22" fill="white" />
          <path d="M13 25l8 8 15-17" stroke="#19A35B" strokeWidth="5.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {green}
      </div>
    </>
  );
};

/* ========= 地点页：标题 + 一组卡片 ========= */
const Places: React.FC<{page: CardPage}> = ({page: p}) => {
  const {品牌} = useProps();
  const frame = useCurrentFrame();
  const damping = useDamping();
  const style = useEnterStyle(p.转场);
  const {bg, colors} = themeOf(p.配色, 品牌);
  const size = 330;
  return (
    <AbsoluteFill style={{background: bg, ...style}}>
      <Title lines={[p.第一行, p.第二行]} colors={colors} anim={p.标题动画} />
      {p.卡片.map((it, i) => {
        const s = spring({frame: frame - 12 - i * 4, fps: FPS, config: {damping, stiffness: 110}});
        const left = i % 2 === 0;
        const x = left ? 90 : W - 90 - size;
        const y = 520 + Math.floor(i / 2) * (size + 60) + (left ? 0 : 50);
        const rot = (left ? -1 : 1) * (3 + (i % 3) * 1.5);
        const pos: Record<CardPage['卡片动画'], React.CSSProperties> = {
          两侧飞入: {left: interpolate(s, [0, 1], [left ? -500 : 950, x]), top: y, transform: `rotate(${rot * s}deg) scale(${0.5 + 0.5 * s})`},
          原地弹出: {left: x, top: y, transform: `rotate(${rot}deg) scale(${Math.max(0, s)})`},
          从上落下: {left: x, top: y - (1 - s) * 1500, transform: `rotate(${rot * s}deg)`},
          翻牌: {left: x, top: y, transform: `perspective(1200px) rotateY(${(1 - clamp01(s)) * 90}deg) rotate(${rot}deg)`},
        };
        const url = resolveSrc(it.图片);
        const shadow = '0 20px 50px rgba(0,0,0,.18)';
        return (
          <div key={i} style={{position: 'absolute', opacity: clamp01(s * 2), ...pos[p.卡片动画]}}>
            {url ? (
              <Img src={url} style={{width: size, height: size, objectFit: 'cover', borderRadius: 40, boxShadow: shadow}} />
            ) : (
              <Placeholder
                label={it.文字}
                hue={it.色相}
                style={{width: size, height: size, borderRadius: 40, fontSize: 36, padding: 20, boxSizing: 'border-box', boxShadow: shadow}}
              />
            )}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/* ========= 结尾：字标 + 标语 ========= */
const End = () => {
  const {品牌, 结尾} = useProps();
  const frame = useCurrentFrame();
  const style = useEnterStyle(结尾.转场);
  const s = useSpring(6, 120);
  const t = interpolate(frame, [4, 22], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)});
  const text = interpolate(frame, [18, 30], [0, 1], clamp);
  const url = resolveSrc(品牌.字标);
  const anim: Record<Props['结尾']['标志动画'], React.CSSProperties> = {
    弹出: {transform: `scale(${Math.max(0, s)})`},
    放大淡入: {transform: `scale(${1.5 - 0.5 * t})`, opacity: t},
    从下升起: {transform: `translateY(${(1 - s) * 320}px)`, opacity: clamp01(s * 1.5)},
  };
  return (
    <AbsoluteFill style={{background: 品牌.背景色, alignItems: 'center', justifyContent: 'center', ...style}}>
      <div style={anim[结尾.标志动画]}>
        {url ? (
          <Img src={url} style={{width: 结尾.字标宽度}} />
        ) : (
          <Placeholder label="LOGO" hue={205} style={{width: 结尾.字标宽度, height: 140, borderRadius: 24}} />
        )}
      </div>
      <div
        style={{marginTop: 56, fontFamily: FONT, fontWeight: 700, fontSize: 54, color: 品牌.深色, opacity: text, transform: `translateY(${(1 - text) * 30}px)`}}
      >
        {品牌.标语}
      </div>
    </AbsoluteFill>
  );
};

/* ========= 音效：全部是 tools/make_sfx.py 用代码合成的原创素材 =========
   这里按每页的动作时间点排好：转场、点击、弹出、成功提示。 */
type Cue = {at: number; name: string; gain?: number};
const QUIET: Transition[] = ['淡入', '直接切换']; // 这两种转场不配「唰」的声音
const sceneCues = (p: Props, sc: Scene): Cue[] => {
  if (sc.id === 'intro') return [{at: 2, name: 'pop'}];
  if (sc.id === 'end') return [{at: 6, name: 'chime'}];
  const pg = p.页面[sc.id];
  const enter = (name: string): Cue[] => (QUIET.includes(pg.转场) ? [] : [{at: 0, name, gain: 0.8}]);
  if (pg.类型 === '卡片页') return [...enter('swipe'), ...pg.卡片.map((_, i) => ({at: 12 + i * 4, name: 'pop-soft'}))];
  const shot = pg.截图.trim();
  const tm = spotTiming(pg.讲解停留);
  const spots: Cue[] =
    shot && !/\.(mp4|mov|webm)$/i.test(shot)
      ? pg.高亮.flatMap((_, i) => [...(pg.显示手指 ? [{at: tm.first + i * tm.every - 6, name: 'click'}] : []), {at: tm.first + i * tm.every, name: 'pop'}])
      : [];
  return [
    ...enter('whoosh'),
    ...(shot ? spots : (MOCKS[pg.示意]?.cues ?? [])),
    ...(pg.提示.开启
      ? [
          {at: 26, name: 'alert'},
          {at: 56, name: 'success'},
        ]
      : []),
  ];
};

const Soundtrack = () => {
  const p = useProps();
  const vol = p.样式.音效音量;
  if (vol <= 0) return null;
  let from = 0;
  return (
    <>
      {scenesOf(p).flatMap((sc, n) => {
        const start = from;
        from += sc.frames;
        return sceneCues(p, sc).map((c, i) => (
          <Sequence
            key={`${n}-${i}`}
            from={start + c.at}
            durationInFrames={c.name === 'chime' ? 60 : 20}
            layout="none"
            name={`♪ ${c.name}`}
            showInTimeline={false}
          >
            <Audio src={staticFile(`sfx/${c.name}.wav`)} volume={vol * (c.gain ?? 1)} />
          </Sequence>
        ));
      })}
    </>
  );
};

/* ========= 总时间轴：后面的段落叠在前面之上，靠各自的转场盖住上一段 ========= */
export const AppPreview: React.FC<Props> = (props) => {
  const scenes = scenesOf(props);
  let from = 0;
  return (
    <Ctx.Provider value={props}>
      <AbsoluteFill style={{background: props.品牌.背景色}}>
        {scenes.map((sc, n) => {
          const start = from;
          from += sc.frames;
          const last = n === scenes.length - 1;
          const page = typeof sc.id === 'number' ? props.页面[sc.id] : null;
          return (
            <Sequence key={n} name={`${n + 1} ${sc.name}`} from={start} durationInFrames={sc.frames + (last ? 0 : OVERLAP)}>
              {sc.id === 'intro' ? (
                <Intro />
              ) : sc.id === 'end' ? (
                <End />
              ) : page!.类型 === '功能页' ? (
                <Feature page={page as FeaturePage} dur={sc.frames} hue={(205 + n * 55) % 360} />
              ) : (
                <Places page={page as CardPage} />
              )}
            </Sequence>
          );
        })}
        <Soundtrack />
      </AbsoluteFill>
    </Ctx.Provider>
  );
};
