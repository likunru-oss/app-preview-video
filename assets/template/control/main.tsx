import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Player, type PlayerRef} from './player';
import {
  AppPreview,
  allSoundCues,
  FPS,
  MOCK_NAMES,
  OPTIONS,
  endFrameOf,
  mapAreaOf,
  newCardPage,
  recOf,
  recPlayableSeconds,
  newFeaturePage,
  scenesOf,
  totalFrames,
  type CardPage,
  type FeaturePage,
  type Props,
} from '../src/AppPreview';

/* ---------- 小工具 ---------- */
type Path = (string | number)[];
const setIn = (obj: unknown, path: Path, value: unknown): unknown => {
  if (path.length === 0) return value;
  const [k, ...rest] = path;
  if (Array.isArray(obj)) {
    const copy = obj.slice();
    copy[k as number] = setIn(copy[k as number], rest, value);
    return copy;
  }
  const o = obj as Record<string, unknown>;
  return {...o, [k]: setIn(o[k as string], rest, value)};
};
const isVideo = (f: string) => /\.(mp4|mov|webm)$/i.test(f);
const fileUrl = (f: string) => (/^(https?:|data:)/.test(f) ? f : '/' + f);

/* ---------- 基础控件 ---------- */
const Field: React.FC<{label: string; help?: string; children: React.ReactNode}> = ({label, help, children}) => (
  <div className="field">
    <label>{label}</label>
    {children}
    {help && <div className="help">{help}</div>}
  </div>
);

const Text: React.FC<{label: string; value: string; onChange: (v: string) => void; help?: string}> = ({label, value, onChange, help}) => (
  <Field label={label} help={help}>
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
  </Field>
);

const Slider: React.FC<{label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; help?: string}> = ({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
  help,
}) => (
  <Field label={label} help={help}>
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>
        {value}
        {unit}
      </output>
    </div>
  </Field>
);

const Color: React.FC<{label: string; value: string; onChange: (v: string) => void}> = ({label, value, onChange}) => (
  <Field label={label}>
    <div className="color">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <span>{value}</span>
    </div>
  </Field>
);

// 一排可点的选项，选中的那个高亮
const Choice: React.FC<{label: string; value: string; options: readonly string[]; onChange: (v: string) => void; help?: string}> = ({
  label,
  value,
  options,
  onChange,
  help,
}) => (
  <Field label={label} help={help}>
    <div className="choices">
      {options.map((o) => (
        <button key={o} className={'opt' + (o === value ? ' on' : '')} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  </Field>
);

const Toggle: React.FC<{label: string; value: boolean; onChange: (v: boolean) => void}> = ({label, value, onChange}) => (
  <label className="toggle">
    <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);

const Sub: React.FC<{children: React.ReactNode}> = ({children}) => <div className="sub">{children}</div>;

// 素材框：把图片或录屏拖进来，或者点一下选文件
const Drop: React.FC<{label: string; value: string; onChange: (v: string) => void; video?: boolean; wide?: boolean; emptyText: string; help?: string}> = ({
  label,
  value,
  onChange,
  video,
  wide,
  emptyText,
  help,
}) => {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/upload?name=' + encodeURIComponent(file.name), {method: 'POST', body: file});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '上传失败');
      onChange(j.file);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field label={label} help={err || help}>
      <div
        className={'drop' + (over ? ' over' : '')}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) upload(f);
        }}
      >
        <div className={'thumb' + (wide ? ' wide' : '')} style={value && !isVideo(value) ? {backgroundImage: `url("${fileUrl(value)}")`} : undefined}>
          {!value ? '无' : isVideo(value) ? '录屏' : ''}
        </div>
        <div className="txt">
          <b>{busy ? '正在上传…' : value ? (isVideo(value) ? '已放入录屏' : '已放入图片') : emptyText}</b>
          <span>把{video ? '图片或录屏' : '图片'}拖到这里，或者点一下选文件</span>
        </div>
        {value && (
          <button
            className="btn small danger"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
          >
            移除
          </button>
        )}
        <input
          ref={input}
          type="file"
          hidden
          accept={video ? 'image/png,image/jpeg,image/webp,video/mp4,video/quicktime' : 'image/png,image/jpeg,image/webp'}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = '';
          }}
        />
      </div>
    </Field>
  );
};

// 高亮编辑：直接在截图上拖一个框，这块区域在视频里就会被放大
type Spot = FeaturePage['高亮'][number];
// 编辑区里显示的一帧画面：截图直接显示；录屏显示设定起点那一帧
const Still: React.FC<{src: string; t?: number}> = ({src, t = 0}) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v && v.readyState >= 1) v.currentTime = t;
  }, [t]);
  if (!isVideo(src)) return <img src={fileUrl(src)} alt="" draggable={false} />;
  return (
    <video
      ref={ref}
      src={fileUrl(src)}
      muted
      playsInline
      preload="auto"
      onLoadedMetadata={(e) => (e.currentTarget.currentTime = t)}
      style={{display: 'block', width: '100%', aspectRatio: '592 / 1283', objectFit: 'cover', objectPosition: 'top', pointerEvents: 'none'}}
    />
  );
};

// 读出录屏有多长（秒），读到后告诉外面一次
const VideoLength: React.FC<{src: string; onLength: (sec: number) => void}> = ({src, onLength}) => (
  <video
    src={fileUrl(src)}
    preload="metadata"
    muted
    style={{display: 'none'}}
    onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && onLength(e.currentTarget.duration)}
  />
);

