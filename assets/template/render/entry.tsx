// HyperFrames 合成页的入口：收到「跳到第 t 秒」就按帧号重画，等图片就绪后再让它截图
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {FrameProvider, settle} from '../src/engine';
import {AppPreview, FPS, type Props} from '../src/AppPreview';

const settings = (globalThis as {__PROPS?: Props}).__PROPS!;
const el = document.getElementById('app')!;
const root = createRoot(el);
const renderAt = (t: number) =>
  flushSync(() =>
    root.render(
      <FrameProvider frame={Math.round(t * FPS)}>
        <AppPreview {...settings} />
      </FrameProvider>,
    ),
  );
window.addEventListener('hf-seek', (e: Event) => {
  const d = (e as CustomEvent<{time: number; waitUntil: (p: Promise<unknown>) => void}>).detail;
  renderAt(d.time);
  d.waitUntil(settle(el));
});
renderAt(0);
