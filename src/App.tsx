import React, { Suspense, useEffect, useRef, useState } from 'react';
import { generateComparison, runFinalizeAgent, ComparisonResult } from './services/geminiService';
import { generateViaServer, getMyActivity, ServerGenerationUnavailableError } from './services/serverGenerationService';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Loader2, AlertCircle, History } from 'lucide-react';
import { AILoadingState } from './components/AILoadingState';

import FeaturedShowcase from './components/FeaturedShowcase';
import { finishComparisonRun, startComparisonRun } from './services/trackingService';
import { saveReport, type SaveReportInput } from './services/reportService';
import MinimalGrid from './components/react-bits/MinimalGrid';
import BlurText from './components/react-bits/BlurText';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';

const MAX_ITEM_LENGTH = 120;
const PREFILL_STORAGE_KEY = 'compareai.prefill';
const PREFILL_MAX_AGE_MS = 30_000;

type PartialComparisonResult = Partial<ComparisonResult> & { dimensions?: ComparisonResult['dimensions'] };
type ReportSaveStatus = 'ready' | 'saving' | 'error';
type ReportPayload = Omit<SaveReportInput, 'signal'>;
// Lazy-load the heavy result view (recharts/poster/export) only when a result exists.
const ComparisonResultView = React.lazy(() => import('./components/ComparisonResultView'));

type CompatibleResultViewProps = React.ComponentProps<typeof ComparisonResultView> & {
  reportStatus?: ReportSaveStatus;
  onRetrySave?: () => void;
};

// These optional props are ignored by the current view and can be consumed by a view with richer share UX.
const CompatibleComparisonResultView = ComparisonResultView as React.ComponentType<CompatibleResultViewProps>;

const warnTrackingFailure = (error: unknown) => {
  if (error instanceof Error && error.name === 'AbortError') return;
  console.warn('Comparison tracking failed:', error);
};

const normalizeItem = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/**
 * Reads and clears the one-shot handoff written by the report page's inline compare box.
 * Only sessionStorage can request an autostart — never a URL param — so a crawler
 * following a link can never trigger a paid generation.
 */