const Spots: React.FC<{image: string; t?: number; value: Spot[]; onChange: (v: Spot[]) => void}> = ({image, t, value, onChange}) => {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{x0: number; y0: number; x1: number; y1: number} | null>(null);
  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))};
  };
  const rect = (d: NonNullable<typeof draft>) => ({左: Math.min(d.x0, d.x1), 上: Math.min(d.y0, d.y1), 宽: Math.abs(d.x1 - d.x0), 高: Math.abs(d.y1 - d.y0)});
  const round = (n: number) => Math.round(n * 2) / 2;
  return (
    <Field
      label="放大讲解的区域"
      help="在左边的画面上按住拖出一个框（录屏显示的是开始那一帧）。视频里手指会点这块区域，然后它放大弹出，旁边显示你填的说明。建议 2–3 个。"
    >
      <div className="spots">
        <div
          className="canvas"
          ref={box}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = pos(e);
            setDraft({x0: p.x, y0: p.y, x1: p.x, y1: p.y});
          }}
          onPointerMove={(e) => {
            if (!draft) return;
            const p = pos(e);
            setDraft({...draft, x1: p.x, y1: p.y});
          }}
          onPointerUp={() => {
            if (draft) {
              const r = rect(draft);
              if (r.宽 > 3 && r.高 > 2) onChange([...value, {文字: '说明文字', 左: round(r.左), 上: round(r.上), 宽: round(r.宽), 高: round(r.高)}]);
            }
            setDraft(null);
          }}
        >
          <Still src={image} t={t} />
          {value.map((s, i) => (
            <div key={i} className="box" style={{left: s.左 + '%', top: s.上 + '%', width: s.宽 + '%', height: s.高 + '%'}}>
              <em>{i + 1}</em>
            </div>
          ))}
          {draft &&
            (() => {
              const r = rect(draft);
              return <div className="box draft" style={{left: r.左 + '%', top: r.上 + '%', width: r.宽 + '%', height: r.高 + '%'}} />;
            })()}
        </div>
        <div className="list">
          {value.length === 0 && <div className="empty">还没有区域。在截图上拖一个框试试。</div>}
          {value.map((s, i) => (
            <div className="item" key={i}>
              <div className="num">{i + 1}</div>
              <input type="text" value={s.文字} onChange={(e) => onChange(value.map((v, j) => (j === i ? {...v, 文字: e.target.value} : v)))} />
              <button className="btn small danger" onClick={() => onChange(value.filter((_, j) => j !== i))}>
                删除
              </button>
            </div>
          ))}
        </div>
      </div>
    </Field>
  );
};

// 在截图上框出一个位置（只保留一个框），用来告诉视频小车在哪
type Box = {左: number; 上: number; 宽: number; 高: number};
const BoxPicker: React.FC<{image: string; t?: number; value: Box; color?: string; ghost?: Box; onChange: (v: Box) => void}> = ({
  image,
  t,
  value,
  color = '#F08A24',
  ghost,
  onChange,
}) => {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{x0: number; y0: number; x1: number; y1: number} | null>(null);
  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))};
  };
  const rect = (d: NonNullable<typeof draft>) => ({左: Math.min(d.x0, d.x1), 上: Math.min(d.y0, d.y1), 宽: Math.abs(d.x1 - d.x0), 高: Math.abs(d.y1 - d.y0)});
  const round = (n: number) => Math.round(n * 2) / 2;
  const shown = draft ? rect(draft) : value;
  return (
    <div
      className="canvas"
      ref={box}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = pos(e);
        setDraft({x0: p.x, y0: p.y, x1: p.x, y1: p.y});
      }}
      onPointerMove={(e) => {
        if (!draft) return;
        const p = pos(e);
        setDraft({...draft, x1: p.x, y1: p.y});
      }}
      onPointerUp={() => {
        if (draft) {
          const r = rect(draft);
          if (r.宽 > 2 && r.高 > 2) onChange({左: round(r.左), 上: round(r.上), 宽: round(r.宽), 高: round(r.高)});
        }
        setDraft(null);
      }}
    >
      <Still src={image} t={t} />
      {ghost && (
        <div
          className="box"
          style={{
            left: ghost.左 + '%',
            top: ghost.上 + '%',
            width: ghost.宽 + '%',
            height: ghost.高 + '%',
            borderColor: '#F08A24',
            borderStyle: 'dashed',
            background: 'transparent',
          }}
        />
      )}
      <div
        className={'box' + (draft ? ' draft' : '')}
        style={{left: shown.左 + '%', top: shown.上 + '%', width: shown.宽 + '%', height: shown.高 + '%', borderColor: color, background: color + '33'}}
      />
    </div>
  );
};

