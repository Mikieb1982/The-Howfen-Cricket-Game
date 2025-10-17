/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import type { AssetsLoaded } from '../types';

type ProcessedCanvases = {
  batCanvas?: HTMLCanvasElement;
  batsmanCanvas?: HTMLCanvasElement;
  dhBatsmanCanvas?: HTMLCanvasElement;
  ballCanvas?: HTMLCanvasElement;
  grassCanvas?: HTMLCanvasElement;
};

type PaperCutOptions = {
  levels?: number;          // posterize levels per channel
  shadowOffset?: { x: number; y: number };
  shadowBlur?: number;
  shadowAlpha?: number;
  edgeJitter?: number;      // px of mask jitter for deckle edge
  grainAlpha?: number;      // 0..1 paper grain strength
  grainScale?: number;      // grain cell size in px
  desaturate?: number;      // 0..1
  contrast?: number;        // e.g. 1.1
};

function posterize(data: Uint8ClampedArray, levels: number, desaturate = 0, contrast = 1) {
  const step = 255 / Math.max(levels - 1, 1);
  for (let i = 0; i < data.length; i += 4) {
    // simple desaturation
    if (desaturate > 0) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      data[i]     = r + (gray - r) * desaturate;
      data[i + 1] = g + (gray - g) * desaturate;
      data[i + 2] = b + (gray - b) * desaturate;
    }
    // contrast
    if (contrast !== 1) {
      for (let c = 0; c < 3; c++) {
        const v = data[i + c] / 255;
        const vc = ((v - 0.5) * contrast + 0.5) * 255;
        data[i + c] = Math.max(0, Math.min(255, vc));
      }
    }
    // posterize
    for (let c = 0; c < 3; c++) {
      const v = data[i + c];
      data[i + c] = Math.round(v / step) * step;
    }
  }
}

