/* 控制台里的视频预览播放器（替代原来的 Remotion 播放器）。
   它只负责「现在是第几帧」：播放时按真实时间往前走，拖动进度条时跳帧；
   画面由视频组件按帧号自己画（见 src/engine.tsx），音效按时间点播放。 */
import React, {useCallback, useEffect, useImperativeHandle, useRef, useState} from 'react';
import {FrameProvider} from '../src/engine';

export type Sound = {frame: number; src: string; volume: number};
type Listener = (e: CustomEvent<{frame: number}>) => void;
export type PlayerRef = {
  seekTo: (frame: number) => void;
  play: () => void;
  pause: () => void;
  getCurrentFrame: () => number;
  isPlaying: () => boolean;
  addEventListener: (name: 'frameupdate' | 'play' | 'pause', cb: Listener) => void;
  removeEventListener: (name: 'frameupdate' | 'play' | 'pause', cb: Listener) => void;
};

type Props<P> = {
  component: React.ComponentType<P>;
  inputProps: P;
  durationInFrames: number;
  fps: number;
  compositionWidth: number;
  compositionHeight: number;
  style?: React.CSSProperties;
  controls?: boolean;
  loop?: boolean;
  sounds?: Sound[];
};

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function PlayerInner<P extends object>(props: Props<P>, ref: React.ForwardedRef<PlayerRef>) {
  const {component: Comp, inputProps, durationInFrames: total, fps, compositionWidth: W, compositionHeight: H, style, controls, loop, sounds = []} = props;
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [scale, setScale] = useState(1);
  const box = useRef<HTMLDivElement>(null);

  // 用 ref 保存最新值，给计时循环和对外接口读
  const s = useRef({frame: 0, playing: false, total, loop, muted, sounds, fps});
  s.current.total = total;
  s.current.loop = loop;
  s.current.muted = muted;
  s.current.sounds = sounds;
  s.current.fps = fps;
  const listeners = useRef(new Map<string, Set<Listener>>());
  const emit = (name: string, f: number) => listeners.current.get(name)?.forEach((cb) => cb(new CustomEvent(name, {detail: {frame: f}})));

  // 音效：提前加载，到时间点就播一个副本（同一个音效可以重叠）
  const cache = useRef(new Map<string, HTMLAudioElement>());
  useEffect(() => {
    for (const snd of sounds)
      if (!cache.current.has(snd.src)) {
        const a = new Audio(snd.src);
        a.preload = 'auto';
        cache.current.set(snd.src, a);
      }
  }, [sounds]);
  const playSounds = (from: number, to: number) => {
    if (s.current.muted) return;
    for (const snd of s.current.sounds)
      if (snd.frame > from && snd.frame <= to) {
        const a = (cache.current.get(snd.src)?.cloneNode() as HTMLAudioElement) ?? new Audio(snd.src);
        a.volume = Math.max(0, Math.min(1, snd.volume));
        a.play().catch(() => undefined);
      }
  };

  const setF = useCallback((f: number) => {
    const clamped = Math.max(0, Math.min(s.current.total - 1, Math.round(f)));
    s.current.frame = clamped;
    setFrame(clamped);
    emit('frameupdate', clamped);
  }, []);

  // 播放：按真实时间推进帧号
  const raf = useRef(0);
  const clock = useRef({t0: 0, f0: 0, last: 0});
  const tick = useCallback(() => {
    const {fps: rate, total: n} = s.current;
    let f = clock.current.f0 + ((performance.now() - clock.current.t0) / 1000) * rate;
    if (f >= n) {
      if (s.current.loop) {
        playSounds(clock.current.last, n);
        clock.current = {t0: performance.now(), f0: 0, last: -1};
        f = 0;
      } else {
        setF(n - 1);
        stop();
        return;
      }
    }
    const fi = Math.floor(f);
    if (fi !== clock.current.last) {
      playSounds(clock.current.last, fi);
      clock.current.last = fi;
      setF(fi);
    }
    raf.current = requestAnimationFrame(tick);
  }, []);
  const start = () => {
    if (s.current.playing) return;
    if (s.current.frame >= s.current.total - 1) s.current.frame = 0;
    s.current.playing = true;
    setPlaying(true);
    clock.current = {t0: performance.now(), f0: s.current.frame, last: s.current.frame - 1};
    raf.current = requestAnimationFrame(tick);
    emit('play', s.current.frame);
  };
  const stop = () => {
    if (!s.current.playing) return;
    s.current.playing = false;
    setPlaying(false);
    cancelAnimationFrame(raf.current);
    emit('pause', s.current.frame);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  useImperativeHandle(ref, () => ({
    seekTo: (f) => {
      setF(f);
      if (s.current.playing) clock.current = {t0: performance.now(), f0: s.current.frame, last: s.current.frame};
    },
    play: start,
    pause: stop,
    getCurrentFrame: () => s.current.frame,
    isPlaying: () => s.current.playing,
    addEventListener: (name, cb) => {
      if (!listeners.current.has(name)) listeners.current.set(name, new Set());
      listeners.current.get(name)!.add(cb);
    },
    removeEventListener: (name, cb) => listeners.current.get(name)?.delete(cb),
  }));

  // 帧数变少（比如删了一页）时，别停在超出范围的位置
  useEffect(() => {
    if (s.current.frame > total - 1) setF(total - 1);
  }, [total]);

  // 按容器宽度把 886×1920 的画面缩小显示
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, [W]);

  const bar: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 10px',
    color: '#fff',
    fontSize: 13,
    background: 'linear-gradient(transparent, rgba(0,0,0,.55))',
  };
  const btn: React.CSSProperties = {background: 'none', border: 0, color: '#fff', cursor: 'pointer', fontSize: 16, padding: '2px 4px', lineHeight: 1};
  return (
    <div style={{position: 'relative', ...style}}>
      <div
        ref={box}
        style={{position: 'relative', width: '100%', aspectRatio: `${W} / ${H}`, overflow: 'hidden', background: '#000'}}
        onClick={() => (s.current.playing ? stop() : start())}
      >
        <div style={{position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${scale})`, transformOrigin: '0 0', overflow: 'hidden'}}>
          <FrameProvider frame={frame} playing={playing}>
            <Comp {...inputProps} />
          </FrameProvider>
        </div>
      </div>
      {controls && (
        <div style={{position: 'absolute', left: 0, right: 0, bottom: 0}} onClick={(e) => e.stopPropagation()}>
          <input
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            value={frame}
            onChange={(e) => {
              const f = Number(e.target.value);
              setF(f);
              if (s.current.playing) clock.current = {t0: performance.now(), f0: f, last: f};
            }}
            style={{width: '100%', margin: 0, display: 'block', accentColor: '#fff'}}
            aria-label="进度"
          />
          <div style={bar}>
            <button style={btn} onClick={() => (s.current.playing ? stop() : start())} aria-label={playing ? '暂停' : '播放'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button style={btn} onClick={() => setMuted((m) => !m)} aria-label={muted ? '打开声音' : '静音'}>
              {muted ? '🔇' : '🔊'}
            </button>
            <span style={{fontVariantNumeric: 'tabular-nums'}}>
              {fmt(frame / fps)} / {fmt(total / fps)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export const Player = React.forwardRef(PlayerInner) as <P extends object>(p: Props<P> & {ref?: React.Ref<PlayerRef>}) => React.ReactElement;
