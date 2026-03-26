import React from 'react';
import { motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';

interface ComparisonCardProps {
  title: string;
  summary?: string;
  categoryLabel?: string;
  scoreA?: number | null;
  scoreB?: number | null;
  children: React.ReactNode;
  className?: string;
}

const accordionSpring = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 30
};

const normalizePreview = (value: string) => value.replace(/\s+/g, ' ').trim();

const truncatePreview = (value: string, maxLength = 100) => {
  const normalized = normalizePreview(value);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
};

const extractTextContent = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(extractTextContent).join(' ');
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractTextContent(node.props.children);
  }

  return '';
};

const formatCategoryLabel = (value?: string) => {
  if (!value) {
    return 'dimension';
  }

  return value.replace(/[_-]+/g, ' ').trim();
};

const formatScore = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

const SCORE_SEGMENTS = 10;

const clampScore = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(SCORE_SEGMENTS, Math.max(0, value));
};

const getScoreFillClass = (value: number) => {
  if (value >= 7) {
    return 'bg-emerald-500';
  }

  if (value >= 4) {
    return 'bg-amber-500';
  }

  return 'bg-rose-500';
};

interface ScoreGaugeProps {
  label: 'A' | 'B';
  score?: number | null;
}

const ScoreGauge: React.FC<ScoreGaugeProps> = ({ label, score }) => {
  const formattedScore = formatScore(score);
  const normalizedScore = clampScore(score);
  const filledSegments = normalizedScore === null ? 0 : Math.round(normalizedScore);
  const fillClass = normalizedScore === null ? 'bg-white/10' : getScoreFillClass(normalizedScore);

  return (
    <div
      className="flex min-w-0 items-center gap-1.5 sm:gap-2"
      aria-label={`${label} score ${formattedScore ?? 'unavailable'} out of ${SCORE_SEGMENTS}`}
    >
      <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-wide text-indigo-200">
        [{label}]
      </span>
      <div className="grid w-14 shrink-0 grid-cols-10 gap-0.5 sm:w-24 sm:gap-1" aria-hidden="true">
        {Array.from({ length: SCORE_SEGMENTS }, (_, index) => (
          <span
            key={`${label}-${index}`}
            className={[
              'h-1.5 rounded-[2px] sm:h-2',
              index < filledSegments ? fillClass : 'bg-white/10'
            ].join(' ')}
          />
        ))}
      </div>
      <span className="shrink-0 font-mono text-base font-bold leading-none text-white">
        {formattedScore ?? '--'}
      </span>
    </div>
  );
};

export const ComparisonCard: React.FC<ComparisonCardProps> = ({
  title,
  summary,
  categoryLabel,
  scoreA,
  scoreB,
  children,
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const contentId = React.useId().replace(/:/g, '');
  const preview = truncatePreview(summary ?? extractTextContent(children));

  const handleToggle = () => {
    setIsExpanded((current) => !current);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggle();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={[
        'group h-full overflow-hidden rounded-2xl border backdrop-blur-xl shadow-2xl transition-[border-color,box-shadow,background-color] duration-300',
        isExpanded
          ? 'border-indigo-400/50 bg-indigo-500/10 shadow-[0_0_32px_rgba(99,102,241,0.22)]'
          : 'border-white/10 bg-white/5 shadow-black/50 hover:border-indigo-300/35 hover:shadow-[0_0_28px_rgba(129,140,248,0.18)]',
        className
      ].join(' ')}
      style={{ willChange: 'transform' }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className="cursor-pointer select-none px-4 py-4 outline-none transition-colors sm:px-6 sm:py-5 focus-visible:ring-2 focus-visible:ring-indigo-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-neutral-500">
                {formatCategoryLabel(categoryLabel)}
              </span>
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <ScoreGauge label="A" score={scoreA} />
                <ScoreGauge label="B" score={scoreB} />
              </div>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-semibold tracking-tight text-white">{title}</h3>
                {preview && <p className="mt-2 truncate pr-2 text-sm leading-relaxed text-neutral-400">{preview}</p>}
              </div>
            </div>
          </div>

          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={accordionSpring}
            className="mt-1 shrink-0 rounded-full border border-white/10 bg-white/5 p-2 text-neutral-300"
            aria-hidden="true"
          >
            <ChevronDown size={16} />
          </motion.span>
        </div>
      </div>

      <motion.div
        id={contentId}
        initial={false}
        animate={{
          height: isExpanded ? 'auto' : 0,
          opacity: isExpanded ? 1 : 0
        }}
        transition={{
          height: accordionSpring,
          opacity: { duration: 0.18, ease: 'easeOut' }
        }}
        className={isExpanded ? 'overflow-hidden' : 'pointer-events-none overflow-hidden'}
        aria-hidden={!isExpanded}
      >
        <motion.div
          initial={false}
          animate={{ y: isExpanded ? 0 : -8 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="px-4 pb-4 sm:px-6 sm:pb-6"
        >
          <div className="border-t border-white/10 pt-4 text-sm leading-relaxed text-neutral-300">
            {children}
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
};
