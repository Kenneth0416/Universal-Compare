import { ReactNode, useId, useRef } from 'react';
import { useAnimationFrame } from 'motion/react';

interface FuzzyTextProps {
  children: ReactNode;
  intensity?: number;
  animated?: boolean;
  className?: string;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export default function FuzzyText({
  children,
  intensity = 6,
  animated = true,
  className = ''
}: FuzzyTextProps) {
  const rawId = useId();
  const filterId = `fuzzy-${rawId.replace(/:/g, '')}`;
  const fineNoiseRef = useRef<SVGFETurbulenceElement | null>(null);
  const coarseNoiseRef = useRef<SVGFETurbulenceElement | null>(null);
  const seedStepRef = useRef(0);

  const scale = clamp(intensity, 0, 20);
  const showFuzz = scale > 0.1;
  const mainDisplacement = Math.max(0.4, scale * 0.65);
  const fineDisplacement = Math.max(0.2, scale * 0.25);
  const blurAmount = Math.max(0.2, scale * 0.06);
  const overlayOpacity = Math.min(0.75, 0.35 + scale * 0.02);

  useAnimationFrame((time) => {
    if (!animated || !showFuzz || !fineNoiseRef.current || !coarseNoiseRef.current) return;

    const t = time / 1000;
    const fineBase = clamp(0.82 + Math.sin(t * 1.15) * 0.08, 0.6, 0.98);
    const coarseBase = clamp(0.018 + Math.sin(t * 0.75) * 0.004, 0.01, 0.04);
    fineNoiseRef.current.setAttribute('baseFrequency', `${fineBase} ${fineBase}`);
    coarseNoiseRef.current.setAttribute('baseFrequency', `${coarseBase} ${coarseBase}`);

    const nextSeedStep = Math.floor(t * 2.6);
    if (nextSeedStep !== seedStepRef.current) {
      seedStepRef.current = nextSeedStep;
      const seed = (nextSeedStep * 19) % 97;
      fineNoiseRef.current.setAttribute('seed', String(seed));
      coarseNoiseRef.current.setAttribute('seed', String((seed + 11) % 97));
    }
  });

  return (
    <span className={`relative inline-block ${className}`}>
      <svg aria-hidden="true" className="absolute h-0 w-0">
        <filter id={filterId} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
          <feTurbulence
            ref={coarseNoiseRef}
            type="fractalNoise"
            baseFrequency="0.02"
            numOctaves={2}
            seed={3}
            result="noiseCoarse"
          />
          <feTurbulence
            ref={fineNoiseRef}
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves={1}
            seed={7}
            result="noiseFine"
          />
          <feDisplacementMap in="SourceGraphic" in2="noiseCoarse" scale={mainDisplacement} result="dispCoarse" />
          <feDisplacementMap in="dispCoarse" in2="noiseFine" scale={fineDisplacement} result="dispFine" />
          <feGaussianBlur in="dispFine" stdDeviation={blurAmount} result="blurred" />
          <feComposite in="blurred" in2="dispFine" operator="atop" />
        </filter>
      </svg>
      {showFuzz && (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none select-none"
            style={{ filter: `url(#${filterId})`, opacity: overlayOpacity }}
          >
            {children}
          </span>
          <span
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none select-none"
            style={{ filter: `url(#${filterId}) blur(${Math.max(0.4, blurAmount)}px)`, opacity: overlayOpacity * 0.6 }}
          >
            {children}
          </span>
        </>
      )}
      <span className="relative z-10">{children}</span>
    </span>
  );
}