const consumePrefillHandoff = (): { itemA: string; itemB: string; autostart: boolean } | null => {
  try {
    const raw = window.sessionStorage.getItem(PREFILL_STORAGE_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(PREFILL_STORAGE_KEY);

    const parsed = JSON.parse(raw) as { itemA?: unknown; itemB?: unknown; autostart?: unknown; ts?: unknown };
    const nextA = typeof parsed.itemA === 'string' ? parsed.itemA.trim() : '';
    const nextB = typeof parsed.itemB === 'string' ? parsed.itemB.trim() : '';
    const ts = typeof parsed.ts === 'number' ? parsed.ts : 0;
    const age = Date.now() - ts;
    if (!nextA || !nextB || age < 0 || age > PREFILL_MAX_AGE_MS) return null;

    return { itemA: nextA, itemB: nextB, autostart: parsed.autostart === true };
  } catch {
    return null;
  }
};

/** Maps known server error messages to localized strings; unknown messages pass through. */
const localizeServerError = (message: string): string => {
  if (!message) return i18n.t('error.generic');
  const lower = message.toLowerCase();
  if (lower.includes('rate limit')) return i18n.t('error.rateLimited');
  if (lower.includes('daily ai request budget')) return i18n.t('error.budgetExceeded');
  if (lower.includes('ai service is busy')) return i18n.t('error.serviceBusy');
  return message;
};

export default function App() {
  const { t, i18n: i18nInstance } = useTranslation();
  const [itemA, setItemA] = useState('');
  const [itemB, setItemB] = useState('');
  const [submittedItems, setSubmittedItems] = useState({ itemA: '', itemB: '' });
  const [submittedLanguage, setSubmittedLanguage] = useState<string>('en');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<{ key: string; count?: number } | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [partialResult, setPartialResult] = useState<PartialComparisonResult>({});
  const [error, setError] = useState('');
  const [validationError, setValidationError] = useState('');
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [reportSaveStatus, setReportSaveStatus] = useState<ReportSaveStatus>('ready');

  const formRef = useRef<HTMLFormElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const resultFocusRef = useRef<HTMLDivElement>(null);
  const errorFocusRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const pendingAutostartRef = useRef(false);
  const generationRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveAttemptRef = useRef(0);
  const retryReportRef = useRef<{ generation: number; payload: ReportPayload; signal: AbortSignal } | null>(null);

  useEffect(() => () => {
    generationRef.current += 1;
    inFlightRef.current = false;
    abortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (loading) return;
    const target = error ? errorFocusRef.current : result ? resultFocusRef.current : null;
    if (target) window.requestAnimationFrame(() => target.focus());
  }, [error, loading, result]);

  // Prefill (and optionally autostart) from the report page's inline compare box.
  useEffect(() => {
    const prefill = consumePrefillHandoff();
    if (!prefill) return;
    setItemA(prefill.itemA);
    setItemB(prefill.itemB);
    pendingAutostartRef.current = prefill.autostart;
  }, []);

  // Autostart only once both values are committed to the DOM: requestSubmit runs
  // native validation, and the required inputs would still be empty on a timer.
  useEffect(() => {
    if (!pendingAutostartRef.current || !itemA.trim() || !itemB.trim()) return;
    pendingAutostartRef.current = false;
    formRef.current?.requestSubmit();
  }, [itemA, itemB]);

  // Reattach to a comparison that is still generating server-side — e.g. the
  // user closed the tab or locked their phone mid-run and came back.
  useEffect(() => {
    const lookupController = new AbortController();
    void (async () => {
      try {
        const activity = await getMyActivity(lookupController.signal);
        const active = activity.activeRuns[0];
        if (!active || inFlightRef.current || lookupController.signal.aborted) return;

        inFlightRef.current = true;
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        const isCurrent = () => generationRef.current === generation;

        setItemA(active.itemA);
        setItemB(active.itemB);
        setSubmittedItems({ itemA: active.itemA, itemB: active.itemB });
        setLoading(true);
        setPartialResult({});
        setError('');
        setResult(null);
        setReportUrl(null);
        setLoadingStep({ key: 'loading.initializing' });

        try {
          const outcome = await generateViaServer(active.runId, {
            skipStart: true,
            bailOnUnknown: true,
            onProgress: (progress) => {
              if (isCurrent()) setLoadingStep({ key: `loading.${progress.key}`, count: progress.count });
            },
            onPhaseComplete: (phase, data) => {
              if (!isCurrent()) return;
              setPartialResult((previous) => (phase === 'dimension'
                ? { ...previous, dimensions: [...(previous.dimensions || []), data] }
                : { ...previous, ...data }));
            },
            signal: controller.signal,
          });
          if (!isCurrent()) return;
          setResult(outcome.result);
          setReportUrl(outcome.reportUrl || (outcome.reportId ? `/r/${outcome.reportId}` : null));
          setReportSaveStatus('ready');
        } catch (resumeError) {
          if (!isCurrent()) return;
          if (resumeError instanceof Error && resumeError.name === 'AbortError') return;
          if (resumeError instanceof ServerGenerationUnavailableError) return;
          setError(localizeServerError(resumeError instanceof Error ? resumeError.message : ''));
        } finally {
          if (isCurrent()) {
            setLoading(false);
            inFlightRef.current = false;
          }
        }
      } catch {
        // Activity lookup is best-effort; the homepage works without it.
      }
    })();
    return () => lookupController.abort();
  }, []);

  const persistReport = async (
    generation: number,
    payload: ReportPayload,
    signal: AbortSignal,
    refreshToken = false,
  ) => {
    if (generationRef.current !== generation) return;
    const attempt = ++saveAttemptRef.current;
    setReportSaveStatus('saving');

    try {
      let effectivePayload = payload;
      // Mint (or refresh, on retry/expiry) the short-lived persistence grant.
      if (refreshToken || !payload.result.reportToken) {
        const { reportToken } = await runFinalizeAgent(
          payload.result,
          payload.language,
          payload.runId,
          signal,
        );
        effectivePayload = {
          ...payload,
          result: { ...payload.result, reportToken },
        };
      }
      const saved = await saveReport({ ...effectivePayload, signal });
      if (!saved.url) throw new Error('Report response did not include a URL');
      if (generationRef.current !== generation || saveAttemptRef.current !== attempt) return;
      setReportUrl(saved.url);
      setReportSaveStatus('ready');
    } catch (saveError) {
      if (generationRef.current !== generation || saveAttemptRef.current !== attempt) return;
      if (saveError instanceof Error && saveError.name === 'AbortError') return;
      setReportSaveStatus('error');
    }
  };

  const retryReportSave = () => {
    const retry = retryReportRef.current;
    if (!retry || retry.generation !== generationRef.current || reportSaveStatus === 'saving') return;
    void persistReport(retry.generation, retry.payload, retry.signal, true);
  };

  const handleShowcaseSelect = (a: string, b: string) => {
    if (inFlightRef.current) return;
    setItemA(a);
    setItemB(b);
    setValidationError('');
    // Submit after React applies both selected values. The synchronous ref still rejects duplicates.
    window.setTimeout(() => formRef.current?.requestSubmit(), 0);
  };

  const handleCompare = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlightRef.current) return;

    const itemASnapshot = itemA.trim();
    const itemBSnapshot = itemB.trim();
    const languageSnapshot = i18nInstance.language || 'en';
    setSubmittedLanguage(languageSnapshot);

    if (!itemASnapshot || !itemBSnapshot) {
      setValidationError(t('error.itemsRequired', { defaultValue: 'Enter both items to compare.' }));
      firstInputRef.current?.focus();
      return;
    }
    if (itemASnapshot.length > MAX_ITEM_LENGTH || itemBSnapshot.length > MAX_ITEM_LENGTH) {
      setValidationError(t('error.itemTooLong', {
        defaultValue: `Each item must be ${MAX_ITEM_LENGTH} characters or fewer.`,
        count: MAX_ITEM_LENGTH,
      }));
      firstInputRef.current?.focus();
      return;
    }
    if (normalizeItem(itemASnapshot) === normalizeItem(itemBSnapshot)) {
      setValidationError(t('error.itemsMustDiffer', { defaultValue: 'Choose two different items to compare.' }));
      firstInputRef.current?.focus();
      return;
    }

    // This lock is set before the first await so submit/requestSubmit cannot start a second pipeline.
    inFlightRef.current = true;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    saveAttemptRef.current += 1;
    retryReportRef.current = null;

    setSubmittedItems({ itemA: itemASnapshot, itemB: itemBSnapshot });
    setLoading(true);
    setPartialResult({});
    setValidationError('');
    setError('');
    setResult(null);
    setReportUrl(null);
    setReportSaveStatus('ready');
    setLoadingStep({ key: 'loading.initializing' });

    let runId: string | undefined;
    const isCurrentGeneration = () => generationRef.current === generation;

    try {
      const run = await startComparisonRun({
        itemA: itemASnapshot,
        itemB: itemBSnapshot,
        language: languageSnapshot,
        signal: controller.signal,
      }).catch((trackingError) => {
        if (isCurrentGeneration()) warnTrackingFailure(trackingError);
        return null;
      });
      if (!isCurrentGeneration()) return;
      runId = run?.runId;

      const handleProgress = (progress: { key: string; count?: number }) => {
        if (!isCurrentGeneration()) return;
        setLoadingStep({ key: `loading.${progress.key}`, count: progress.count });
      };
      const handlePhaseComplete = (phase: string, data: any) => {
        if (!isCurrentGeneration()) return;
        setPartialResult((previous) => {
          if (!isCurrentGeneration()) return previous;
          if (phase === 'dimension') {
            return {
              ...previous,
              dimensions: [...(previous.dimensions || []), data],
            };
          }
          return { ...previous, ...data };
        });
      };

      // Prefer server-side generation: it survives tab closes and locked
      // phones. Fall back to the in-browser pipeline when it cannot start.
      let comparison: ComparisonResult;
      let serverReportUrl: string | null = null;
      let usedServerRun = false;
      if (runId) {
        try {
          const serverOutcome = await generateViaServer(runId, {
            onProgress: handleProgress,
            onPhaseComplete: handlePhaseComplete,
            signal: controller.signal,
          });
          comparison = serverOutcome.result;
          serverReportUrl = serverOutcome.reportUrl
            || (serverOutcome.reportId ? `/r/${serverOutcome.reportId}` : null);
          usedServerRun = true;
        } catch (serverError) {
          if (!(serverError instanceof ServerGenerationUnavailableError)) throw serverError;
          setPartialResult({});
          comparison = await generateComparison(
            itemASnapshot,
            itemBSnapshot,
            handleProgress,
            handlePhaseComplete,
            languageSnapshot,
            runId,
            controller.signal,
          );
        }
      } else {
        comparison = await generateComparison(
          itemASnapshot,
          itemBSnapshot,
          handleProgress,
          handlePhaseComplete,
          languageSnapshot,
          runId,
          controller.signal,
        );
      }
      if (!isCurrentGeneration()) return;
      setResult(comparison);

      if (usedServerRun) {
        // The server already finished the run and saved the report.
        setReportUrl(serverReportUrl);
        setReportSaveStatus('ready');
        return;
      }

      if (runId) {
        void finishComparisonRun({
          runId,
          status: 'completed',
          signal: controller.signal,
        }).catch((trackingError) => {
          if (isCurrentGeneration()) warnTrackingFailure(trackingError);
        });
      }

      // Saving is independent from tracking and also runs when startComparisonRun failed.
      const reportPayload: ReportPayload = {
        runId,
        itemA: itemASnapshot,
        itemB: itemBSnapshot,
        language: languageSnapshot,
        result: comparison,
      };
      retryReportRef.current = { generation, payload: reportPayload, signal: controller.signal };
      void persistReport(generation, reportPayload, controller.signal);
    } catch (comparisonError) {
      if (!isCurrentGeneration()) return;
      const message = comparisonError instanceof Error
        ? comparisonError.message
        : t('error.generic');

      if (runId) {
        void finishComparisonRun({
          runId,
          status: 'failed',
          errorMessage: message,
          signal: controller.signal,
        }).catch((trackingError) => {
          if (isCurrentGeneration()) warnTrackingFailure(trackingError);
        });
      }
      if (isCurrentGeneration()) setError(localizeServerError(message));
    } finally {
      if (isCurrentGeneration()) {
        setLoading(false);
        inFlightRef.current = false;
      }
    }
  };

  const partialDimensionCount = partialResult.dimensions?.length || 0;
  const hasPartialData = Boolean(
    partialResult.entityA ||
    partialResult.entityB ||
    partialResult.relationship ||
    partialDimensionCount ||
    partialResult.prosCons ||
    partialResult.recommendation,
  );

  return (
    <div className="min-h-screen font-sans selection:bg-indigo-500/30 selection:text-indigo-200 relative">
      <div className="fixed top-4 left-4 z-50">
        <a
          href="/my-reports"
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 backdrop-blur-md border border-white/10 text-sm text-neutral-400 hover:text-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <History size={16} />
          {t('nav.myReports')}
        </a>
      </div>
      <MinimalGrid />
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
                <label htmlFor="comparison-item-a" className="sr-only">
                  {t('loading.itemA')}
                </label>
                <input
                  ref={firstInputRef}
                  id="comparison-item-a"
                  type="text"
                  value={itemA}
                  onChange={(e) => {
                    setItemA(e.target.value);
                    setValidationError('');
                  }}
                  placeholder={t('hero.placeholderA')}
                  aria-label={t('loading.itemA')}
                  aria-describedby={`comparison-input-hint${validationError ? ' comparison-validation-error' : ''}`}
                  aria-invalid={Boolean(validationError)}
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="words"
                  maxLength={MAX_ITEM_LENGTH}
                  disabled={loading}
                  className="w-full px-6 py-4 bg-transparent outline-none text-base sm:text-lg font-medium text-white placeholder:text-neutral-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                  required
                />
              </div>
              <div className="hidden sm:flex items-center justify-center w-10 h-10 rounded-full bg-white/10 text-neutral-400 shrink-0 border border-white/5">
                <span className="text-sm font-bold font-mono">VS</span>
              </div>
              <div className="flex-1 w-full relative border-t-2 sm:border-t-0 sm:border-l-2 border-white/20">
                <label htmlFor="comparison-item-b" className="sr-only">
                  {t('loading.itemB')}
                </label>
                <input
                  id="comparison-item-b"
                  type="text"
                  value={itemB}
                  onChange={(e) => {
                    setItemB(e.target.value);
                    setValidationError('');
                  }}
                  placeholder={t('hero.placeholderB')}
                  aria-label={t('loading.itemB')}
                  aria-describedby={`comparison-input-hint${validationError ? ' comparison-validation-error' : ''}`}
                  aria-invalid={Boolean(validationError)}
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="words"
                  maxLength={MAX_ITEM_LENGTH}
                  disabled={loading}
                  className="w-full px-6 py-4 bg-transparent outline-none text-base sm:text-lg font-medium text-white placeholder:text-neutral-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading || !itemA.trim() || !itemB.trim()}
                aria-label={loading ? t('hero.comparing') : t('hero.compareBtn')}
                aria-busy={loading}
                className="w-full sm:w-auto px-8 py-4 min-h-[44px] bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" size={20} aria-hidden="true" />
                    <span>{t('hero.comparing')}</span>
                  </>
                ) : (
                  <>
                    <span>{t('hero.compareBtn')}</span>
                    <Search size={18} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
            <p id="comparison-input-hint" className="mt-3 text-left text-xs text-neutral-500">
              {t('hero.inputLimit', {
                defaultValue: 'Use two different items, up to {{count}} characters each.',
                count: MAX_ITEM_LENGTH,
              })}
            </p>
            {validationError && (
              <p
                id="comparison-validation-error"
                role="alert"
                className="mt-3 text-left text-sm text-rose-400"
              >
                {validationError}
              </p>
            )}
          </form>
        </motion.div>
      </header>

      <main className="px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto pb-24 relative z-10">
        <AnimatePresence>
          {error && (
            <motion.div
              ref={errorFocusRef}
              tabIndex={-1}
              role="alert"
              aria-live="assertive"
              key="error"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-red-500/10 text-red-400 p-4 rounded-2xl mb-8 flex items-start gap-3 border border-red-500/20 backdrop-blur-md focus:outline-none"
            >
              <AlertCircle className="shrink-0 mt-0.5" size={20} aria-hidden="true" />
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
              <AILoadingState
                itemA={submittedItems.itemA}
                itemB={submittedItems.itemB}
                stepDescription={loadingStep ? t(loadingStep.key, { count: loadingStep.count }) : undefined}
              />
            </motion.div>
          )}

          {hasPartialData && !result && (
            <motion.section
              key="partial"
              aria-live="polite"
              aria-label={t('loading.partialResults', { defaultValue: 'Comparison progress' })}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-8 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-5 text-sm text-neutral-300"
            >
              <p className="font-semibold text-indigo-200">
                {error
                  ? t('error.partialAvailable', { defaultValue: 'The comparison stopped, but partial findings are available.' })
                  : t('loading.partialAvailable', { defaultValue: 'Partial findings are ready while analysis continues.' })}
              </p>
              {(partialResult.entityA?.name || partialResult.entityB?.name) && (
                <p className="mt-2">
                  {[partialResult.entityA?.name, partialResult.entityB?.name].filter(Boolean).join(' vs ')}
                </p>
              )}
              {partialResult.relationship?.reasoning && (
                <p className="mt-2">{partialResult.relationship.reasoning}</p>
              )}
              {partialDimensionCount > 0 && (
                <p className="mt-2">
                  {t('loading.dimensionsComplete', {
                    defaultValue: '{{count}} dimension(s) analyzed.',
                    count: partialDimensionCount,
                  })}
                </p>
              )}
              {partialResult.recommendation?.short_verdict && (
                <p className="mt-2 font-medium text-white">{partialResult.recommendation.short_verdict}</p>
              )}
            </motion.section>
          )}

          {result && !loading && (
            <motion.div
              ref={resultFocusRef}
              tabIndex={-1}
              key="result"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="focus:outline-none"
            >
              <Suspense fallback={
                <div className="flex justify-center py-16" role="status" aria-busy="true">
                  <Loader2 className="animate-spin text-indigo-400" size={28} />
                </div>
              }>
                <CompatibleComparisonResultView
                  result={result}
                  reportUrl={reportUrl}
                  reportStatus={reportSaveStatus}
                  onRetrySave={retryReportSave}
                  showShare={true}
                  language={submittedLanguage}
                />
              </Suspense>
              {reportUrl && (
                <p className="mt-6 text-center text-sm text-neutral-500">
                  {t('result.savedHint')}{' '}
                  <a
                    href="/my-reports"
                    className="text-indigo-300 underline underline-offset-4 transition-colors hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    {t('nav.myReports')}
                  </a>
                </p>
              )}
            </motion.div>
          )}

          {!loading && !result && !hasPartialData && !error && (
            <motion.div
              key="discovery"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.45 }}
            >
              <FeaturedShowcase onSelect={handleShowcaseSelect} />
              <div className="mt-8 flex justify-center">
                <a
                  href="/popular-ai-comparisons"
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 text-sm font-semibold text-indigo-300 transition-colors hover:border-indigo-500/40 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  {t('hero.popularLink')}
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="relative z-10 border-t border-white/10 mt-16 py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <nav aria-label={t('nav.footerLabel')} className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
            <a href="/about" className="text-neutral-400 hover:text-indigo-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">{t('nav.about')}</a>
            <a href="/methodology" className="text-neutral-400 hover:text-indigo-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">{t('nav.methodology')}</a>
            <a href="/popular-ai-comparisons" className="text-neutral-400 hover:text-indigo-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">{t('nav.popularComparisons')}</a>
            <a href="/my-reports" className="text-neutral-400 hover:text-indigo-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">{t('nav.myReports')}</a>
            <a href="/privacy" className="text-neutral-400 hover:text-indigo-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">{t('nav.privacy')}</a>
            <a href="/terms" className="text-neutral-400 hover:text-indigo-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">{t('nav.terms')}</a>
          </nav>
          <p className="mt-4 text-center text-xs text-neutral-500">&copy; {new Date().getFullYear()} CompareAI</p>
        </div>
      </footer>
    </div>
  );
}
