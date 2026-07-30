import { useEffect, useRef, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const getInitialPreference = () =>
  typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches;

export function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getInitialPreference);

  useEffect(() => {
    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  return prefersReducedMotion;
}

export function useRespectfulAnimationFrame(
  callback: (time: number) => void,
  enabled = true,
) {
  const callbackRef = useRef(callback);
  const prefersReducedMotion = usePrefersReducedMotion();
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled || prefersReducedMotion) return;

    let frameId = 0;
    const frame = (time: number) => {
      callbackRef.current(time);
      frameId = requestAnimationFrame(frame);
    };

    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [enabled, prefersReducedMotion]);

  return prefersReducedMotion;
}
