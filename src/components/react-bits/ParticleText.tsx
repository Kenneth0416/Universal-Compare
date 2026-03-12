import { useAnimationFrame } from 'motion/react';
import { ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';

interface ParticleTextProps {
  children: ReactNode;
  className?: string;
  colors?: string[];
  density?: number;
  flyDuration?: number;
}

type Particle = {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  delay: number;
  size: number;
  color: string;
  floatOffset: number;
  floatSpeed: number;
  floatAmp: number;
};

const DEFAULT_COLORS = ['#667eea', '#764ba2', '#f093fb'];

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized;
  const value = Number.parseInt(expanded, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const lerpColor = (a: string, b: string, t: number) => {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(lerp(ca.r, cb.r, t));
  const g = Math.round(lerp(ca.g, cb.g, t));
  const bValue = Math.round(lerp(ca.b, cb.b, t));
  return `rgb(${r}, ${g}, ${bValue})`;
};

const gradientColorAt = (colors: string[], t: number) => {
  if (colors.length === 1) return colors[0];
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (colors.length - 1);
  const index = Math.floor(scaled);
  const localT = scaled - index;
  const from = colors[index];
  const to = colors[Math.min(index + 1, colors.length - 1)];
  return lerpColor(from, to, localT);
};

export default function ParticleText({
  children,
  className = '',
  colors = DEFAULT_COLORS,
  density = 4,
  flyDuration = 1400
}: ParticleTextProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const startTimeRef = useRef<number | null>(null);

  const palette = useMemo(() => {
    if (!colors || colors.length === 0) return DEFAULT_COLORS;
    if (colors.length >= 3) return colors;
    return [...colors, ...DEFAULT_COLORS].slice(0, 3);
  }, [colors]);

  const text = useMemo(() => {
    if (typeof children === 'string') return children;
    if (typeof children === 'number') return `${children}`;
    return `${children ?? ''}`;
  }, [children]);

  const buildParticles = useCallback(() => {
    const canvas = canvasRef.current;
    const textEl = textRef.current;
    if (!canvas || !textEl) return;

    const rect = textEl.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === 0 || height === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    sizeRef.current = { width, height, dpr };

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const style = window.getComputedStyle(textEl);
    const fontSize = Number.parseFloat(style.fontSize) || 48;
    const fontWeight = style.fontWeight || '700';
    const fontFamily = style.fontFamily || 'sans-serif';

    const offscreen = document.createElement('canvas');
    offscreen.width = Math.round(width * dpr);
    offscreen.height = Math.round(height * dpr);
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    offCtx.scale(dpr, dpr);
    offCtx.clearRect(0, 0, width, height);
    offCtx.fillStyle = '#ffffff';
    offCtx.textAlign = 'center';
    offCtx.textBaseline = 'middle';
    offCtx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    offCtx.fillText(text, width / 2, height / 2);

    const imageData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height).data;
    const particles: Particle[] = [];
    const step = Math.max(3, density) * dpr;
    const spread = Math.max(width, height) * 1.4;

    for (let y = 0; y < offscreen.height; y += step) {
      for (let x = 0; x < offscreen.width; x += step) {
        const index = (y * offscreen.width + x) * 4 + 3;
        if (imageData[index] > 40) {
          const targetX = x / dpr;
          const targetY = y / dpr;
          const startX = width / 2 + (Math.random() - 0.5) * spread * 2;
          const startY = height / 2 + (Math.random() - 0.5) * spread * 2;
          const useGradient = Math.random() > 0.5;
          const color = useGradient
            ? gradientColorAt(palette, targetX / Math.max(width, 1))
            : palette[Math.floor(Math.random() * palette.length)];

          particles.push({
            startX,
            startY,
            targetX,
            targetY,
            delay: Math.random() * 260,
            size: 0.9 + Math.random() * 1.4,
            color,
            floatOffset: Math.random() * Math.PI * 2,
            floatSpeed: 0.6 + Math.random() * 0.9,
            floatAmp: 0.6 + Math.random() * 1.8
          });
        }
      }
    }

    particlesRef.current = particles;
    startTimeRef.current = null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
  }, [density, palette, text]);

  useEffect(() => {
    const textEl = textRef.current;
    if (!textEl) return;

    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(buildParticles);
    });

    observer.observe(textEl);
    buildParticles();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [buildParticles]);

  useAnimationFrame((time) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const particles = particlesRef.current;
    if (!particles.length) return;

    if (startTimeRef.current === null) {
      startTimeRef.current = time;
    }

    const elapsed = time - (startTimeRef.current ?? time);
    const { width, height, dpr } = sizeRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    for (const particle of particles) {
      const localTime = Math.max(0, elapsed - particle.delay);
      const t = Math.min(1, localTime / flyDuration);
      const eased = easeOutCubic(t);

      let x = particle.startX + (particle.targetX - particle.startX) * eased;
      let y = particle.startY + (particle.targetY - particle.startY) * eased;

      if (t >= 1) {
        const floatPhase = elapsed * 0.001 * particle.floatSpeed + particle.floatOffset;
        x = particle.targetX + Math.sin(floatPhase) * particle.floatAmp;
        y = particle.targetY + Math.cos(floatPhase * 0.9) * particle.floatAmp;
      }

      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(x, y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  return (
    <span className={`relative inline-block align-middle ${className}`.trim()}>
      <span
        ref={textRef}
        className="block text-transparent select-none pointer-events-none"
        aria-hidden="true"
      >
        {text}
      </span>
      <canvas ref={canvasRef} className="absolute inset-0 block" aria-hidden="true" />
      <span className="sr-only">{text}</span>
    </span>
  );
}
