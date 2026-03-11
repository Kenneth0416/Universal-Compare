import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cpu, Database, Zap, Network } from 'lucide-react';

interface AILoadingStateProps {
  itemA: string;
  itemB: string;
  stepDescription?: string;
}

export const AILoadingState: React.FC<AILoadingStateProps> = ({ itemA, itemB, stepDescription }) => {
  return (
    <div className="py-24 flex flex-col items-center justify-center w-full max-w-2xl mx-auto">
      {/* Visualizer: Item A <--> Item B */}
      <div className="flex items-center justify-center gap-4 sm:gap-8 mb-16 w-full px-4">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-mono text-sm sm:text-base truncate max-w-[120px] sm:max-w-[160px] shadow-[0_0_20px_rgba(255,255,255,0.05)]"
        >
          {itemA || 'Item A'}
        </motion.div>

        {/* Connecting Line with Pulse */}
        <div className="relative flex-1 h-px bg-white/10 max-w-[200px]">
          <motion.div
            className="absolute top-1/2 left-0 w-1/3 h-[2px] bg-indigo-500 -translate-y-1/2 shadow-[0_0_15px_rgba(99,102,241,0.8)] rounded-full"
            animate={{ 
              left: ['0%', '66%', '0%'],
              opacity: [0.5, 1, 0.5]
            }}
            transition={{ 
              duration: 2, 
              repeat: Infinity, 
              ease: "easeInOut" 
            }}
          />
          {/* Center Node */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-indigo-400 rounded-full shadow-[0_0_15px_rgba(99,102,241,0.6)] border-2 border-[#050505]">
            <motion.div 
              className="absolute inset-0 bg-indigo-400 rounded-full"
              animate={{ scale: [1, 2.5, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
        </div>

        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white font-mono text-sm sm:text-base truncate max-w-[120px] sm:max-w-[160px] shadow-[0_0_20px_rgba(255,255,255,0.05)]"
        >
          {itemB || 'Item B'}
        </motion.div>
      </div>

      {/* Dynamic Status Text */}
      <div className="h-12 relative w-full max-w-md text-center mb-12 flex items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={stepDescription}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="text-indigo-300 font-medium text-lg flex items-center gap-3"
          >
            <Cpu size={18} className="animate-pulse" />
            <span>{stepDescription || "Initializing AI Engine..."}</span>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Processing Grid (AI Brain/Server simulation) */}
      <div className="grid grid-cols-12 sm:grid-cols-16 gap-1.5 sm:gap-2 p-4 bg-white/5 rounded-2xl border border-white/5 backdrop-blur-sm">
        {Array.from({ length: 48 }).map((_, i) => (
          <motion.div
            key={i}
            className="w-2 h-2 sm:w-3 sm:h-3 rounded-[2px] bg-indigo-500"
            animate={{ 
              opacity: [0.1, Math.random() * 0.8 + 0.2, 0.1],
              scale: [1, 1.1, 1]
            }}
            transition={{
              duration: Math.random() * 2 + 1,
              repeat: Infinity,
              delay: Math.random() * 2,
              ease: "easeInOut"
            }}
          />
        ))}
      </div>
    </div>
  );
};
