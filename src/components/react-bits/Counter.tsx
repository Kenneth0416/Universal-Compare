import { MotionValue, animate, motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import type React from 'react';
import { useEffect, useMemo } from 'react';

type PlaceValue = number | '.';

interface NumberProps {
  mv: MotionValue<number>;
  number: number;
  height: number;
}

function Number({ mv, number, height }: NumberProps) {
  const y = useTransform(mv, (latest) => {
    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;
    let memo = offset * height;
    if (offset > 5) {
      memo -= 10 * height;
    }
    return memo;
  });

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  return <motion.span style={{ ...baseStyle, y }}>{number}</motion.span>;
}

function normalizeNearInteger(num: number): number {
  const nearest = Math.round(num);
  const tolerance = 1e-9 * Math.max(1, Math.abs(num));
  return Math.abs(num - nearest) < tolerance ? nearest : num;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value);
}

function getValueRoundedToPlace(value: number, place: number): number {
  const scaled = value / place;
  return Math.floor(normalizeNearInteger(scaled));
}

interface DigitProps {
  place: PlaceValue;
  mv: MotionValue<number>;
  height: number;
  digitStyle?: React.CSSProperties;
}

function Digit({ place, mv, height, digitStyle }: DigitProps) {
  if (place === '.') {
    return (
      <span
        className="relative inline-flex items-center justify-center"
        style={{ height, width: 'fit-content', ...digitStyle }}
      >
        .
      </span>
    );
  }

  const valueRoundedToPlace = useTransform(mv, (latest) => getValueRoundedToPlace(latest, place));
  const animatedValue = useSpring(valueRoundedToPlace, {
    stiffness: 140,
    damping: 22,
    mass: 0.7
  });

  const defaultStyle: React.CSSProperties = {
    height,
    position: 'relative',
    width: '1ch',
    fontVariantNumeric: 'tabular-nums'
  };

  return (
    <span className="relative inline-flex overflow-hidden" style={{ ...defaultStyle, ...digitStyle }}>
      {Array.from({ length: 10 }, (_, i) => (
        <Number key={i} mv={animatedValue} number={i} height={height} />
      ))}
    </span>
  );
}

interface CounterProps {
  from?: number;
  to: number;
  duration?: number;
  fontSize?: number;
  padding?: number;
  places?: PlaceValue[];
  gap?: number;
  className?: string;
  textColor?: string;
  fontWeight?: React.CSSProperties['fontWeight'];
  containerStyle?: React.CSSProperties;
  counterStyle?: React.CSSProperties;
  digitStyle?: React.CSSProperties;
}

function resolvePlaces(value: number): PlaceValue[] {
  const valueString = value.toString();
  return [...valueString].map((ch, i, a) => {
    if (ch === '.') {
      return '.';
    }

    const dotIndex = a.indexOf('.');
    const isInteger = dotIndex === -1;
    const exponent = isInteger ? a.length - i - 1 : i < dotIndex ? dotIndex - i - 1 : -(i - dotIndex);

    return 10 ** exponent;
  });
}

export default function Counter({
  from = 0,
  to = 0,
  duration = 0.8,
  fontSize = 12,
  padding = 0,
  places,
  gap = 0,
  className = '',
  textColor = 'inherit',
  fontWeight = 'inherit',
  containerStyle,
  counterStyle,
  digitStyle
}: CounterProps) {
  const safeFrom = isFiniteNumber(from) ? from : 0;
  const safeTo = isFiniteNumber(to) ? to : 0;
  const height = fontSize + padding;

  const resolvedPlaces = useMemo(() => {
    if (places && places.length > 0) return places;
    return resolvePlaces(safeTo);
  }, [places, safeTo]);

  const motionValue = useMotionValue(safeFrom);

  useEffect(() => {
    motionValue.set(safeFrom);
    const controls = animate(motionValue, safeTo, {
      duration: Math.max(duration, 0),
      ease: 'easeOut'
    });
    return controls.stop;
  }, [motionValue, safeFrom, safeTo, duration]);

  const defaultContainerStyle: React.CSSProperties = {
    position: 'relative',
    display: 'inline-flex'
  };

  const defaultCounterStyle: React.CSSProperties = {
    fontSize,
    display: 'inline-flex',
    alignItems: 'center',
    gap,
    overflow: 'hidden',
    lineHeight: 1,
    color: textColor,
    fontWeight
  };

  return (
    <span className={className} style={{ ...defaultContainerStyle, ...containerStyle }}>
      <span style={{ ...defaultCounterStyle, ...counterStyle }}>
        {resolvedPlaces.map((place, index) => (
          <Digit key={`${place}-${index}`} place={place} mv={motionValue} height={height} digitStyle={digitStyle} />
        ))}
      </span>
    </span>
  );
}
