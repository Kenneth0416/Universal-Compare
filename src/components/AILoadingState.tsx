import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Database, Zap, Network } from 'lucide-react';

interface AILoadingStateProps {
  itemA: string;
  itemB: string;
  stepDescription?: string;
}

const usePrefersReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', updatePreference);
    } else {
      mediaQuery.addListener(updatePreference);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', updatePreference);
      } else {
        mediaQuery.removeListener(updatePreference);
      }
    };
  }, []);

  return prefersReducedMotion;
};

export const AILoadingState: React.FC<AILoadingStateProps> = ({ itemA, itemB, stepDescription }) => {
  const steps = [
    { label: 'Parsing inputs', icon: Database },
    { label: 'Mapping concepts', icon: Network },
    { label: 'Synthesizing results', icon: Zap }
  ];
  const [activeStep, setActiveStep] = React.useState(0);
  const prefersReducedMotion = usePrefersReducedMotion();

  React.useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 2200);

    return () => clearInterval(interval);
  }, [steps.length]);

  const gridCells = React.useMemo(
    () =>
      Array.from({ length: 48 }).map(() => ({
        opacity: Math.random() * 0.3 + 0.4,
        duration: Math.random() * 1.5 + 1.5,
        delay: Math.random() * 2
      })),
    []
  );

  return (
    <div className="py-20 sm:py-24 flex flex-col items-center justify-center w-full max-w-3xl mx-auto gap-10">
      {/* Visualizer: Item A <--> Item B */}
      <div className="flex items-center justify-center gap-4 sm:gap-8 w-full px-4">
        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.4, ease: "easeOut" }}
          className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-mono text-sm sm:text-base truncate max-w-[140px] sm:max-w-[180px] shadow-[0_0_20px_rgba(255,255,255,0.05)]"
        >
          {itemA || 'Item A'}
        </motion.div>

        {/* Connecting Line with Pulse */}
        <div className="relative flex-1 h-px bg-white/10 max-w-[200px]">
          <motion.div
            className="absolute top-1/2 left-0 w-1/3 h-[2px] bg-indigo-400/70 -translate-y-1/2 rounded-full"
            animate={
              prefersReducedMotion
                ? { opacity: 0.6 }
                : {
                    left: ['0%', '66%', '0%'],
                    opacity: [0.4, 0.8, 0.4]
                  }
            }
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { duration: 2.0, repeat: Infinity, ease: "easeInOut" }
            }
          />
          {/* Center Node */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-indigo-300 rounded-full border-2 border-[#050505]">
            <motion.div 
              className="absolute inset-0 bg-indigo-400 rounded-full"
              animate={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { scale: [1, 2, 1], opacity: [0.3, 0, 0.3] }
              }
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                : { duration: 2.0, repeat: Infinity, ease: "easeInOut" }
              }
            />
          </div>
        </div>

        <motion.div
          initial={prefersReducedMotion ? false : { opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.4, ease: "easeOut" }}
          className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-mono text-sm sm:text-base truncate max-w-[140px] sm:max-w-[180px] shadow-[0_0_20px_rgba(255,255,255,0.05)]"
        >
          {itemB || 'Item B'}
        </motion.div>
      </div>

      <div className="w-full max-w-xl flex flex-col items-center gap-4">
        {/* Dynamic Status Text */}
        <div className="h-12 relative w-full text-center flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={stepDescription}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
              transition={prefersReducedMotion ? { duration: 0.2 } : { duration: 0.35, ease: "easeOut" }}
              className="text-indigo-200 font-medium text-lg flex items-center gap-3"
            >
              <motion.div
                className="h-4 w-4 rounded-full border border-indigo-300/80 border-t-transparent"
                animate={prefersReducedMotion ? { rotate: 0 } : { rotate: 360 }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 1.0, repeat: Infinity, ease: "linear" }}
              />
              <motion.span
                animate={prefersReducedMotion ? { opacity: 1 } : { opacity: [0.75, 1, 0.75] }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              >
                {stepDescription || "Initializing AI Engine..."}
              </motion.span>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Loading Steps */}
        <div className="flex flex-wrap items-center justify-center gap-3 text-xs sm:text-sm">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = index === activeStep;
            return (
              <motion.div
                key={step.label}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-white/70"
                animate={{ opacity: isActive ? 1 : 0.55 }}
                transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.4, ease: "easeOut" }}
              >
                <Icon size={14} className="text-indigo-200" />
                <span>{step.label}</span>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Processing Grid (AI Brain/Server simulation) */}
      <div className="grid grid-cols-8 sm:grid-cols-12 lg:grid-cols-16 gap-2 p-4 bg-white/5 rounded-2xl border border-white/5 backdrop-blur-sm">
        {gridCells.map((cell, i) => (
          <motion.div
            key={i}
            className="w-3 h-3 rounded-[2px] bg-indigo-400/70"
            animate={
              prefersReducedMotion
                ? { opacity: 0.4 }
                : {
                    opacity: [0.25, cell.opacity, 0.25],
                    scale: [1, 1.04, 1]
                  }
            }
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : {
                    duration: cell.duration,
                    repeat: Infinity,
                    delay: cell.delay,
                    ease: "easeInOut"
                  }
            }
          />
        ))}
      </div>

    </div>
  );
};
