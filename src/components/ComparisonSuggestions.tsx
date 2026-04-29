import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Clock, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ComparisonSuggestion {
  itemA: string;
  itemB: string;
  timestamp?: number;
}

interface ComparisonSuggestionsProps {
  onSelect: (itemA: string, itemB: string) => void;
  visible: boolean;
}

const STORAGE_KEY = 'recent-comparisons';
const MAX_RECENT = 5;

function getRecentComparisons(): ComparisonSuggestion[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

export function saveRecentComparison(itemA: string, itemB: string) {
  try {
    const recent = getRecentComparisons().filter(
      (r) => !(r.itemA === itemA && r.itemB === itemB)
    );
    recent.unshift({ itemA, itemB, timestamp: Date.now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // ignore
  }
}

export default function ComparisonSuggestions({ onSelect, visible }: ComparisonSuggestionsProps) {
  const { t, i18n: i18nInstance } = useTranslation();
  const [featured, setFeatured] = useState<ComparisonSuggestion[]>([]);
  const [communityRecent, setCommunityRecent] = useState<ComparisonSuggestion[]>([]);
  const [recent, setRecent] = useState<ComparisonSuggestion[]>([]);

  useEffect(() => {
    setRecent(getRecentComparisons());

    const lang = i18nInstance.language || 'en';
    fetch(`/api/suggestions?lang=${encodeURIComponent(lang)}`)
      .then((res) => res.json())
      .then((data) => {
        setFeatured(data.featured || []);
        setCommunityRecent(data.recent || []);
      })
      .catch(() => {});
  }, [i18nInstance.language]);

  if (!visible) return null;
  if (featured.length === 0 && recent.length === 0 && communityRecent.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className="absolute top-full left-0 right-0 mt-2 z-40"
      >
        <div className="bg-neutral-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-w-3xl mx-auto">
          {featured.length > 0 && (
            <div className="p-3">
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-bold text-neutral-500 uppercase tracking-wider">
                <Sparkles size={14} />
                <span>{t('hero.recommendedComparisons', 'Recommended')}</span>
              </div>
              <div className="space-y-1">
                {featured.map((item, i) => (
                  <button
                    key={`f-${i}`}
                    type="button"
                    onClick={() => onSelect(item.itemA, item.itemB)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-neutral-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                  >
                    <span className="font-medium">{item.itemA}</span>
                    <span className="text-neutral-600 text-xs font-mono">vs</span>
                    <span className="font-medium">{item.itemB}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {recent.length > 0 && featured.length > 0 && (
            <div className="border-t border-white/5" />
          )}

          {recent.length > 0 && (
            <div className="p-3">
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-bold text-neutral-500 uppercase tracking-wider">
                <Clock size={14} />
                <span>{t('hero.recentComparisons', 'Recent')}</span>
              </div>
              <div className="space-y-1">
                {recent.map((item, i) => (
                  <button
                    key={`r-${i}`}
                    type="button"
                    onClick={() => onSelect(item.itemA, item.itemB)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-neutral-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                  >
                    <span className="font-medium">{item.itemA}</span>
                    <span className="text-neutral-600 text-xs font-mono">vs</span>
                    <span className="font-medium">{item.itemB}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {communityRecent.length > 0 && (recent.length > 0 || featured.length > 0) && (
            <div className="border-t border-white/5" />
          )}

          {communityRecent.length > 0 && (
            <div className="p-3">
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-bold text-neutral-500 uppercase tracking-wider">
                <Users size={14} />
                <span>{t('hero.communityComparisons', 'From the community')}</span>
              </div>
              <div className="space-y-1">
                {communityRecent.slice(0, 8).map((item, i) => (
                  <button
                    key={`c-${i}`}
                    type="button"
                    onClick={() => onSelect(item.itemA, item.itemB)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-neutral-300 hover:bg-white/5 hover:text-white transition-colors text-left"
                  >
                    <span className="font-medium">{item.itemA}</span>
                    <span className="text-neutral-600 text-xs font-mono">vs</span>
                    <span className="font-medium">{item.itemB}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
