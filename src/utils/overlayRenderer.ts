import { TextOverlay, ImageOverlay, Transition, Clip, TextAnimation } from './types';

const imageCache = new Map<string, HTMLImageElement>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached?.complete) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = src;
  });
}

export function preloadOverlayImages(overlays: ImageOverlay[]): void {
  for (const o of overlays) {
    if (!imageCache.has(o.src)) loadImage(o.src).catch(() => {});
  }
}

export function renderTextOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: TextOverlay,
  canvasW: number,
  canvasH: number,
  currentTime: number,
): void {
  if (currentTime < overlay.startTime || currentTime > overlay.endTime) return;

  const { style, animation } = overlay;

  ctx.save();

  const elapsed = currentTime - overlay.startTime;
  const remaining = overlay.endTime - currentTime;
  const totalDuration = overlay.endTime - overlay.startTime;

  let opacity = 1;
  let offsetX = 0;
  let offsetY = 0;
  let scale = 1;
  let visibleChars = Infinity;

  if (animation) {
    ({ opacity, offsetX, offsetY, scale, visibleChars } = computeAnimation(
      animation, elapsed, remaining, totalDuration, canvasW, canvasH,
    ));
  }

  if (opacity <= 0) { ctx.restore(); return; }

  ctx.globalAlpha = opacity;

  const x = overlay.x * canvasW + offsetX;
  const y = overlay.y * canvasH + offsetY;

  ctx.translate(x, y);
  if (overlay.rotation !== 0) ctx.rotate((overlay.rotation * Math.PI) / 180);
  if (scale !== 1) ctx.scale(scale, scale);

  const fontSize = style.fontSize * (canvasH / 1080);
  const fontStyle = `${style.bold ? 'bold' : ''} ${style.italic ? 'italic' : ''}`.trim();
  ctx.font = `${fontStyle} ${fontSize}px ${style.fontFamily}`;
  ctx.textAlign = style.align;
  ctx.textBaseline = 'middle';

  const text = visibleChars < Infinity
    ? overlay.text.slice(0, Math.floor(visibleChars))
    : overlay.text;

  const lines = text.split('\n');
  const lineHeightPx = fontSize * style.lineHeight;
  const totalTextH = lines.length * lineHeightPx;

  if (style.backgroundColor && style.backgroundColor !== 'transparent' && style.backgroundOpacity > 0) {
    ctx.fillStyle = style.backgroundColor;
    ctx.globalAlpha = opacity * style.backgroundOpacity;
    const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const pad = fontSize * 0.3;
    ctx.fillRect(-maxW / 2 - pad, -totalTextH / 2 - pad, maxW + pad * 2, totalTextH + pad * 2);
    ctx.globalAlpha = opacity;
  }

  for (let i = 0; i < lines.length; i++) {
    const ly = -totalTextH / 2 + lineHeightPx * (i + 0.5);

    if (style.shadowBlur > 0) {
      ctx.shadowColor = style.shadowColor;
      ctx.shadowBlur = style.shadowBlur;
      ctx.shadowOffsetX = style.shadowOffsetX;
      ctx.shadowOffsetY = style.shadowOffsetY;
    }

    if (style.strokeWidth > 0) {
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = style.strokeWidth * (canvasH / 1080);
      ctx.lineJoin = 'round';
      ctx.strokeText(lines[i], 0, ly);
    }

    ctx.fillStyle = style.color;
    ctx.fillText(lines[i], 0, ly);

    ctx.shadowBlur = 0;
  }

  if (style.underline) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(1, fontSize / 20);
    for (let i = 0; i < lines.length; i++) {
      const ly = -totalTextH / 2 + lineHeightPx * (i + 0.5) + fontSize * 0.15;
      const w = ctx.measureText(lines[i]).width;
      const sx = style.align === 'center' ? -w / 2 : style.align === 'right' ? -w : 0;
      ctx.beginPath();
      ctx.moveTo(sx, ly);
      ctx.lineTo(sx + w, ly);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function computeAnimation(
  anim: TextAnimation,
  elapsed: number,
  remaining: number,
  _total: number,
  canvasW: number,
  canvasH: number,
): { opacity: number; offsetX: number; offsetY: number; scale: number; visibleChars: number } {
  let opacity = 1, offsetX = 0, offsetY = 0, scale = 1, visibleChars = Infinity;

  switch (anim.type) {
    case 'fadeIn':
      if (elapsed < anim.duration) opacity = elapsed / anim.duration;
      break;
    case 'fadeOut':
      if (remaining < anim.duration) opacity = remaining / anim.duration;
      break;
    case 'fadeInOut':
      if (elapsed < anim.fadeInDuration) opacity = elapsed / anim.fadeInDuration;
      else if (remaining < anim.fadeOutDuration) opacity = remaining / anim.fadeOutDuration;
      break;
    case 'slideIn': {
      const t = Math.min(1, elapsed / anim.duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const dist = anim.direction === 'left' || anim.direction === 'right' ? canvasW * 0.5 : canvasH * 0.5;
      const dir = anim.direction === 'left' || anim.direction === 'up' ? -1 : 1;
      if (anim.direction === 'left' || anim.direction === 'right') {
        offsetX = dist * dir * (1 - ease);
      } else {
        offsetY = dist * dir * (1 - ease);
      }
      opacity = ease;
      break;
    }
    case 'slideOut': {
      const t = Math.min(1, 1 - remaining / anim.duration);
      if (t > 0) {
        const ease = Math.pow(t, 3);
        const dist = anim.direction === 'left' || anim.direction === 'right' ? canvasW * 0.5 : canvasH * 0.5;
        const dir = anim.direction === 'left' || anim.direction === 'up' ? -1 : 1;
        if (anim.direction === 'left' || anim.direction === 'right') {
          offsetX = dist * dir * ease;
        } else {
          offsetY = dist * dir * ease;
        }
        opacity = 1 - ease;
      }
      break;
    }
    case 'typewriter':
      visibleChars = elapsed * anim.speed;
      break;
    case 'scale':
      if (elapsed < anim.duration) {
        const t = elapsed / anim.duration;
        scale = anim.from + (anim.to - anim.from) * t;
        opacity = t;
      } else {
        scale = anim.to;
      }
      break;
  }

  return { opacity: Math.max(0, Math.min(1, opacity)), offsetX, offsetY, scale, visibleChars };
}

export function renderImageOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: ImageOverlay,
  canvasW: number,
  canvasH: number,
  currentTime: number,
): void {
  if (currentTime < overlay.startTime || currentTime > overlay.endTime) return;

  const img = imageCache.get(overlay.src);
  if (!img?.complete) return;

  ctx.save();

  const w = overlay.width * canvasW;
  const h = overlay.height * canvasH;
  const x = overlay.x * canvasW;
  const y = overlay.y * canvasH;

  ctx.globalAlpha = overlay.opacity;
  ctx.translate(x, y);
  if (overlay.rotation !== 0) ctx.rotate((overlay.rotation * Math.PI) / 180);

  ctx.drawImage(img, -w / 2, -h / 2, w, h);

  ctx.restore();
}

export function renderTransition(
  ctx: CanvasRenderingContext2D,
  transition: Transition,
  fromClip: Clip | undefined,
  toClip: Clip | undefined,
  fromFrame: CanvasImageSource | null,
  toFrame: CanvasImageSource | null,
  canvasW: number,
  canvasH: number,
  currentTime: number,
): boolean {
  if (!fromClip || !toClip || !fromFrame || !toFrame) return false;

  const fromEnd = fromClip.offset + (fromClip.end - fromClip.start) / fromClip.speed;
  const toStart = toClip.offset;
  const overlapStart = Math.max(fromEnd - transition.duration, toStart);
  const overlapEnd = fromEnd;

  if (currentTime < overlapStart || currentTime > overlapEnd) return false;

  const progress = (currentTime - overlapStart) / (overlapEnd - overlapStart);

  ctx.save();

  switch (transition.type) {
    case 'fade':
    case 'crossDissolve':
      ctx.globalAlpha = 1 - progress;
      ctx.drawImage(fromFrame, 0, 0, canvasW, canvasH);
      ctx.globalAlpha = progress;
      ctx.drawImage(toFrame, 0, 0, canvasW, canvasH);
      break;

    case 'slideLeft':
      ctx.drawImage(fromFrame, -canvasW * progress, 0, canvasW, canvasH);
      ctx.drawImage(toFrame, canvasW * (1 - progress), 0, canvasW, canvasH);
      break;

    case 'slideRight':
      ctx.drawImage(fromFrame, canvasW * progress, 0, canvasW, canvasH);
      ctx.drawImage(toFrame, -canvasW * (1 - progress), 0, canvasW, canvasH);
      break;

    case 'slideUp':
      ctx.drawImage(fromFrame, 0, -canvasH * progress, canvasW, canvasH);
      ctx.drawImage(toFrame, 0, canvasH * (1 - progress), canvasW, canvasH);
      break;

    case 'slideDown':
      ctx.drawImage(fromFrame, 0, canvasH * progress, canvasW, canvasH);
      ctx.drawImage(toFrame, 0, -canvasH * (1 - progress), canvasW, canvasH);
      break;

    case 'zoom': {
      const zoomScale = 1 + progress * 0.5;
      ctx.globalAlpha = 1 - progress;
      ctx.translate(canvasW / 2, canvasH / 2);
      ctx.scale(zoomScale, zoomScale);
      ctx.translate(-canvasW / 2, -canvasH / 2);
      ctx.drawImage(fromFrame, 0, 0, canvasW, canvasH);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = progress;
      ctx.drawImage(toFrame, 0, 0, canvasW, canvasH);
      break;
    }

    case 'blur':
      ctx.globalAlpha = 1 - progress;
      ctx.filter = `blur(${progress * 20}px)`;
      ctx.drawImage(fromFrame, 0, 0, canvasW, canvasH);
      ctx.filter = `blur(${(1 - progress) * 20}px)`;
      ctx.globalAlpha = progress;
      ctx.drawImage(toFrame, 0, 0, canvasW, canvasH);
      ctx.filter = 'none';
      break;

    case 'wipe': {
      ctx.drawImage(toFrame, 0, 0, canvasW, canvasH);
      ctx.beginPath();
      ctx.rect(0, 0, canvasW * (1 - progress), canvasH);
      ctx.clip();
      ctx.drawImage(fromFrame, 0, 0, canvasW, canvasH);
      break;
    }
  }

  ctx.restore();
  return true;
}

export function renderBlankClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  canvasW: number,
  canvasH: number,
): void {
  const bg = clip.blankBackground || '#000000';
  if (bg.includes('gradient') || bg.includes(',')) {
    const colors = bg.split(',').map((c) => c.trim());
    const grad = ctx.createLinearGradient(0, 0, canvasW, canvasH);
    colors.forEach((c, i) => grad.addColorStop(i / Math.max(1, colors.length - 1), c));
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = bg;
  }
  ctx.fillRect(0, 0, canvasW, canvasH);
}

export function renderOverlayBoundingBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  canvasW: number,
  canvasH: number,
): void {
  const cx = x * canvasW;
  const cy = y * canvasH;
  const w = width * canvasW;
  const h = height * canvasH;

  ctx.save();
  ctx.translate(cx, cy);
  if (rotation) ctx.rotate((rotation * Math.PI) / 180);

  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.setLineDash([]);

  const handleSize = 8;
  ctx.fillStyle = '#3b82f6';
  const corners = [
    [-w / 2, -h / 2], [w / 2, -h / 2],
    [-w / 2, h / 2], [w / 2, h / 2],
  ];
  for (const [hx, hy] of corners) {
    ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
  }

  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(0, -h / 2 - 20);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -h / 2 - 20, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function renderSnapGuides(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  x: number,
  y: number,
): void {
  ctx.save();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.globalAlpha = 0.6;

  const threshold = 0.02;

  if (Math.abs(x - 0.5) < threshold) {
    ctx.beginPath();
    ctx.moveTo(canvasW / 2, 0);
    ctx.lineTo(canvasW / 2, canvasH);
    ctx.stroke();
  }

  if (Math.abs(y - 0.5) < threshold) {
    ctx.beginPath();
    ctx.moveTo(0, canvasH / 2);
    ctx.lineTo(canvasW, canvasH / 2);
    ctx.stroke();
  }

  ctx.restore();
}
