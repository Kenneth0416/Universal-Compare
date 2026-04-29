import React, { useState } from 'react';
import { generateComparison, ComparisonResult } from './services/geminiService';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Loader2, CheckCircle2, XCircle, AlertCircle, ChevronRight, Info } from 'lucide-react';
import { ComparisonGrid } from './components/ComparisonGrid';
import { ComparisonCard } from './components/ComparisonCard';
import { AILoadingState } from './components/AILoadingState';
import { DimensionChart } from './components/DimensionChart';
import { ShareButton } from './components/ShareButton';
import { finishComparisonRun, startComparisonRun } from './services/trackingService';
import MinimalGrid from './components/react-bits/MinimalGrid';
import Counter from './components/react-bits/Counter';
import BlurText from './components/react-bits/BlurText';
import { useTranslation } from 'react-i18next';
import { switchLanguage } from './i18n';

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

const warnTrackingFailure = (error: unknown) => {
  console.warn('Comparison tracking failed:', error);
};

export default function App() {
  const { t, i18n: i18nInstance } = useTranslation();
  const [itemA, setItemA] = useState('');
  const [itemB, setItemB] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [partialResult, setPartialResult] = useState<Partial<ComparisonResult> & { dimensions?: any[] }>({});
  const [showPartial, setShowPartial] = useState(false);
  const [error, setError] = useState('');

  const handleCompare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemA.trim() || !itemB.trim()) return;

    const currentLanguage = i18nInstance.language || 'en';

    setLoading(true);
    setShowPartial(false);
    setPartialResult({});
    setError('');
    setResult(null);
    setLoadingStep(t('loading.initializing'));

    let runId: string | undefined;

    try {
      const run = await startComparisonRun({
        itemA,
        itemB,
        language: currentLanguage,
      }).catch((trackingError) => {
        warnTrackingFailure(trackingError);
        return null;
      });
      runId = run?.runId;

      const res = await generateComparison(
        itemA,
        itemB,
        (step) => {
          setLoadingStep(step);
        },
        (phase, data) => {
          setShowPartial(true);
          setPartialResult((prev) => {
            if (phase === 'dimension') {
              return {
                ...prev,
                dimensions: [...(prev.dimensions || []), data],
              };
            }
            return { ...prev, ...data };
          });
        },
        currentLanguage,
        runId
      );
      setResult(res);
      if (runId) {
        await finishComparisonRun({ runId, status: 'completed' }).catch(warnTrackingFailure);
      }
    } catch (err: any) {
      if (runId) {
        await finishComparisonRun({
          runId,
          status: 'failed',
          errorMessage: err.message || t('error.generic'),
        }).catch(warnTrackingFailure);
      }
      setError(err.message || t('error.generic'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen font-sans selection:bg-indigo-500/30 selection:text-indigo-200 relative">
      <div className="fixed top-4 right-4 z-50 flex gap-1 bg-white/5 backdrop-blur-md rounded-full p-1 border border-white/10">
        <button
          onClick={() => switchLanguage('en')}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${i18nInstance.language === 'en' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-white'}`}
        >
          EN
        </button>
        <button
          onClick={() => switchLanguage('zh-CN')}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${i18nInstance.language === 'zh-CN' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-white'}`}
        >
          简体
        </button>
        <button
          onClick={() => switchLanguage('zh-TW')}
          className={`px-3 py-1 rounded-full text-sm font-medium transition-all ${i18nInstance.language === 'zh-TW' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-white'}`}
        >
          繁体
        </button>
      </div>
      <MinimalGrid />
      {/* Header / Hero */}
      <header className="pt-20 pb-16 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto text-center relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight mb-6">
            <BlurText
              duration={1.6}
              initialBlur={14}
              staggerDelay={0.08}
              className="font-display"
              gradientColors={['#667eea', '#764ba2', '#f093fb']}
              gradientAnimationSpeed={8}
            >
              CompareAI
            </BlurText>
          </h1>
          <p className="text-lg sm:text-xl text-neutral-400 max-w-2xl mx-auto mb-10">
            {t('hero.subtitle')}
          </p>

          <form onSubmit={handleCompare} className="max-w-3xl mx-auto relative">
            <div className="flex flex-col sm:flex-row items-center gap-4 bg-white/5 backdrop-blur-xl p-2 rounded-3xl shadow-2xl border border-white/10">
              <div className="flex-1 w-full relative">
                <input
                  type="text"
                  value={itemA}
                  onChange={(e) => setItemA(e.target.value)}
                  placeholder={t('hero.placeholderA')}
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="words"
                  className="w-full px-6 py-4 bg-transparent outline-none text-base sm:text-lg font-medium text-white placeholder:text-neutral-500"
                  required
                />
              </div>
              <div className="hidden sm:flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-neutral-400 shrink-0 border border-white/5">
                <span className="text-sm font-bold font-mono">VS</span>
              </div>
              <div className="flex-1 w-full relative border-t-2 sm:border-t-0 sm:border-l-2 border-white/20">
                <input
                  type="text"
                  value={itemB}
                  onChange={(e) => setItemB(e.target.value)}
                  placeholder={t('hero.placeholderB')}
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="words"
                  className="w-full px-6 py-4 bg-transparent outline-none text-base sm:text-lg font-medium text-white placeholder:text-neutral-500"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading || !itemA.trim() || !itemB.trim()}
                className="w-full sm:w-auto px-8 py-4 min-h-[44px] bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25"
              >
                {loading ? (
                  <Loader2 className="animate-spin" size={20} />
                ) : (
                  <>
                    <span>{t('hero.compareBtn')}</span>
                    <Search size={18} />
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </header>

      {/* Main Content Area */}
      <main className="px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto pb-24 relative z-10">
        <AnimatePresence>
          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-red-500/10 text-red-400 p-4 rounded-2xl mb-8 flex items-start gap-3 border border-red-500/20 backdrop-blur-md"
            >
              <AlertCircle className="shrink-0 mt-0.5" size={20} />
              <p>{error}</p>
            </motion.div>
          )}

          {loading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <AILoadingState itemA={itemA} itemB={itemB} stepDescription={loadingStep} />
            </motion.div>
          )}

          {(result || showPartial) && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="space-y-12"
            >
              {/* 1. Verdict & Relationship */}
              <section className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 sm:p-10 shadow-2xl border border-white/10">
                <div className="text-center mb-8">
                  {(result || partialResult).recommendation?.short_verdict && (
                    <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
                      {(result || partialResult).recommendation?.short_verdict}
                    </h2>
                  )}
                  {(result || partialResult).recommendation?.long_verdict && (
                    <p className="text-lg text-neutral-300 max-w-3xl mx-auto leading-relaxed">
                      {(result || partialResult).recommendation?.long_verdict}
                    </p>
                  )}
                </div>

                <div className="grid md:grid-cols-2 gap-6 pt-8 border-t border-white/10">
                  <div className="bg-white/5 rounded-2xl p-6 border border-white/5">
                    <div className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3 font-mono">
                      <Info size={16} />
                      <span>{t('result.relationship')}</span>
                    </div>
                    {(result || partialResult).relationship?.relationship_type && (
                      <p className="text-white font-medium mb-2 capitalize">
                        {(result || partialResult).relationship?.relationship_type?.replace(/_/g, ' ')}
                      </p>
                    )}
                    {(result || partialResult).relationship?.reasoning && (
                      <p className="text-neutral-400 text-sm">
                        {(result || partialResult).relationship?.reasoning}
                      </p>
                    )}
                  </div>
                  <div className="bg-white/5 rounded-2xl p-6 border border-white/5">
                    <div className="flex items-center gap-2 text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3 font-mono">
                      <Search size={16} />
                      <span>{t('result.comparisonGoal')}</span>
                    </div>
                    {(result || partialResult).relationship?.comparison_goal && (
                      <p className="text-white font-medium mb-2">
                        {(result || partialResult).relationship?.comparison_goal}
                      </p>
                    )}
                    {(result || partialResult).relationship?.can_directly_compare === false &&
                      (result || partialResult).recommendation?.when_not_to_compare_directly && (
                        <p className="text-amber-400 text-sm mt-2 flex items-start gap-1.5">
                          <AlertCircle size={16} className="shrink-0 mt-0.5" />
                          <span>{(result || partialResult).recommendation?.when_not_to_compare_directly}</span>
                        </p>
                      )}
                  </div>
                </div>
              </section>

              {/* 2. Dimensions Comparison */}
              <section className="space-y-8">
                <h3 className="text-2xl font-bold text-white mb-6 px-2">{t('result.keyDimensions')}</h3>

                {((result || partialResult).dimensions?.length ?? 0) > 0 &&
                  (result || partialResult).entityA?.name &&
                  (result || partialResult).entityB?.name && (
                    <DimensionChart 
                      dimensions={(result || partialResult).dimensions as ComparisonResult['dimensions']} 
                      entityA={(result || partialResult).entityA?.name || ''} 
                      entityB={(result || partialResult).entityB?.name || ''} 
                    />
                  )}

                <ComparisonGrid>
                  {(result || partialResult).dimensions?.map((dim, idx) => {
                    const scoreA = dim.analysis?.optional_score_a;
                    const scoreB = dim.analysis?.optional_score_b;
                    const safeScoreA = isFiniteNumber(scoreA) ? scoreA : 0;
                    const safeScoreB = isFiniteNumber(scoreB) ? scoreB : 0;
                    const summary = buildDimensionSummary(dim as ComparisonResult['dimensions'][number]);

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
                              {(result || partialResult).entityA?.name && (
                                <p className="font-semibold text-white text-sm pr-2">
                                  {(result || partialResult).entityA?.name}
                                </p>
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
                              {(result || partialResult).entityB?.name && (
                                <p className="font-semibold text-white text-sm pr-2">
                                  {(result || partialResult).entityB?.name}
                                </p>
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
                                  ? (result || partialResult).entityA?.name || 'A'
                                  : dim.analysis.better_for === 'B'
                                  ? (result || partialResult).entityB?.name || 'B'
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
                  {(result || partialResult).entityA?.name && (
                    <h3 className="text-xl font-bold text-white mb-6 pb-4 border-b border-white/10">
                      {(result || partialResult).entityA?.name}
                    </h3>
                  )}
                  <div className="space-y-6">
                    {((result || partialResult).prosCons?.item_a_pros?.length ?? 0) > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2 font-mono">
                          <CheckCircle2 size={16} /> {t('result.pros')}
                        </h4>
                        <ul className="space-y-2 sm:space-y-1.5">
                          {(result || partialResult).prosCons?.item_a_pros?.map((pro, i) => (
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
                    {((result || partialResult).prosCons?.item_a_cons?.length ?? 0) > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-3 flex items-center gap-2 font-mono">
                          <XCircle size={16} /> {t('result.cons')}
                        </h4>
                        <ul className="space-y-2 sm:space-y-1.5">
                          {(result || partialResult).prosCons?.item_a_cons?.map((con, i) => (
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
                  {(result || partialResult).entityB?.name && (
                    <h3 className="text-xl font-bold text-white mb-6 pb-4 border-b border-white/10">
                      {(result || partialResult).entityB?.name}
                    </h3>
                  )}
                  <div className="space-y-6">
                    {((result || partialResult).prosCons?.item_b_pros?.length ?? 0) > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2 font-mono">
                          <CheckCircle2 size={16} /> {t('result.pros')}
                        </h4>
                        <ul className="space-y-2 sm:space-y-1.5">
                          {(result || partialResult).prosCons?.item_b_pros?.map((pro, i) => (
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
                    {((result || partialResult).prosCons?.item_b_cons?.length ?? 0) > 0 && (
                      <div>
                        <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-3 flex items-center gap-2 font-mono">
                          <XCircle size={16} /> {t('result.cons')}
                        </h4>
                        <ul className="space-y-2 sm:space-y-1.5">
                          {(result || partialResult).prosCons?.item_b_cons?.map((con, i) => (
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
                    {(result || partialResult).entityA?.name && (
                      <h4 className="text-xl font-semibold text-indigo-300 mb-4">
                        {(result || partialResult).entityA?.name}
                      </h4>
                    )}
                    {((result || partialResult).recommendation?.best_for_a?.length ?? 0) > 0 && (
                      <ul className="space-y-3">
                        {(result || partialResult).recommendation?.best_for_a?.map((item, i) => (
                          <li key={i} className="flex items-start gap-3 text-neutral-300">
                            <ChevronRight size={18} className="text-indigo-400 shrink-0 mt-0.5" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    {(result || partialResult).entityB?.name && (
                      <h4 className="text-xl font-semibold text-indigo-300 mb-4">
                        {(result || partialResult).entityB?.name}
                      </h4>
                    )}
                    {((result || partialResult).recommendation?.best_for_b?.length ?? 0) > 0 && (
                      <ul className="space-y-3">
                        {(result || partialResult).recommendation?.best_for_b?.map((item, i) => (
                          <li key={i} className="flex items-start gap-3 text-neutral-300">
                            <ChevronRight size={18} className="text-indigo-400 shrink-0 mt-0.5" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                
                {(result || partialResult).recommendation?.which_to_choose_first && (
                  <div className="mt-10 pt-8 border-t border-indigo-500/20 text-center">
                    <p className="text-indigo-300/60 text-xs uppercase tracking-widest font-bold mb-2 font-mono">{t('result.defaultChoice')}</p>
                    <p className="text-xl font-medium text-white">
                      {(result || partialResult).recommendation?.which_to_choose_first}
                    </p>
                  </div>
                )}
              </section>

              {/* 5. Share Section */}
              <section className="flex flex-col items-center gap-4 py-8">
                <div className="text-center mb-2">
                  <h3 className="text-xl font-bold text-white mb-2">分享你的对比结果</h3>
                  <p className="text-sm text-neutral-400">生成精美海报，分享到小红书</p>
                </div>
                <ShareButton result={(result || partialResult) as ComparisonResult} />
              </section>

            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
