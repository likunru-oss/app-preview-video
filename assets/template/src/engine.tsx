/* 我们自己的动画引擎小零件：视频代码里用到的帧号、缓动、插值、弹簧、时间段、定格、图片、录屏、音效。
   全部是自己写的，不依赖 Remotion。

   约定：画面是「第几帧」的函数。外面决定现在是第几帧——
   - 导出时：HyperFrames 渲染器逐帧发「跳到第 t 秒」，见 composition/entry.tsx
   - 预览时：控制台里的播放器（control/player.tsx）按时间推进帧号
   组件按帧号画出那一刻的样子，不依赖上一帧。 */
import React from 'react';

/* ---------- 帧号 ---------- */
// 当前组件看到的帧号（已经减去所在段落的起点）
const FrameCtx = React.createContext(0);
// 预览时是否在播放：录屏在播放时跟着走，暂停时停在对应那一帧
const PlayingCtx = React.createContext(false);
export const FrameProvider: React.FC<{frame: number; playing?: boolean; children: React.ReactNode}> = ({frame, playing = false, children}) => (
  <PlayingCtx.Provider value={playing}>
    <FrameCtx.Provider value={frame}>{children}</FrameCtx.Provider>
  </PlayingCtx.Provider>
);
export const useCurrentFrame = () => React.useContext(FrameCtx);

/* ---------- 缓动曲线 ---------- */
type Ease = (t: number) => number;
export const Easing = {
  linear: ((t) => t) as Ease,
  quad: ((t) => t * t) as Ease,
  cubic: ((t) => t * t * t) as Ease,
  in: (f: Ease): Ease => f,
  out:
    (f: Ease): Ease =>
    (t) =>
      1 - f(1 - t),
  inOut:
    (f: Ease): Ease =>
    (t) =>
      t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2,
};

/* ---------- 数值插值 ---------- */
type Extrapolate = 'clamp' | 'extend' | 'identity';
type InterpolateOptions = {extrapolateLeft?: Extrapolate; extrapolateRight?: Extrapolate; easing?: Ease};
// 把输入值按分段线性的方式映射到输出区间。段内可加缓动；超出两端默认继续延伸，'clamp' 则停在端点
export const interpolate = (input: number, inRange: readonly number[], outRange: readonly number[], opts: InterpolateOptions = {}): number => {
  const n = inRange.length;
  if (n < 2 || n !== outRange.length) throw new Error('interpolate: inRange 和 outRange 至少两个点，且长度相同');
  const left = opts.extrapolateLeft ?? 'extend';
  const right = opts.extrapolateRight ?? 'extend';
  const ease = opts.easing ?? Easing.linear;
  if (input < inRange[0]) {
    if (left === 'clamp') return outRange[0];
    if (left === 'identity') return input;
  }
  if (input > inRange[n - 1]) {
    if (right === 'clamp') return outRange[n - 1];
    if (right === 'identity') return input;
  }
  let i = 0;
  while (i < n - 2 && input > inRange[i + 1]) i++;
  const x0 = inRange[i];
  const x1 = inRange[i + 1];
  const y0 = outRange[i];
  const y1 = outRange[i + 1];
  if (x1 === x0) return y1;
  const t = (input - x0) / (x1 - x0);
  // 只在段内应用缓动；延伸到段外时保持线性
  const e = t >= 0 && t <= 1 ? ease(t) : t;
  return y0 + (y1 - y0) * e;
};

/* ---------- 弹簧 ---------- */
// 阻尼弹簧从 from 走向 to（初速度 0）。用解析解，第 n 帧的值只取决于 n，可以任意跳帧
export const spring = ({
  frame,
  fps,
  config = {},
  from = 0,
  to = 1,
}: {
  frame: number;
  fps: number;
  config?: {damping?: number; stiffness?: number; mass?: number};
  from?: number;
  to?: number;
}): number => {
  if (frame <= 0) return from;
  const m = config.mass ?? 1;
  const k = config.stiffness ?? 100;
  const c = config.damping ?? 10;
  const t = frame / fps;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  let x: number; // 离终点还差多少（1 → 0）
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    x = Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  } else if (zeta === 1) {
    x = Math.exp(-w0 * t) * (1 + w0 * t);
  } else {
    const s = w0 * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * w0 + s;
    const r2 = -zeta * w0 - s;
    x = (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  }
  return from + (to - from) * (1 - x);
};

