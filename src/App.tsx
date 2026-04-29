import React, { useState, useEffect, useRef } from 'react';
import { generateComparison, ComparisonResult } from './services/geminiService';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import { AILoadingState } from './components/AILoadingState';
import ComparisonResultView from './components/ComparisonResultView';
import ComparisonSuggestions, { saveRecentComparison } from './components/ComparisonSuggestions';
import { finishComparisonRun, startComparisonRun } from './services/trackingService';
import { saveReport } from './services/reportService';
import MinimalGrid from './components/react-bits/MinimalGrid';
import BlurText from './components/react-bits/BlurText';
import { useTranslation } from 'react-i18next';
import { switchLanguage } from './i18n';

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
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSuggestionSelect = (a: string, b: string) => {
    setItemA(a);
    setItemB(b);
    setShowSuggestions(false);
  };

  const handleCompare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemA.trim() || !itemB.trim()) return;

    const currentLanguage = i18nInstance.language || 'en';

    setLoading(true);
    setShowPartial(false);
    setPartialResult({});
    setError('');
    setResult(null);
    setReportUrl(null);
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
      saveRecentComparison(itemA, itemB);

      // Fire-and-forget: track completion + save report in parallel
      if (runId) {
        Promise.allSettled([
          finishComparisonRun({ runId, status: 'completed' }),
          saveReport({ runId, itemA, itemB, language: currentLanguage, result: res }),
        ]).then(([, reportResult]) => {
          if (reportResult.status === 'fulfilled') {
            setReportUrl(reportResult.value.url);
          }
        }).catch(warnTrackingFailure);
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

  const displayResult = result || (showPartial ? partialResult as Partial<ComparisonResult> & { dimensions?: any[] } : null);

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

          <form ref={formRef} onSubmit={handleCompare} className="max-w-3xl mx-auto relative">
            <div className="flex flex-col sm:flex-row items-center gap-4 bg-white/5 backdrop-blur-xl p-2 rounded-3xl shadow-2xl border border-white/10">
              <div className="flex-1 w-full relative">
                <input
                  type="text"
                  value={itemA}
                  onChange={(e) => setItemA(e.target.value)}
                  onFocus={() => setShowSuggestions(true)}
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
                  onFocus={() => setShowSuggestions(true)}
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
            <ComparisonSuggestions
              onSelect={handleSuggestionSelect}
              visible={showSuggestions && !loading && !result}
            />
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

          {displayResult && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <ComparisonResultView
                result={displayResult as ComparisonResult}
                reportUrl={reportUrl}
                showShare={!!result}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
