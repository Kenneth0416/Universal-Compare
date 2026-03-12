import { useAnimationFrame } from 'motion/react';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ParticleEntranceProps {
  children: ReactNode;
  particleCount?: number;
  duration?: number;
}

type Particle = {
  startX: number;
  startY: number;
  size: number;
  color: string;
  curve: number;
  perpX: number;
  perpY: number;
};

const PARTICLE_COLORS = ['#667eea', '#764ba2', '#f093fb'];

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const pickStartPosition = (width: number, height: number, margin: number) => {
  const cornerChance = 0.2;
  if (Math.random() < cornerChance) {
    const corner = Math.floor(Math.random() * 4);
    switch (corner) {
      case 0:
        return { x: -margin, y: -margin };
      case 1:
        return { x: width + margin, y: -margin };
      case 2:
        return { x: width + margin, y: height + margin };
      default:
        return { x: -margin, y: height + margin };
    }
  }

  const edge = Math.floor(Math.random() * 4);
  switch (edge) {
    case 0:
      return { x: Math.random() * width, y: -margin };
    case 1:
      return { x: width + margin, y: Math.random() * height };
    case 2:
      return { x: Math.random() * width, y: height + margin };
    default:
      return { x: -margin, y: Math.random() * height };
  }
};

const createParticles = (
  count: number,
  width: number,
  height: number,
  targetX: number,
  targetY: number
) => {
  const margin = Math.max(60, Math.min(width, height) * 0.08);
  const particles: Particle[] = [];

  for (let i = 0; i < count; i += 1) {
    const { x: startX, y: startY } = pickStartPosition(width, height, margin);
    const dx = targetX - startX;
    const dy = targetY - startY;
    const length = Math.hypot(dx, dy) || 1;
    const perpX = -dy / length;
    const perpY = dx / length;
    const curve = (Math.random() - 0.5) * 160;

    particles.push({
      startX,
      startY,
      size: 2 + Math.random() * 2,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      curve,
      perpX,
      perpY
    });
  }

  return particles;
};

export default function ParticleEntrance({
  children,
  particleCount = 250,
  duration = 2000
}: ParticleEntranceProps) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const viewportRef = useRef({ width: 0, height: 0, dpr: 1 });
  const centerRef = useRef({ x: 0, y: 0 });
  const startTimeRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const [showCanvas, setShowCanvas] = useState(true);
  const [textOpacity, setTextOpacity] = useState(0);

  const normalizedCount = useMemo(() => clamp(Math.round(particleCount), 120, 600), [particleCount]);
  const totalDuration = Math.max(800, duration);
  const flyDuration = totalDuration * 0.75;
  const textFadeStart = totalDuration * 0.6;
  const fadeStart = flyDuration;

  const initialize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const rect = wrapper.getBoundingClientRect();
    centerRef.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };

    viewportRef.current = { width, height, dpr };
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    particlesRef.current = createParticles(
      normalizedCount,
      width,
      height,
      centerRef.current.x,
      centerRef.current.y
    );
    startTimeRef.current = null;
    finishedRef.current = false;
    setShowCanvas(true);
    setTextOpacity(0);
  }, [normalizedCount]);

  useEffect(() => {
    initialize();

    const handleResize = () => initialize();
    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(() => initialize());
    if (wrapperRef.current) {
      observer.observe(wrapperRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [initialize]);

  useAnimationFrame((time) => {
    if (finishedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (startTimeRef.current === null) {
      startTimeRef.current = time;
    }

    const elapsed = time - (startTimeRef.current ?? time);
    const { width, height, dpr } = viewportRef.current;
    const { x: targetX, y: targetY } = centerRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    const flyProgress = clamp(elapsed / flyDuration, 0, 1);
    const easedFly = easeInOutCubic(flyProgress);
    const fadeProgress = clamp((elapsed - fadeStart) / (totalDuration - fadeStart), 0, 1);
    const particleAlpha = 1 - easeInOutCubic(fadeProgress);

    const textProgress = clamp((elapsed - textFadeStart) / (totalDuration - textFadeStart), 0, 1);
    const nextOpacity = easeInOutCubic(textProgress);
    if (Math.abs(nextOpacity - textOpacity) > 0.01) {
      setTextOpacity(nextOpacity);
    }

    for (const particle of particlesRef.current) {
      const baseX = particle.startX + (targetX - particle.startX) * easedFly;
      const baseY = particle.startY + (targetY - particle.startY) * easedFly;
      const curveStrength = particle.curve * Math.pow(1 - easedFly, 1.6);
      const x = baseX + particle.perpX * curveStrength;
      const y = baseY + particle.perpY * curveStrength;

      ctx.globalAlpha = particleAlpha;
      ctx.fillStyle = particle.color;
      ctx.shadowBlur = 12;
      ctx.shadowColor = particle.color;
      ctx.beginPath();
      ctx.arc(x, y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }

    if (elapsed >= totalDuration) {
      finishedRef.current = true;
      setShowCanvas(false);
      setTextOpacity(1);
      ctx.clearRect(0, 0, width, height);
      particlesRef.current = [];
    }
  });

  return (
    <span ref={wrapperRef} className="relative inline-block align-middle" style={{ opacity: textOpacity }}>
      {showCanvas && (
        <canvas
          ref={canvasRef}
          className="fixed inset-0 z-20 pointer-events-none"
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