// 在截图上拖出多个框（比如不跟着地图动的卡片），列表里可以删
const BoxesPicker: React.FC<{image: string; value: Box[]; ghost?: Box[]; color?: string; onChange: (v: Box[]) => void}> = ({
  image,
  value,
  ghost = [],
  color = '#7C3AED',
  onChange,
}) => {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{x0: number; y0: number; x1: number; y1: number} | null>(null);
  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))};
  };
  const rect = (d: NonNullable<typeof draft>) => ({左: Math.min(d.x0, d.x1), 上: Math.min(d.y0, d.y1), 宽: Math.abs(d.x1 - d.x0), 高: Math.abs(d.y1 - d.y0)});
  const round = (n: number) => Math.round(n * 2) / 2;
  const style = (b: Box, c: string, dashed = false): React.CSSProperties => ({
    left: b.左 + '%',
    top: b.上 + '%',
    width: b.宽 + '%',
    height: b.高 + '%',
    borderColor: c,
    borderStyle: dashed ? 'dashed' : 'solid',
    background: dashed ? 'transparent' : c + '33',
  });
  return (
    <div className="spots">
      <div
        className="canvas"
        ref={box}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = pos(e);
          setDraft({x0: p.x, y0: p.y, x1: p.x, y1: p.y});
        }}
        onPointerMove={(e) => {
          if (!draft) return;
          const p = pos(e);
          setDraft({...draft, x1: p.x, y1: p.y});
        }}
        onPointerUp={() => {
          if (draft) {
            const r = rect(draft);
            if (r.宽 > 2 && r.高 > 2) onChange([...value, {左: round(r.左), 上: round(r.上), 宽: round(r.宽), 高: round(r.高)}]);
          }
          setDraft(null);
        }}
      >
        <Still src={image} />
        {ghost.map((g, k) => (
          <div key={'g' + k} className="box" style={style(g, '#1787CE', true)} />
        ))}
        {value.map((b, k) => (
          <div key={k} className="box" style={style(b, color)}>
            <em style={{background: color}}>{k + 1}</em>
          </div>
        ))}
        {draft && <div className="box draft" style={style(rect(draft), color)} />}
      </div>
      <div className="list">
        {value.length === 0 && <div className="empty">还没有标。在截图上按住拖一个框，框住一张卡片或一个按钮。</div>}
        {value.map((b, k) => (
          <div className="item" key={k}>
            <div className="num" style={{background: color}}>
              {k + 1}
            </div>
            <span style={{flex: 1, fontSize: 13, color: 'var(--muted)'}}>
              左 {b.左}% · 上 {b.上}% · {b.宽}×{b.高}
            </span>
            <button className="btn small danger" onClick={() => onChange(value.filter((_, j) => j !== k))}>
              删除
            </button>
          </div>
        ))}
        {value.length > 0 && (
          <button className="btn small danger" onClick={() => onChange([])}>
            全部清除
          </button>
        )}
      </div>
    </div>
  );
};

// 在截图上点一下，选手指点击的位置（百分比）
const PointPicker: React.FC<{image: string; t?: number; value: {左: number; 上: number}; onChange: (v: {左: number; 上: number}) => void}> = ({
  image,
  t,
  value,
  onChange,
}) => {
  const box = useRef<HTMLDivElement>(null);
  return (
    <div
      className="canvas"
      ref={box}
      onClick={(e) => {
        const r = box.current!.getBoundingClientRect();
        const round = (n: number) => Math.round(Math.max(0, Math.min(100, n)) * 2) / 2;
        onChange({左: round(((e.clientX - r.left) / r.width) * 100), 上: round(((e.clientY - r.top) / r.height) * 100)});
      }}
    >
      <Still src={image} t={t} />
      <div
        style={{
          position: 'absolute',
          left: value.左 + '%',
          top: value.上 + '%',
          width: 26,
          height: 26,
          marginLeft: -13,
          marginTop: -13,
          borderRadius: '50%',
          background: 'rgba(240,138,36,.55)',
          border: '3px solid #F08A24',
          boxShadow: '0 0 0 3px #fff',
        }}
      />
    </div>
  );
};

/* ---------- 主界面 ---------- */
type Job = {state: 'idle' | 'running' | 'done' | 'error'; progress: number; file: string; error: string};
// 当前选中的页签：开场、结尾、整体风格，或者第几个页面（数字）
type Active = 'intro' | 'end' | 'style' | number;

