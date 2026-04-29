import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FeaturedItem {
  id: number;
  itemA: string;
  itemB: string;
  description: string;
}

interface FeaturedShowcaseProps {
  onSelect: (itemA: string, itemB: string) => void;
}

export default function FeaturedShowcase({ onSelect }: FeaturedShowcaseProps) {
  const { t, i18n: i18nInstance } = useTranslation();
  const [items, setItems] = useState<FeaturedItem[]>([]);

  useEffect(() => {
    const lang = i18nInstance.language || 'en';
    fetch(`/api/suggestions?lang=${encodeURIComponent(lang)}`)
      .then((res) => res.json())
      .then((data) => setItems(data.featured || []))
      .catch(() => {});
  }, [i18nInstance.language]);

  if (items.length === 0) return null;

  return (
    <section className="mt-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <div className="mb-6 flex items-center justify-center gap-2 text-sm font-medium text-neutral-500">
          <Sparkles size={16} className="text-indigo-400" />
          <span>{t('hero.featuredTitle', 'Try these comparisons')}</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <motion.button
              key={item.id}
              type="button"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 + index * 0.08 }}
              onClick={() => onSelect(item.itemA, item.itemB)}
              className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left backdrop-blur-sm transition-all duration-300 hover:border-indigo-500/30 hover:bg-white/[0.06] hover:shadow-lg hover:shadow-indigo-500/5"
            >
              <div className="mb-3 text-base font-semibold text-white">
                <span>{item.itemA}</span>
                <span className="mx-2 text-xs font-normal text-neutral-600">vs</span>
                <span>{item.itemB}</span>
              </div>
              {item.description && (
                <p className="mb-4 text-sm leading-relaxed text-neutral-500">
                  {item.description}
                </p>
              )}
              <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-400 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                <span>{t('hero.compareBtn', 'Compare')}</span>
                <ArrowRight size={12} />
              </div>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
