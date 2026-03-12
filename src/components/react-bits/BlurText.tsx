import { ReactNode, useEffect, useRef, type CSSProperties } from 'react';
import { motion, useAnimationFrame, useMotionValue } from 'motion/react';
import FuzzyText from './FuzzyText';

interface BlurTextProps {
  children: ReactNode;
  duration?: number;
  initialBlur?: number;
  staggerDelay?: number;
  loop?: boolean;
  className?: string;
  fuzzy?: boolean;
  fuzzyIntensity?: number;
  fuzzyAnimated?: boolean;
  gradientColors?: string[];
  gradientDirection?: 'horizontal' | 'vertical' | 'diagonal';
  gradientAnimationSpeed?: number;
  gradientYoyo?: boolean;
  gradientScale?: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export default function BlurText({
  children,
  duration = 1.4,
  initialBlur = 12,
  staggerDelay = 0.06,
  loop = false,
  className = '',
  fuzzy,
  fuzzyIntensity = 0,
  fuzzyAnimated = true,
  gradientColors,
  gradientDirection = 'horizontal',
  gradientAnimationSpeed = 0,
  gradientYoyo = true,
  gradientScale
}: BlurTextProps) {
  const safeDuration = clamp(duration, 0.2, 4);
  const safeBlur = clamp(initialBlur, 0, 24);
  const safeStagger = clamp(staggerDelay, 0, 0.2);
  const enableFuzzy = fuzzy ?? fuzzyIntensity > 0;
  const enableGradient = Array.isArray(gradientColors) && gradientColors.length > 0;
  const gradientShift = useMotionValue(0);
  const elapsedRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  const safeGradientSpeed = Math.max(gradientAnimationSpeed, 0);
  const gradientDuration = Math.max(safeGradientSpeed, 0.1) * 1000;

  useAnimationFrame((time) => {
    if (!enableGradient || safeGradientSpeed === 0) {
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

    if (gradientYoyo) {
      const fullCycle = gradientDuration * 2;
      const cycleTime = elapsedRef.current % fullCycle;

      if (cycleTime < gradientDuration) {
        gradientShift.set((cycleTime / gradientDuration) * 100);
      } else {
        gradientShift.set(100 - ((cycleTime - gradientDuration) / gradientDuration) * 100);
      }
    } else {
      gradientShift.set((elapsedRef.current / gradientDuration) * 100);
    }
  });

  useEffect(() => {
    elapsedRef.current = 0;
    gradientShift.set(0);
  }, [gradientAnimationSpeed, gradientYoyo, gradientShift]);

  if (typeof children !== 'string') {
    return (
      <motion.span
        className={`inline-block ${className}`}
        initial={{ filter: `blur(${safeBlur}px)` }}
        animate={{ filter: 'blur(0px)' }}
        transition={{
          duration: safeDuration,
          ease: [0.22, 0.8, 0.22, 1],
          repeat: loop ? Infinity : 0,
          repeatType: 'reverse'
        }}
      >
        {children}
      </motion.span>
    );
  }

  const chars = children.split('');
  const totalChars = chars.length;
  const gradientAngle =
    gradientDirection === 'horizontal'
      ? 'to right'
      : gradientDirection === 'vertical'
      ? 'to bottom'
      : 'to bottom right';
  const gradientStops = enableGradient ? [...gradientColors!, gradientColors![0]].join(', ') : '';
  const resolvedGradientScale = gradientScale
    ? clamp(gradientScale, 120, 900)
    : clamp(totalChars * 90, 240, 560);

  const renderCharacter = (rawChar: string, index: number) => {
    const displayChar = rawChar === ' ' ? '\u00A0' : rawChar;
    const charPos = totalChars > 1 ? (index / (totalChars - 1)) * 100 : 50;

    let content: ReactNode = displayChar;

    if (enableGradient) {
      const gradientBasePosition =
        gradientDirection === 'vertical'
          ? `50% ${charPos}%`
          : gradientDirection === 'diagonal'
          ? `${charPos}% ${charPos}%`
          : `${charPos}% 50%`;

      const gradientAnimatedPosition =
        gradientDirection === 'vertical'
          ? `50% calc(${charPos}% + (var(--gradient-shift) * 1%))`
          : gradientDirection === 'diagonal'
          ? `calc(${charPos}% + (var(--gradient-shift) * 1%)) calc(${charPos}% + (var(--gradient-shift) * 1%))`
          : `calc(${charPos}% + (var(--gradient-shift) * 1%)) 50%`;

      const backgroundPosition = safeGradientSpeed > 0 ? gradientAnimatedPosition : gradientBasePosition;

      content = (
        <span
          className="inline-block text-transparent bg-clip-text"
          style={{
            backgroundImage: `linear-gradient(${gradientAngle}, ${gradientStops})`,
            backgroundSize:
              gradientDirection === 'vertical'
                ? `100% ${resolvedGradientScale}%`
                : gradientDirection === 'diagonal'
                ? `${resolvedGradientScale}% ${resolvedGradientScale}%`
                : `${resolvedGradientScale}% 100%`,
            backgroundRepeat: 'repeat',
            backgroundPosition,
            WebkitBackgroundClip: 'text'
          }}
        >
          {displayChar}
        </span>
      );
    }

    if (enableFuzzy && displayChar !== '\u00A0') {
      content = (
        <FuzzyText intensity={fuzzyIntensity} animated={fuzzyAnimated} className="inline-block">
          {content}
        </FuzzyText>
      );
    }

    return content;
  };

  return (
    <motion.span
      className={`inline-block whitespace-nowrap ${className}`}
      style={enableGradient && safeGradientSpeed > 0 ? ({ '--gradient-shift': gradientShift } as CSSProperties) : undefined}
    >
      {chars.map((char, index) => (
        <motion.span
          key={`${char}-${index}`}
          className="inline-block"
          initial={{ filter: `blur(${safeBlur}px)` }}
          animate={{ filter: 'blur(0px)' }}
          transition={{
            duration: safeDuration,
            delay: index * safeStagger,
            ease: [0.22, 0.8, 0.22, 1],
            repeat: loop ? Infinity : 0,
            repeatType: 'reverse'
          }}
        >
          {renderCharacter(char, index)}
        </motion.span>
      ))}
    </motion.span>
  );
}