const App = () => {
  const [props, setProps] = useState<Props | null>(null);
  const [active, setActive] = useState<Active>(0);
  const [adding, setAdding] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [externalNote, setExternalNote] = useState('');
  const version = useRef('');
  const [job, setJob] = useState<Job>({state: 'idle', progress: 0, file: '', error: ''});
  const player = useRef<PlayerRef>(null);
  const dirty = useRef(false);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    fetch('/api/props')
      .then((r) => {
        version.current = r.headers.get('X-Version') ?? '';
        return r.json();
      })
      .then(setProps);
    fetch('/api/render')
      .then((r) => r.json())
      .then((j: Job) => j.state === 'running' && setJob(j));
  }, []);

  // 改动后半秒自动保存
  useEffect(() => {
    if (!props || !dirty.current) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      fetch('/api/props', {method: 'POST', body: JSON.stringify(props), headers: {'X-Base-Version': version.current}})
        .then(async (r) => {
          const j = await r.json();
          if (r.status === 409) {
            // 文件在这期间被改过：放弃这次保存，换成文件里的最新内容
            reloadFromFile('设置刚被 Claude 修改过，已换成最新内容。如果你刚才的最后一步改动没保存上，请再做一次。');
            return;
          }
          if (r.ok) version.current = j.version ?? version.current;
          setSaveState(r.ok ? 'saved' : 'error');
        })
        .catch(() => setSaveState('error'));
    }, 500);
    return () => clearTimeout(t);
  }, [props]);

  // 文件被外面改过时（比如 Claude 帮你改了设置），自动换成最新内容
  const reloadFromFile = (note: string) =>
    fetch('/api/props')
      .then((r) => {
        version.current = r.headers.get('X-Version') ?? '';
        return r.json();
      })
      .then((p) => {
        dirty.current = false;
        setProps(p);
        setSaveState('saved');
        setExternalNote(note);
      });
  useEffect(() => {
    const t = setInterval(() => {
      if (dirty.current && saveState !== 'saved') return; // 正在改、还没存的时候不打断
      fetch('/api/version')
        .then((r) => r.json())
        .then((j) => {
          if (version.current && j.version !== version.current) reloadFromFile('设置刚被 Claude 修改过，已自动换成最新内容。');
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(t);
  });

  // 导出进度
  useEffect(() => {
    if (job.state !== 'running') return;
    const t = setInterval(() => {
      fetch('/api/render')
        .then((r) => r.json())
        .then(setJob)
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(t);
  }, [job.state]);

  const set = useCallback((path: Path, value: unknown) => {
    dirty.current = true;
    setProps((p) => setIn(p, path, value) as Props);
  }, []);

  // 每个段落从第几帧开始、有多少帧
  const timeline = useMemo(() => {
    if (!props) return [];
    let n = 0;
    return scenesOf(props).map((sc) => {
      const start = n;
      n += sc.frames;
      return {...sc, start};
    });
  }, [props]);
  const sceneOf = (a: Active) => timeline.find((t) => t.id === a);

  // 点页签时，把视频跳到这一页里最能看出效果的那一帧
  const peek = (a: Active) => {
    if (!props || typeof a !== 'number') return a === 'intro' ? 30 : 45;
    const pg = props.页面[a];
    if (pg.类型 === '卡片页') return 60;
    if (pg.截图) return pg.高亮.length ? 52 : 40;
    return pg.示意 !== '无' ? 100 : 40;
  };
  const jump = (a: Active) => {
    setActive(a);
    setAdding(false);
    const sc = sceneOf(a);
    if (!sc) return;
    stopAt.current = null;
    player.current?.pause();
    player.current?.seekTo(sc.start + Math.min(sc.frames - 1, peek(a)));
  };
  // 重播某一页：从上一页的结尾开始放，这样能看到转场，放完这一页自动停
  const replay = (a: Active) => {
    const sc = sceneOf(a);
    const pl = player.current;
    if (!sc || !pl) return;
    stopAt.current = sc.start + sc.frames - (a === 'end' ? 2 : 0);
    pl.seekTo(Math.max(0, sc.start - 12));
    pl.play();
  };

  const ready = !!props;
  useEffect(() => {
    if (!ready) return;
    let pl: PlayerRef | null = null;
    const onFrame = (e: {detail: {frame: number}}) => {
      if (stopAt.current !== null && e.detail.frame >= stopAt.current) {
        stopAt.current = null;
        pl?.pause();
      }
    };
    const t = setTimeout(() => {
      pl = player.current;
      pl?.addEventListener('frameupdate', onFrame);
      jump(0);
    }, 300);
    return () => {
      clearTimeout(t);
      pl?.removeEventListener('frameupdate', onFrame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!props) return <div style={{padding: 24}}>正在打开…</div>;
  const total = totalFrames(props) / FPS;
  const tooLong = total > 30;
  const tooShort = total < 15;
  const pages = props.页面;

  // 改动效选项：保存，并马上重播这一页看效果
  const fx = (a: Active, path: Path, value: unknown) => {
    set(path, value);
    setTimeout(() => replay(a), 60);
  };

  /* ----- 页面的增、删、移动、复制 ----- */
  const setPages = (next: Props['页面'], goto: Active) => {
    set(['页面'], next);
    setActive(goto);
    setAdding(false);
  };
  const addPage = (pg: Props['页面'][number]) => setPages([...pages, pg], pages.length);
  const movePage = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= pages.length) return;
    const next = pages.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setPages(next, j);
  };
  const copyPage = (i: number) => {
    const next = pages.slice();
    next.splice(i + 1, 0, {...JSON.parse(JSON.stringify(pages[i])), 名称: pages[i].名称 + ' 副本'});
    setPages(next, i + 1);
  };
  const removePage = (i: number) => {
    if (!window.confirm(`删除「${pages[i].名称}」这一页？`)) return;
    const next = pages.filter((_, j) => j !== i);
    setPages(next, next.length ? Math.min(i, next.length - 1) : 'intro');
  };

  const pageTools = (i: number) => (
    <>
      <Text label="这一页的名字" value={pages[i].名称} onChange={(v) => set(['页面', i, '名称'], v)} help="只显示在上面的页签里，不会出现在视频里。" />
      <div className="tools">
        <button className="btn small" disabled={i === 0} onClick={() => movePage(i, -1)}>
          ← 往前移
        </button>
        <button className="btn small" disabled={i === pages.length - 1} onClick={() => movePage(i, 1)}>
          往后移 →
        </button>
        <button className="btn small" onClick={() => copyPage(i)}>
          复制这一页
        </button>
        <button className="btn small danger" onClick={() => removePage(i)}>
          删除这一页
        </button>
      </div>
    </>
  );

  const featureBody = (i: number, p: FeaturePage) => {
    const at = (key: string): Path => ['页面', i, key];
    const hasImage = !!p.截图 && !isVideo(p.截图);
    const hasMedia = !!p.截图;
    const vid = hasMedia && isVideo(p.截图);
    const rec = recOf(p);
    const playable = recPlayableSeconds(rec);
    const fitSeconds = Number.isFinite(playable) ? Math.round(playable * 2) / 2 : 0;
    return (
      <>
        {pageTools(i)}
        <Sub>内容</Sub>
        <div className="row2">
          <Text label="大字第一行" value={p.第一行} onChange={(v) => set(at('第一行'), v)} />
          <Text label="大字第二行" value={p.第二行} onChange={(v) => set(at('第二行'), v)} />
        </div>
        <Drop
          label={endFrameOf(p).图片 ? '手机里的画面（首帧）' : '手机里的画面'}
          value={p.截图}
          video
          onChange={(v) => set(at('截图'), v)}
          emptyText={p.示意 !== '无' ? '现在是示意动画' : '还没有画面'}
          help="放 App 的截图（png / jpg）或录屏（mp4 / mov）。"
        />
        <Drop
          label="播到中间换成另一张（尾帧，可选）"
          value={endFrameOf(p).图片}
          onChange={(v) => fx(i, at('尾帧'), {...endFrameOf(p), 图片: v})}
          emptyText="没有尾帧，整页只显示上面一张"
          help="适合展示「操作前 → 操作后」：比如首帧是点按钮之前，尾帧是点完之后的结果。"
        />
        {!p.截图 && MOCK_NAMES.length > 1 && (
          <Choice
            label="没放素材时显示什么"
            value={p.示意}
            options={MOCK_NAMES}
            onChange={(v) => fx(i, at('示意'), v)}
            help="示意动画是画出来的，不是 App 真实界面，只能临时占位，不能用于提交。"
          />
        )}
        {vid && (
          <>
            <VideoLength src={p.截图} onLength={(sec) => Math.abs(sec - rec.长度) > 0.05 && set(at('录屏'), {...rec, 长度: Math.round(sec * 100) / 100})} />
            <Sub>录屏怎么播</Sub>
            <Slider
              label="从录屏的第几秒开始播"
              value={Math.min(rec.开始, Math.max(0, rec.长度 - 0.5))}
              min={0}
              max={Math.max(0.5, Math.floor((rec.长度 - 0.5) * 10) / 10)}
              step={0.1}
              unit=" 秒"
              help="跳过录屏开头不需要的部分。"
              onChange={(v) => fx(i, at('录屏'), {...rec, 开始: v})}
            />
            <Slider
              label="播放速度"
              value={rec.速度}
              min={0.5}
              max={3}
              step={0.25}
              unit=" 倍"
              help="录屏太长时可以加快，比如 2 倍就是一半时间播完。"
              onChange={(v) => fx(i, at('录屏'), {...rec, 速度: v})}
            />
            {rec.长度 > 0 && (
              <div className="info">
                录屏一共 {rec.长度.toFixed(1)} 秒，按现在的起点和速度能播 {playable.toFixed(1)} 秒；这一页停留 {p.时长} 秒，
                {playable > p.时长 + 0.25
                  ? `所以只播到录屏的第 ${(rec.开始 + p.时长 * rec.速度).toFixed(1)} 秒。`
                  : playable < p.时长 - 0.25
                    ? '录屏播完后会停在最后一帧。'
                    : '正好播完。'}
                {Math.abs(playable - p.时长) > 0.25 && (
                  <button
                    className="btn small"
                    style={{marginLeft: 8}}
                    disabled={fitSeconds < 1.5}
                    onClick={() => set(at('时长'), Math.min(8, Math.max(1.5, fitSeconds)))}
                  >
                    {fitSeconds > 8 ? '页面加到最长 8 秒' : `这一页改成 ${Math.max(1.5, fitSeconds)} 秒，正好播完`}
                  </button>
                )}
                {fitSeconds > 8 && <div style={{marginTop: 6}}>录屏超过 8 秒，建议调高播放速度，或往后调起点。</div>}
              </div>
            )}
          </>
        )}
        {hasMedia && <Spots image={p.截图} t={rec.开始} value={p.高亮} onChange={(v) => set(at('高亮'), v)} />}
        <Slider label="这一页停留多久" value={p.时长} min={1.5} max={8} step={0.5} unit=" 秒" onChange={(v) => set(at('时长'), v)} />

        {endFrameOf(p).图片 && (
          <>
            <Sub>首帧怎么换成尾帧</Sub>
            <Choice label="切换效果" value={endFrameOf(p).切换} options={OPTIONS.切换效果} onChange={(v) => fx(i, at('尾帧'), {...endFrameOf(p), 切换: v})} />
            <Slider
              label="第几秒切换"
              value={Math.min(endFrameOf(p).切换时间, Math.max(0.5, p.时长 - 0.5))}
              min={0.5}
              max={Math.max(0.5, p.时长 - 0.5)}
              step={0.5}
              unit=" 秒"
              help={`从这一页开始算。这一页一共 ${p.时长} 秒。讲解区域只在切换前播放，切换后就不再出现。`}
              onChange={(v) => set(at('尾帧'), {...endFrameOf(p), 切换时间: v})}
            />
            <div className="toggles">
              <Toggle label="切换前先显示手指点击" value={endFrameOf(p).先点击} onChange={(v) => fx(i, at('尾帧'), {...endFrameOf(p), 先点击: v})} />
            </div>
            {endFrameOf(p).先点击 && hasMedia && (
              <Field label="手指点在哪里" help="在首帧截图上点一下，橙色圆点就是手指点击的位置。">
                <PointPicker image={p.截图} t={rec.开始} value={endFrameOf(p).点击位置} onChange={(v) => fx(i, at('尾帧'), {...endFrameOf(p), 点击位置: v})} />
              </Field>
            )}
          </>
        )}

        <Sub>这一页怎么出现</Sub>
        <Choice label="进场转场" value={p.转场} options={OPTIONS.转场} onChange={(v) => fx(i, at('转场'), v)} help="这一页盖住上一页的方式。" />
        <Choice label="背景配色" value={p.配色} options={OPTIONS.配色} onChange={(v) => fx(i, at('配色'), v)} />
        <Choice label="大字的动画" value={p.标题动画} options={OPTIONS.标题动画} onChange={(v) => fx(i, at('标题动画'), v)} />

        <Sub>手机怎么动</Sub>
        <Choice label="手机进场" value={p.手机进场} options={OPTIONS.手机进场} onChange={(v) => fx(i, at('手机进场'), v)} />
        <Choice label="进场后的动态" value={p.手机动态} options={OPTIONS.手机动态} onChange={(v) => fx(i, at('手机动态'), v)} />

        {hasMedia && p.高亮.length > 0 && (
          <>
            <Sub>讲解区域怎么展示</Sub>
            <Choice
              label="讲解效果"
              value={p.讲解效果}
              options={OPTIONS.讲解效果}
              onChange={(v) => fx(i, at('讲解效果'), v)}
              help="放大弹出：区域抠出来浮在手机上。镜头推近：整个屏幕朝那块区域放大。描边闪烁：不放大，原位置出现发光的框。"
            />
            <Slider
              label="每个区域停留多久"
              value={p.讲解停留}
              min={0.6}
              max={2.5}
              step={0.1}
              unit=" 秒"
              onChange={(v) => set(at('讲解停留'), v)}
              help="区域多、停留久时，记得把这一页的总时长也加长。"
            />
            <div className="toggles">
              <Toggle label="显示手指点击" value={p.显示手指} onChange={(v) => fx(i, at('显示手指'), v)} />
              <Toggle label="讲解时压暗其余部分" value={p.压暗背景} onChange={(v) => fx(i, at('压暗背景'), v)} />
            </div>
          </>
        )}
        {hasImage && (
          <>
            <Sub>画面里的车</Sub>
            <div className="toggles">
              <Toggle label="让画面里的车动起来" value={p.小车.开启} onChange={(v) => fx(i, at('小车'), {...p.小车, 开启: v})} />
            </div>
            {p.小车.开启 &&
              (() => {
                const mode = p.小车.模式 ?? '地图不动，车往前开';
                const mapMode = mode === '车不动，地图移动';
                return (
                  <>
                    <Choice
                      label="怎么动"
                      value={mode}
                      options={OPTIONS.车辆运动}
                      onChange={(v) => fx(i, at('小车'), {...p.小车, 模式: v})}
                      help={mapMode ? '像真实导航：车停在原位，车头前方的地图朝车移动，两边的卡片不动。' : '车沿路线往前开，身后的路线可以变灰。'}
                    />
                    <Slider
                      label={mapMode ? '地图移动多远' : '往前开多远'}
                      value={p.小车.距离}
                      min={5}
                      max={40}
                      step={1}
                      unit="%"
                      help="占屏幕高度的百分比。数字越大移动得越远，也就越快。"
                      onChange={(v) => set([...at('小车'), '距离'], v)}
                    />
                    <Choice label="节奏" value={p.小车.方式} options={OPTIONS.行驶方式} onChange={(v) => fx(i, at('小车'), {...p.小车, 方式: v})} />
                    <div className="toggles">
                      <Toggle
                        label={mapMode ? '车身后的路线保持灰色' : '开过的路线变灰'}
                        value={p.小车.变灰轨迹}
                        onChange={(v) => fx(i, at('小车'), {...p.小车, 变灰轨迹: v})}
                      />
                    </div>
                    <Field label="车在截图上的位置" help="橙色框要刚好框住车（包括车外面的圆圈）。换了截图后，在图上重新拖一个框。只适合直线路段。">
                      <BoxPicker image={p.截图} value={p.小车} onChange={(b) => fx(i, at('小车'), {...p.小车, ...b})} />
                    </Field>
                    {mapMode && (
                      <Field
                        label="不跟着地图动的卡片和按钮"
                        help="在截图上按住拖框，把浮在地图上的卡片、按钮、指南针、路名标签，还有最底下的信息栏，一个个框住（框稍微大一点，连阴影一起框住）。标了以后，从顶部导航条下面到屏幕底部的整片地图都会一起移动，这些框住的东西留在原地。不标的话，只有车头前方中间一条地图会动。"
                      >
                        <BoxesPicker
                          image={p.截图}
                          value={p.小车.固定元素 ?? []}
                          ghost={[mapAreaOf(p.小车)]}
                          onChange={(v) => fx(i, at('小车'), {...p.小车, 固定元素: v, 地图区域: undefined})}
                        />
                      </Field>
                    )}
                    {mapMode && (
                      <Field
                        label="会移动的地图范围"
                        help="蓝色框里的地图会朝车移动，框外不动。一般不用改：标了卡片后它自动变成从导航条下面到屏幕底部的整片地图。没标卡片时，框要避开两边的卡片。"
                      >
                        <BoxPicker
                          image={p.截图}
                          value={mapAreaOf(p.小车)}
                          color="#1787CE"
                          ghost={p.小车}
                          onChange={(b) => fx(i, at('小车'), {...p.小车, 地图区域: b})}
                        />
                        {p.小车.地图区域 && (
                          <button className="btn small" style={{marginTop: 8}} onClick={() => fx(i, at('小车'), {...p.小车, 地图区域: undefined})}>
                            按车的位置自动算
                          </button>
                        )}
                      </Field>
                    )}
                  </>
                );
              })()}
          </>
        )}

        <Sub>画面上的提示</Sub>
        <div className="toggles">
          <Toggle label="在手机画面上弹出两条提示（先红后绿）" value={p.提示.开启} onChange={(v) => fx(i, at('提示'), {...p.提示, 开启: v})} />
        </div>
        {p.提示.开启 && (
          <div className="row2">
            <Text label="先弹出的红色提示" value={p.提示.红色文字} onChange={(v) => set([...at('提示'), '红色文字'], v)} />
            <Text label="随后的绿色提示" value={p.提示.绿色文字} onChange={(v) => set([...at('提示'), '绿色文字'], v)} />
          </div>
        )}
      </>
    );
  };

  const cardBody = (i: number, p: CardPage) => {
    const at = (key: string): Path => ['页面', i, key];
    return (
      <>
        {pageTools(i)}
        <Sub>内容</Sub>
        <div className="row2">
          <Text label="大字第一行" value={p.第一行} onChange={(v) => set(at('第一行'), v)} />
          <Text label="大字第二行" value={p.第二行} onChange={(v) => set(at('第二行'), v)} />
        </div>
        <Field label="卡片" help="最多 6 张。右边的滑块是卡片颜色。">
          {p.卡片.map((c, j) => (
            <div className="item" key={j}>
              <div className="swatch" style={{background: `linear-gradient(135deg, hsl(${c.色相},70%,62%), hsl(${c.色相 + 40},75%,45%))`}} />
              <input type="text" value={c.文字} onChange={(e) => set([...at('卡片'), j, '文字'], e.target.value)} />
              <input type="range" min={0} max={360} step={5} value={c.色相} onChange={(e) => set([...at('卡片'), j, '色相'], Number(e.target.value))} />
              <button
                className="btn small danger"
                onClick={() =>
                  set(
                    at('卡片'),
                    p.卡片.filter((_, n) => n !== j),
                  )
                }
              >
                删除
              </button>
            </div>
          ))}
          {p.卡片.length < 6 && (
            <button className="btn small" onClick={() => set(at('卡片'), [...p.卡片, {文字: 'NEW', 图片: '', 色相: (p.卡片.length * 70) % 360}])}>
              + 加一张卡片
            </button>
          )}
        </Field>
        <Slider label="这一页停留多久" value={p.时长} min={2} max={6} step={0.5} unit=" 秒" onChange={(v) => set(at('时长'), v)} />
        <Sub>这一页怎么出现</Sub>
        <Choice label="进场转场" value={p.转场} options={OPTIONS.转场} onChange={(v) => fx(i, at('转场'), v)} />
        <Choice label="背景配色" value={p.配色} options={OPTIONS.配色} onChange={(v) => fx(i, at('配色'), v)} />
        <Choice label="大字的动画" value={p.标题动画} options={OPTIONS.标题动画} onChange={(v) => fx(i, at('标题动画'), v)} />
        <Choice label="卡片怎么出现" value={p.卡片动画} options={OPTIONS.卡片动画} onChange={(v) => fx(i, at('卡片动画'), v)} />
      </>
    );
  };

  const body = () => {
    if (active === 'style')
      return (
        <>
          <div className="row2">
            <Color label="主色" value={props.品牌.主色} onChange={(v) => set(['品牌', '主色'], v)} />
            <Color label="深色" value={props.品牌.深色} onChange={(v) => set(['品牌', '深色'], v)} />
          </div>
          <Color label="浅色背景" value={props.品牌.背景色} onChange={(v) => set(['品牌', '背景色'], v)} />
          <Slider label="大字的大小" value={props.样式.标题字号} min={60} max={120} step={2} onChange={(v) => set(['样式', '标题字号'], v)} />
          <Slider label="手机的大小" value={props.样式.手机宽度} min={480} max={720} step={10} onChange={(v) => set(['样式', '手机宽度'], v)} />
          <Slider
            label="动画的弹跳感"
            value={props.样式.弹跳感}
            min={0}
            max={10}
            step={1}
            help="0 是平稳滑入，10 是很有弹性。"
            onChange={(v) => set(['样式', '弹跳感'], v)}
          />
          <Slider
            label="音效音量"
            value={props.样式.音效音量}
            min={0}
            max={1}
            step={0.05}
            help="0 是静音。点播放才能听到声音。"
            onChange={(v) => set(['样式', '音效音量'], v)}
          />
        </>
      );
    if (active === 'intro')
      return (
        <>
          <Drop label="App 图标" value={props.品牌.图标} onChange={(v) => set(['品牌', '图标'], v)} emptyText="还没有图标" help="建议用透明底的 PNG。" />
          <Slider label="图标大小" value={props.开场.图标大小} min={160} max={460} step={10} onChange={(v) => set(['开场', '图标大小'], v)} />
          <Choice label="图标怎么出现" value={props.开场.图标动画} options={OPTIONS.图标动画} onChange={(v) => fx('intro', ['开场', '图标动画'], v)} />
          <Slider label="这一页停留多久" value={props.开场.时长} min={1} max={4} step={0.5} unit=" 秒" onChange={(v) => set(['开场', '时长'], v)} />
        </>
      );
    if (active === 'end')
      return (
        <>
          <Drop label="带文字的 Logo" value={props.品牌.字标} wide onChange={(v) => set(['品牌', '字标'], v)} emptyText="还没有 Logo" />
          <Slider label="Logo 宽度" value={props.结尾.字标宽度} min={360} max={800} step={10} onChange={(v) => set(['结尾', '字标宽度'], v)} />
          <Text label="Logo 下面的一句话" value={props.品牌.标语} onChange={(v) => set(['品牌', '标语'], v)} />
          <Slider label="这一页停留多久" value={props.结尾.时长} min={1.5} max={5} step={0.5} unit=" 秒" onChange={(v) => set(['结尾', '时长'], v)} />
          <Sub>这一页怎么出现</Sub>
          <Choice label="进场转场" value={props.结尾.转场} options={OPTIONS.转场} onChange={(v) => fx('end', ['结尾', '转场'], v)} />
          <Choice label="Logo 怎么出现" value={props.结尾.标志动画} options={OPTIONS.标志动画} onChange={(v) => fx('end', ['结尾', '标志动画'], v)} />
        </>
      );
    const pg = pages[active];
    if (!pg) return <div className="empty">这一页不存在了，请在上面重新选一页。</div>;
    return pg.类型 === '功能页' ? featureBody(active, pg) : cardBody(active, pg);
  };

  const title = active === 'style' ? '整体风格' : active === 'intro' ? '开场' : active === 'end' ? '结尾' : (pages[active]?.名称 ?? '');
  const desc =
    active === 'style'
      ? '这里的设置对所有页面生效。'
      : active === 'intro'
        ? '视频最开始，App 图标出现。'
        : active === 'end'
          ? 'Logo 和一句标语。'
          : pages[active]?.类型 === '卡片页'
            ? '大字加一组卡片，适合一次列出多个卖点。'
            : '大字加一台手机，手机里放 App 的截图或录屏。';

  return (
    <div className="app">
      <div className="top">
        <h1>预览视频控制台</h1>
        <span className="meta" style={tooLong || tooShort ? {color: 'var(--red)', fontWeight: 600} : undefined}>
          总长 {total.toFixed(1)} 秒{tooLong ? '（超过 App Store 的 30 秒上限）' : tooShort ? '（不到 App Store 要求的 15 秒）' : ''}
        </span>
        <span className="meta">{saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存失败' : '改动已自动保存'}</span>
        <div className="grow" />
        <button
          className="btn"
          onClick={() => {
            if (!window.confirm('把所有内容恢复成最初的样子？你上传的素材文件不会被删除。')) return;
            fetch('/api/reset', {method: 'POST'})
              .then((r) => {
                version.current = r.headers.get('X-Version') ?? '';
                return r.json();
              })
              .then((p) => {
                dirty.current = false;
                setProps(p);
                setActive('intro');
                setSaveState('saved');
              });
          }}
        >
          恢复默认
        </button>
        <button
          className="btn primary"
          disabled={job.state === 'running' || saveState === 'saving'}
          onClick={() =>
            fetch('/api/render', {method: 'POST'})
              .then((r) => r.json())
              .then(setJob)
          }
        >
          {job.state === 'running' ? '正在导出…' : '导出视频'}
        </button>
      </div>
      {job.state === 'running' && (
        <div className="banner run">
          正在导出视频，大约需要 1 分钟，期间可以继续看但先不要改内容。{Math.round(job.progress * 100)}%
          <div className="bar">
            <i style={{width: job.progress * 100 + '%'}} />
          </div>
        </div>
      )}
      {externalNote && (
        <div className="banner run" onClick={() => setExternalNote('')} style={{cursor: 'pointer'}}>
          {externalNote}（点一下关闭）
        </div>
      )}
      {job.state === 'done' && <div className="banner ok">导出完成，视频在：{job.file}</div>}
      {job.state === 'error' && <div className="banner err">导出失败：{job.error}</div>}

      <div className="pages">
        <button className={'chip' + (active === 'intro' ? ' on' : '')} onClick={() => jump('intro')}>
          <b>开场</b>
          <span>{props.开场.时长} 秒</span>
        </button>
        {pages.map((pg, i) => (
          <button key={i} className={'chip' + (active === i ? ' on' : '')} onClick={() => jump(i)}>
            <b>
              {i + 1}. {pg.名称 || '未命名'}
            </b>
            <span>
              {pg.时长} 秒 · {pg.类型}
            </span>
          </button>
        ))}
        <button className={'chip' + (active === 'end' ? ' on' : '')} onClick={() => jump('end')}>
          <b>结尾</b>
          <span>{props.结尾.时长} 秒</span>
        </button>
        {adding ? (
          <div className="chip addbox">
            <button className="btn small" onClick={() => addPage(newFeaturePage())}>
              功能页（手机画面）
            </button>
            <button className="btn small" onClick={() => addPage(newCardPage())}>
              卡片页
            </button>
            <button className="btn small" onClick={() => setAdding(false)}>
              取消
            </button>
          </div>
        ) : (
          <button className="chip add" onClick={() => setAdding(true)}>
            <b>+ 加一页</b>
            <span>加在结尾之前</span>
          </button>
        )}
        <button className={'chip style' + (active === 'style' ? ' on' : '')} onClick={() => jump('style')}>
          <b>整体风格</b>
          <span>颜色 · 字号 · 音量</span>
        </button>
      </div>

      <div className="main">
        <div className="stage">
          <div className="frame">
            <Player
              ref={player}
              component={AppPreview}
              inputProps={props}
              durationInFrames={Math.max(1, totalFrames(props))}
              fps={FPS}
              compositionWidth={886}
              compositionHeight={1920}
              style={{width: '100%'}}
              controls
              loop
              sounds={allSoundCues(props).map((c) => ({frame: c.frame, src: `/sfx/${c.name}.wav`, volume: c.volume}))}
            />
          </div>
          {active !== 'style' && (
            <button className="btn" onClick={() => replay(active)}>
              ▶ 重播这一页
            </button>
          )}
          <div className="hint">点上面的页签会跳到那一页。改动画选项后会自动重播这一页。</div>
        </div>
        <div className="panel">
          <div className="card">
            <h2>{title}</h2>
            <p className="desc">{desc}</p>
            {body()}
          </div>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
