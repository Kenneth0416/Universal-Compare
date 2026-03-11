import React from 'react';
import { motion } from 'motion/react';

interface ComparisonCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export const ComparisonCard: React.FC<ComparisonCardProps> = ({ title, children, className = '' }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl shadow-black/50 ${className}`}
    >
      <h3 className="text-lg font-semibold text-white mb-4 tracking-tight">{title}</h3>
      <div className="text-neutral-300 text-sm leading-relaxed">
        {children}
      </div>
    </motion.div>
  );
};