function addPaperGrain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha = 0.12, scale = 2) {
  const g = ctx.createImageData(w, h);
  for (let i = 0; i < g.data.length; i += 4) {
    // coarse grain by sampling every scale px
    const n = Math.random() * 255;
    g.data[i] = g.data[i + 1] = g.data[i + 2] = n;
    g.data[i + 3] = alpha * 255;
  }
  // downscale trick for chunkier grain
  if (scale > 1) {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.floor(w / scale));
    off.height = Math.max(1, Math.floor(h / scale));
    const octx = off.getContext('2d')!;
    octx.putImageData(g, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.globalCompositeOperation = 'multiply';
    ctx.putImageData(g, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function jitteredMask(
  src: HTMLImageElement,
  edgeJitter = 1.25
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.naturalWidth;
  c.height = src.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;

  // inflate alpha and add slight randomness to create a deckle edge
  const out = ctx.createImageData(img);
  const w = c.width;
  const h = c.height;

  // helper to sample alpha with bounds check
  const alphaAt = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return d[(y * w + x) * 4 + 3];
    };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // sample a small neighborhood to fatten the silhouette
      let maxA = 0;
      const rad = Math.max(1, Math.round(edgeJitter));
      for (let oy = -rad; oy <= rad; oy++) {
        for (let ox = -rad; ox <= rad; ox++) {
          const jitterX = x + ox + Math.round((Math.random() - 0.5) * edgeJitter);
          const jitterY = y + oy + Math.round((Math.random() - 0.5) * edgeJitter);
          maxA = Math.max(maxA, alphaAt(jitterX, jitterY));
        }
      }
      const i = (y * w + x) * 4;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = 0;
      out.data[i + 3] = maxA;
    }
  }

  // draw inflated silhouette as a mask
  ctx.clearRect(0, 0, w, h);
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  mask.getContext('2d')!.putImageData(out, 0, 0);

  // use destination-in to clip the original image to the irregular mask
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

function toPaperCutCanvas(
  src: HTMLImageElement,
  opts: PaperCutOptions = {}
): HTMLCanvasElement {
  const {
    levels = 5,
    shadowOffset = { x: 3, y: 4 },
    shadowBlur = 6,
    shadowAlpha = 0.35,
    edgeJitter = 1.25,
    grainAlpha = 0.12,
    grainScale = 2,
    desaturate = 0.15,
    contrast = 1.08,
  } = opts;

  // first make a deckled mask and posterize the color inside it
  const masked = jitteredMask(src, edgeJitter);
  const w = masked.width;
  const h = masked.height;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  // shadow (beneath)
  ctx.save();
  ctx.globalAlpha = shadowAlpha;
  ctx.filter = `blur(${shadowBlur}px)`;
  ctx.drawImage(masked, shadowOffset.x, shadowOffset.y);
  ctx.restore();

  // base color layer
  ctx.drawImage(masked, 0, 0);

  // posterize colors for a cut-paper banding
  const img = ctx.getImageData(0, 0, w, h);
  posterize(img.data, levels, desaturate, contrast);
  ctx.putImageData(img, 0, 0);

  // paper grain overlay
  addPaperGrain(ctx, w, h, grainAlpha, grainScale);

  // subtle inner stroke to separate layers
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.filter = 'blur(0.5px)';
  ctx.drawImage(masked, 0, 0);
  ctx.restore();

  return c;
}

/**
 * Custom hook to manage loading assets and producing paper-cut versions.
 */
export function useGameAssets() {
  const batImageRef = useRef(new Image());
  const batsmanImageRef = useRef(new Image());
  const dhBatsmanImageRef = useRef(new Image());
  const ballImageRef = useRef(new Image());
  const grassImageRef = useRef(new Image());

  const [assetsLoaded, setAssetsLoaded] = useState<AssetsLoaded>({
    bat: false, batsman: false, dhBatsman: false, ball: false, grass: false, all: false
  });

  const [processed, setProcessed] = useState<ProcessedCanvases>({});

  const batHitSoundRef = useRef<HTMLAudioElement | null>(null);
  const wicketSoundRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // sounds
    batHitSoundRef.current = new Audio('https://storage.googleapis.com/gemini-95-icons/bathit.mp3');
    batHitSoundRef.current.preload = 'auto';
    wicketSoundRef.current = new Audio('https://storage.googleapis.com/gemini-95-icons/wicket.m4a');
    wicketSoundRef.current.preload = 'auto';

    let loadedCount = 0;
    const totalToLoad = 5;

    const markLoaded = (type: 'bat' | 'batsman' | 'dhBatsman' | 'ball' | 'grass', success: boolean) => {
      setAssetsLoaded(prev => {
        const next = { ...prev, [type]: success };
        loadedCount++;
        if (loadedCount === totalToLoad) {
          next.all = next.bat && next.batsman && next.dhBatsman && next.ball && next.grass;
          // once all are in, build processed canvases
          try {
            const opts: PaperCutOptions = {
              levels: 5,
              shadowOffset: { x: 3, y: 4 },
              shadowBlur: 6,
              shadowAlpha: 0.35,
              edgeJitter: 1.25,
              grainAlpha: 0.10,
              grainScale: 2,
              desaturate: 0.12,
              contrast: 1.08,
            };
            setProcessed({
              batCanvas: toPaperCutCanvas(batImageRef.current, { ...opts, levels: 4 }),
              batsmanCanvas: toPaperCutCanvas(batsmanImageRef.current, opts),
              dhBatsmanCanvas: toPaperCutCanvas(dhBatsmanImageRef.current, opts),
              ballCanvas: toPaperCutCanvas(ballImageRef.current, { ...opts, levels: 3, shadowBlur: 4 }),
              grassCanvas: toPaperCutCanvas(grassImageRef.current, { ...opts, levels: 3, desaturate: 0.2 }),
            });
          } catch {
            // fail silently, keep originals
          }
        }
        return next;
      });
    };

    // hooks for onload/onerror
    batImageRef.current.onload = () => markLoaded('bat', true);
    batsmanImageRef.current.onload = () => markLoaded('batsman', true);
    dhBatsmanImageRef.current.onload = () => markLoaded('dhBatsman', true);
    ballImageRef.current.onload = () => markLoaded('ball', true);
    grassImageRef.current.onload = () => markLoaded('grass', true);

    batImageRef.current.onerror = () => markLoaded('bat', false);
    batsmanImageRef.current.onerror = () => markLoaded('batsman', false);
    dhBatsmanImageRef.current.onerror = () => markLoaded('dhBatsman', false);
    ballImageRef.current.onerror = () => markLoaded('ball', false);
    grassImageRef.current.onerror = () => markLoaded('grass', false);

    // sources
    batImageRef.current.src = 'https://storage.googleapis.com/gemini-95-icons/cricketbat-flipped-s.png';
    batsmanImageRef.current.src = 'https://storage.googleapis.com/gemini-95-icons/spbatsman.png';
    dhBatsmanImageRef.current.src = 'https://storage.googleapis.com/gemini-95-icons/demisbatsman.png';
    ballImageRef.current.src = 'https://storage.googleapis.com/gemini-95-icons/cricketball.png';
    grassImageRef.current.src = 'https://storage.googleapis.com/gemini-95-icons/grass.jpg';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    assetsLoaded,
    // originals
    batImageRef,
    batsmanImageRef,
    dhBatsmanImageRef,
    ballImageRef,
    grassImageRef,
    // paper cutout versions
    processed,
    // sounds
    batHitSoundRef,
    wicketSoundRef
  };
}