/* ---------- 布局与时间段 ---------- */
export const AbsoluteFill: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({style, ...rest}) => (
  <div {...rest} style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', ...style}} />
);

// 一个时间段：只在 [from, from + durationInFrames) 之间出现，里面看到的帧号从 0 开始
export const Sequence: React.FC<{
  from?: number;
  durationInFrames?: number;
  layout?: 'absolute-fill' | 'none';
  name?: string;
  showInTimeline?: boolean;
  children?: React.ReactNode;
}> = ({from = 0, durationInFrames = Infinity, layout = 'absolute-fill', children}) => {
  const frame = useCurrentFrame();
  const local = frame - from;
  if (local < 0 || local >= durationInFrames) return null;
  const inner = <FrameCtx.Provider value={local}>{children}</FrameCtx.Provider>;
  return layout === 'none' ? inner : <AbsoluteFill>{inner}</AbsoluteFill>;
};

// 把里面的内容定格在某一帧（定格时录屏也不再播放）
export const Freeze: React.FC<{frame: number; active?: boolean; children: React.ReactNode}> = ({frame, active = true, children}) =>
  active ? (
    <PlayingCtx.Provider value={false}>
      <FrameCtx.Provider value={frame}>{children}</FrameCtx.Provider>
    </PlayingCtx.Provider>
  ) : (
    <>{children}</>
  );

/* ---------- 素材 ---------- */
// 素材路径：public/ 里的文件。预览时控制台的服务器从网站根目录提供；导出时被复制到合成页的根目录
export const staticFile = (path: string) => '/' + path.replace(/^\/+/, '');

export const Img: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = (props) => <img {...props} />;

type FrameSet = {dir: string; fps: number; count: number; start?: number};
// 录屏。该显示录屏的哪一秒 = （起点 + 当前帧 × 速度）÷ 帧率
// - 导出时：打包阶段已用 FFmpeg 把录屏拆成一张张图片，这里直接显示对应那一张（确定、不依赖浏览器解码）
// - 预览时：用 <video>，暂停时跳到那一秒，播放时跟着播放
export const OffthreadVideo: React.FC<
  Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'> & {src: string; trimBefore?: number; startFrom?: number; playbackRate?: number; fps?: number}
> = ({src, trimBefore, startFrom, playbackRate = 1, fps = 30, ...rest}) => {
  const frame = useCurrentFrame();
  const playing = React.useContext(PlayingCtx);
  const want = ((trimBefore ?? startFrom ?? 0) + frame * playbackRate) / fps;
  const ref = React.useRef<HTMLVideoElement>(null);
  const frames = (globalThis as {__VFRAMES?: Record<string, FrameSet>}).__VFRAMES?.[src];

  React.useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.playbackRate = playbackRate;
    const target = Math.min(want, Math.max(0, (v.duration || Infinity) - 0.05));
    if (playing) {
      if (Math.abs(v.currentTime - target) > 0.4) v.currentTime = target;
      if (v.paused) v.play().catch(() => undefined);
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.02) v.currentTime = target;
    }
  });
  React.useEffect(() => () => ref.current?.pause(), []);

  if (frames) {
    const i = Math.min(frames.count, Math.max(1, Math.round((want - (frames.start ?? 0)) * frames.fps) + 1));
    return <img className={rest.className} style={rest.style} src={`${frames.dir}/${String(i).padStart(5, '0')}.jpg`} alt="" />;
  }
  return <video {...rest} ref={ref} src={src} muted playsInline preload="auto" data-want-time={want.toFixed(4)} />;
};

// 音效不在画面里出声：导出时按时间点生成 <audio> 标签交给 HyperFrames 混音；预览时由控制台的播放器按时间点播放
export const Audio: React.FC<{src: string; volume?: number}> = () => null;

/* ---------- 截图前等画面就绪（导出用） ---------- */
// 等：字体加载、图片解码
export const settle = async (root: ParentNode = document) => {
  await (document as Document).fonts?.ready;
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => (img.complete && img.naturalWidth > 0 ? Promise.resolve() : img.decode().catch(() => undefined))));
};
