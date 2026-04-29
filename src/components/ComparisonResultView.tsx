import { motion } from 'motion/react';
import { Search, CheckCircle2, XCircle, AlertCircle, ChevronRight, Info } from 'lucide-react';
import { ComparisonGrid } from './ComparisonGrid';
import { ComparisonCard } from './ComparisonCard';
import { DimensionChart } from './DimensionChart';
import { ShareButton } from './ShareButton';
import Counter from './react-bits/Counter';
import { useTranslation } from 'react-i18next';
import type { ComparisonResult } from '../services/geminiService';

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && isFinite(value);

const buildDimensionSummary = (dimension: ComparisonResult['dimensions'][number]) =>
  [
    dimension.why_it_matters,
    dimension.analysis?.item_a_summary,
    dimension.analysis?.item_b_summary,
    dimension.analysis?.key_difference
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ');

interface ComparisonResultViewProps {
  result: ComparisonResult;
  reportUrl?: string | null;
  showShare?: boolean;
}

export default function ComparisonResultView({ result, reportUrl, showShare = true }: ComparisonResultViewProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-12">
      {/* 1. Verdict & Relationship */}
      <section className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 sm:p-10 shadow-2xl border border-white/10">
        <div className="text-center mb-8">
          {result.recommendation?.short_verdict && (
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
              {result.recommendation.short_verdict}
            </h2>
          )}
          {result.recommendation?.long_verdict && (
            <p className="text-lg text-neutral-300 max-w-3xl mx-auto leading-relaxed">
              {result.recommendation.long_verdict}
            </p>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-6 pt-8 border-t border-white/10">
          <div className="bg-white/5 rounded-2xl p-6 border border-white/5">
            <div className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3 font-mono">
              <Info size={16} />
              <span>{t('result.relationship')}</span>
            </div>
            {result.relationship?.relationship_type && (
              <p className="text-white font-medium mb-2 capitalize">
                {result.relationship.relationship_type.replace(/_/g, ' ')}
              </p>
            )}
            {result.relationship?.reasoning && (
              <p className="text-neutral-400 text-sm">{result.relationship.reasoning}</p>
            )}
          </div>
          <div className="bg-white/5 rounded-2xl p-6 border border-white/5">
            <div className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3 font-mono">
              <Search size={16} />
              <span>{t('result.comparisonGoal')}</span>
            </div>
            {result.relationship?.comparison_goal && (
              <p className="text-white font-medium mb-2">{result.relationship.comparison_goal}</p>
            )}
            {result.relationship?.can_directly_compare === false &&
              result.recommendation?.when_not_to_compare_directly && (
                <p className="text-amber-400 text-sm mt-2 flex items-start gap-1.5">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{result.recommendation.when_not_to_compare_directly}</span>
                </p>
              )}
          </div>
        </div>
      </section>

      {/* 2. Dimensions Comparison */}
      <section className="space-y-8">
        <h3 className="text-2xl font-bold text-white mb-6 px-2">{t('result.keyDimensions')}</h3>

        {(result.dimensions?.length ?? 0) > 0 &&
          result.entityA?.name &&
          result.entityB?.name && (
            <DimensionChart
              dimensions={result.dimensions}
              entityA={result.entityA.name}
              entityB={result.entityB.name}
            />
          )}

        <ComparisonGrid>
          {result.dimensions?.map((dim, idx) => {
            const scoreA = dim.analysis?.optional_score_a;
            const scoreB = dim.analysis?.optional_score_b;
            const safeScoreA = isFiniteNumber(scoreA) ? scoreA : 0;
            const safeScoreB = isFiniteNumber(scoreB) ? scoreB : 0;
            const summary = buildDimensionSummary(dim);

            return (
              <ComparisonCard
                key={dim.key || idx}
                title={dim.label}
                summary={summary}
                categoryLabel={dim.key}
                scoreA={scoreA}
                scoreB={scoreB}
                className="h-full"
              >
                {dim.why_it_matters && (
                  <p className="text-neutral-400 text-xs mb-4 flex-grow">{dim.why_it_matters}</p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                    <div className="flex justify-between items-center mb-2">
                      {result.entityA?.name && (
                        <p className="font-semibold text-white text-sm pr-2">{result.entityA.name}</p>
                      )}
                      {scoreA != null && (
                        <span className="font-mono text-xs font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded">
                          <Counter from={0} to={safeScoreA} duration={0.8} fontSize={12} />
                          /10
                        </span>
                      )}
                    </div>
                    {dim.analysis?.item_a_summary && (
                      <p className="text-neutral-300 text-sm sm:text-xs mt-1">{dim.analysis.item_a_summary}</p>
                    )}
                  </div>
                  <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                    <div className="flex justify-between items-center mb-2">
                      {result.entityB?.name && (
                        <p className="font-semibold text-white text-sm pr-2">{result.entityB.name}</p>
                      )}
                      {scoreB != null && (
                        <span className="font-mono text-xs font-bold text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded">
                          <Counter from={0} to={safeScoreB} duration={0.8} fontSize={12} />
                          /10
                        </span>
                      )}
                    </div>
                    {dim.analysis?.item_b_summary && (
                      <p className="text-neutral-300 text-sm sm:text-xs mt-1">{dim.analysis.item_b_summary}</p>
                    )}
                  </div>
                </div>
                <div className="text-xs text-neutral-300 border-t border-white/10 pt-3 flex flex-col sm:flex-row justify-between gap-3">
                  {dim.analysis?.key_difference && (
                    <div>
                      <span className="font-semibold text-white">{t('result.keyDifference')} </span>
                      {dim.analysis.key_difference}
                    </div>
                  )}
                  {dim.analysis?.better_for && (
                    <div className="shrink-0">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 text-white text-[10px] font-bold uppercase tracking-wide border border-white/10">
                        {t('result.winner')}{' '}
                        {dim.analysis.better_for === 'A'
                          ? result.entityA?.name || 'A'
                          : dim.analysis.better_for === 'B'
                          ? result.entityB?.name || 'B'
                          : dim.analysis.better_for}
                      </span>
                    </div>
                  )}
                </div>
              </ComparisonCard>
            );
          })}
        </ComparisonGrid>
      </section>

      {/* 3. Pros & Cons */}
      <motion.section
        className="grid md:grid-cols-2 gap-6"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        {/* Entity A */}
        <div className="bg-white/5 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl border border-white/10">
          {result.entityA?.name && (
            <h3 className="text-xl font-bold text-white mb-6 pb-4 border-b border-white/10">
              {result.entityA.name}
            </h3>
          )}
          <div className="space-y-6">
            {(result.prosCons?.item_a_pros?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2 font-mono">
                  <CheckCircle2 size={16} /> {t('result.pros')}
                </h4>
                <ul className="space-y-2 sm:space-y-1.5">
                  {result.prosCons?.item_a_pros?.map((pro, i) => (
                    <li key={i}>
                      <motion.div
                        className="flex items-start gap-2 text-sm text-neutral-300 rounded-xl px-2 py-1 active:bg-emerald-500/20 sm:hover:bg-emerald-500/20 transition-colors"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, delay: i * 0.1 }}
                      >
                        <span className="text-emerald-500 mt-0.5">•</span>
                        <span>{pro}</span>
                      </motion.div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(result.prosCons?.item_a_cons?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-3 flex items-center gap-2 font-mono">
                  <XCircle size={16} /> {t('result.cons')}
                </h4>
                <ul className="space-y-2 sm:space-y-1.5">
                  {result.prosCons?.item_a_cons?.map((con, i) => (
                    <li key={i}>
                      <motion.div
                        className="flex items-start gap-2 text-sm text-neutral-300 rounded-xl px-2 py-1 active:bg-rose-500/20 sm:hover:bg-rose-500/20 transition-colors"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, delay: i * 0.1 }}
                      >
                        <span className="text-rose-500 mt-0.5">•</span>
                        <span>{con}</span>
                      </motion.div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Entity B */}
        <div className="bg-white/5 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl border border-white/10">
          {result.entityB?.name && (
            <h3 className="text-xl font-bold text-white mb-6 pb-4 border-b border-white/10">
              {result.entityB.name}
            </h3>
          )}
          <div className="space-y-6">
            {(result.prosCons?.item_b_pros?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2 font-mono">
                  <CheckCircle2 size={16} /> {t('result.pros')}
                </h4>
                <ul className="space-y-2 sm:space-y-1.5">
                  {result.prosCons?.item_b_pros?.map((pro, i) => (
                    <li key={i}>
                      <motion.div
                        className="flex items-start gap-2 text-sm text-neutral-300 rounded-xl px-2 py-1 active:bg-emerald-500/20 sm:hover:bg-emerald-500/20 transition-colors"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, delay: i * 0.1 }}
                      >
                        <span className="text-emerald-500 mt-0.5">•</span>
                        <span>{pro}</span>
                      </motion.div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(result.prosCons?.item_b_cons?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-3 flex items-center gap-2 font-mono">
                  <XCircle size={16} /> {t('result.cons')}
                </h4>
                <ul className="space-y-2 sm:space-y-1.5">
                  {result.prosCons?.item_b_cons?.map((con, i) => (
                    <li key={i}>
                      <motion.div
                        className="flex items-start gap-2 text-sm text-neutral-300 rounded-xl px-2 py-1 active:bg-rose-500/20 sm:hover:bg-rose-500/20 transition-colors"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, delay: i * 0.1 }}
                      >
                        <span className="text-rose-500 mt-0.5">•</span>
                        <span>{con}</span>
                      </motion.div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </motion.section>

      {/* 4. Who is it for? */}
      <section className="bg-indigo-950/40 backdrop-blur-xl text-white rounded-3xl p-8 sm:p-10 shadow-2xl border border-indigo-500/20">
        <h3 className="text-2xl font-bold mb-8 text-center">{t('result.whoShouldChoose')}</h3>
        <div className="grid md:grid-cols-2 gap-8 relative">
          <div className="hidden md:block absolute top-0 bottom-0 left-1/2 w-px bg-indigo-500/20 -translate-x-1/2" />

          <div>
            {result.entityA?.name && (
              <h4 className="text-xl font-semibold text-indigo-300 mb-4">{result.entityA.name}</h4>
            )}
            {(result.recommendation?.best_for_a?.length ?? 0) > 0 && (
              <ul className="space-y-3">
                {result.recommendation?.best_for_a?.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-neutral-300">
                    <ChevronRight size={18} className="text-indigo-400 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            {result.entityB?.name && (
              <h4 className="text-xl font-semibold text-indigo-300 mb-4">{result.entityB.name}</h4>
            )}
            {(result.recommendation?.best_for_b?.length ?? 0) > 0 && (
              <ul className="space-y-3">
                {result.recommendation?.best_for_b?.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-neutral-300">
                    <ChevronRight size={18} className="text-indigo-400 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {result.recommendation?.which_to_choose_first && (
          <div className="mt-10 pt-8 border-t border-indigo-500/20 text-center">
            <p className="text-indigo-300/60 text-xs uppercase tracking-widest font-bold mb-2 font-mono">
              {t('result.defaultChoice')}
            </p>
            <p className="text-xl font-medium text-white">
              {result.recommendation.which_to_choose_first}
            </p>
          </div>
        )}
      </section>

      {/* 5. Share Section */}
      {showShare && (
        <section className="flex flex-col items-center gap-4 py-8">
          <div className="text-center mb-2">
            <h3 className="text-xl font-bold text-white mb-2">分享你的对比结果</h3>
            <p className="text-sm text-neutral-400">生成精美海报，分享到小红书</p>
          </div>
          <ShareButton result={result} reportUrl={reportUrl} />
        </section>
      )}
    </div>
  );
}
