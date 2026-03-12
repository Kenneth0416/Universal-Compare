import { useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { motion, useAnimationFrame, useMotionValue, useTransform } from 'motion/react';

interface NeonTextProps {
  children: ReactNode;
  className?: string;
  colors?: string[];
  animationSpeed?: number;
  direction?: 'horizontal' | 'vertical' | 'diagonal';
  pauseOnHover?: boolean;
  yoyo?: boolean;
  pulseSpeed?: number;
}

const DEFAULT_COLORS = ['#667eea', '#764ba2', '#f093fb'];

const hexToRgba = (hex: string, alpha: number) => {
  const normalized = hex.replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : normalized;
  const value = Number.parseInt(expanded, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
};

export default function NeonText({
  children,
  className = '',
  colors = DEFAULT_COLORS,
  animationSpeed = 8,
  direction = 'horizontal',
  pauseOnHover = false,
  yoyo = true,
  pulseSpeed = 2.8
}: NeonTextProps) {
  const [isPaused, setIsPaused] = useState(false);
  const progress = useMotionValue(0);
  const pulse = useMotionValue(0.5);
  const elapsedRef = useRef(0);
  const pulseElapsedRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  const animationDuration = Math.max(animationSpeed, 0.1) * 1000;
  const pulseDuration = Math.max(pulseSpeed, 0.2) * 1000;
  const palette = colors.length >= 3 ? colors : [...colors, ...DEFAULT_COLORS].slice(0, 3);

  useAnimationFrame((time) => {
    if (isPaused) {
      lastTimeRef.current = null;
      return;
    }

    if (lastTimeRef.current === null) {
      lastTimeRef.current = time;
      return;
    }

    const deltaTime = time - lastTimeRef.current;
    lastTimeRef.current = time;
    elapsedRef.current += deltaTime;
    pulseElapsedRef.current += deltaTime;

    if (yoyo) {
      const fullCycle = animationDuration * 2;
      const cycleTime = elapsedRef.current % fullCycle;

      if (cycleTime < animationDuration) {
        progress.set((cycleTime / animationDuration) * 100);
      } else {
        progress.set(100 - ((cycleTime - animationDuration) / animationDuration) * 100);
      }
    } else {
      progress.set((elapsedRef.current / animationDuration) * 100);
    }

    const phase = (pulseElapsedRef.current / pulseDuration) * Math.PI * 2;
    pulse.set(0.5 + 0.5 * Math.sin(phase));
  });

  useEffect(() => {
    elapsedRef.current = 0;
    pulseElapsedRef.current = 0;
    progress.set(0);
    pulse.set(0.5);
  }, [animationSpeed, pulseSpeed, yoyo, progress, pulse]);

  const backgroundPosition = useTransform(progress, (value) => {
    if (direction === 'vertical') {
      return `50% ${value}%`;
    }
    if (direction === 'diagonal') {
      return `${value}% ${value}%`;
    }
    return `${value}% 50%`;
  });

  const textShadow = useTransform(pulse, (value) => {
    const intensity = 0.7 + value * 0.7;
    const layers = [
      { color: palette[2], blur: 10, alpha: 0.65 },
      { color: palette[1], blur: 18, alpha: 0.55 },
      { color: palette[0], blur: 28, alpha: 0.45 },
      { color: palette[2], blur: 42, alpha: 0.4 },
      { color: palette[1], blur: 60, alpha: 0.35 }
    ];

    return layers
      .map((layer) => {
        const blur = layer.blur * intensity;
        const alpha = layer.alpha + value * 0.2;
        return `0 0 ${blur.toFixed(1)}px ${hexToRgba(layer.color, alpha)}`;
      })
      .join(', ');
  });

  const boxShadow = useTransform(pulse, (value) => {
    const intensity = 0.6 + value * 0.6;
    const layers = [
      { color: palette[0], blur: 24, spread: 4, alpha: 0.18 },
      { color: palette[1], blur: 46, spread: 6, alpha: 0.14 },
      { color: palette[2], blur: 72, spread: 10, alpha: 0.12 }
    ];

    return layers
      .map((layer) => {
        const blur = layer.blur * intensity;
        const spread = layer.spread * intensity;
        const alpha = layer.alpha + value * 0.1;
        return `0 0 ${blur.toFixed(1)}px ${spread.toFixed(1)}px ${hexToRgba(layer.color, alpha)}`;
      })
      .join(', ');
  });

  const handleMouseEnter = useCallback(() => {
    if (pauseOnHover) setIsPaused(true);
  }, [pauseOnHover]);

  const handleMouseLeave = useCallback(() => {
    if (pauseOnHover) setIsPaused(false);
  }, [pauseOnHover]);

  const gradientAngle =
    direction === 'horizontal' ? 'to right' : direction === 'vertical' ? 'to bottom' : 'to bottom right';
  const gradientColors = [...palette, palette[0]].join(', ');

  const gradientStyle = {
    backgroundImage: `linear-gradient(${gradientAngle}, ${gradientColors})`,
    backgroundSize: direction === 'horizontal' ? '320% 100%' : direction === 'vertical' ? '100% 320%' : '320% 320%',
    backgroundRepeat: 'repeat',
    WebkitBackgroundClip: 'text' as const
  };

  return (
    <motion.span
      className={`inline-block text-transparent bg-clip-text ${className}`}
      style={{
        ...gradientStyle,
        backgroundPosition,
        textShadow,
        boxShadow,
        filter: 'brightness(1.05) saturate(1.1)'
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </motion.span>
  );
}
