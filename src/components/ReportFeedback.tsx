import { useState, useEffect, useRef } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FeedbackStats {
  helpful: number;
  total: number;
}

const readStoredVote = (key: string): boolean | null => {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? null : stored === 'true';
  } catch {
    return null;
  }
};

const storeVote = (key: string, helpful: boolean) => {
  try {
    window.localStorage.setItem(key, String(helpful));
  } catch {
    // Feedback still succeeds when storage is unavailable.
  }
};

export default function ReportFeedback({ reportId }: { reportId: string }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [voted, setVoted] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [failedVote, setFailedVote] = useState<boolean | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const generationRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const submitControllerRef = useRef<AbortController | null>(null);

  const storageKey = `feedback:${reportId}`;

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    submitControllerRef.current?.abort();
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    let active = true;

    setVoted(readStoredVote(storageKey));
    setStats(null);
    setSubmitting(false);
    setError('');
    setFailedVote(null);

    fetch(`/api/reports/${encodeURIComponent(reportId)}/feedback`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load feedback: ${response.status}`);
        return response.json() as Promise<FeedbackStats>;
      })
      .then((nextStats) => {
        if (active) setStats(nextStats);
      })
      .catch((fetchError) => {
        if (active && fetchError instanceof Error && fetchError.name !== 'AbortError') {
          setError(t('feedback.loadFailed', { defaultValue: 'Could not load feedback totals.' }));
        }
      });

    return () => {
      active = false;
      controller.abort();
      if (loadControllerRef.current === controller) loadControllerRef.current = null;
    };
  }, [loadAttempt, reportId, storageKey, t]);

  useEffect(() => () => {
    loadControllerRef.current?.abort();
    submitControllerRef.current?.abort();
  }, []);

  const submit = async (helpful: boolean) => {
    if (submitting || voted !== null) return;
    const generation = generationRef.current;
    // A successful vote is authoritative; prevent an older totals request from
    // overwriting the POST response or surfacing a stale load error afterwards.
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
    submitControllerRef.current?.abort();
    const controller = new AbortController();
    submitControllerRef.current = controller;
    setSubmitting(true);
    setError('');
    setFailedVote(null);

    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Failed to submit feedback: ${res.status}`);

      const updated = await res.json() as FeedbackStats;
      if (generationRef.current !== generation) return;
      setStats(updated);
      setVoted(helpful);
      storeVote(storageKey, helpful);
    } catch (submitError) {
      if (generationRef.current !== generation) return;
      if (submitError instanceof Error && submitError.name === 'AbortError') return;
      setFailedVote(helpful);
      setError(t('feedback.submitFailed', { defaultValue: 'Could not send your feedback. Please try again.' }));
    } finally {
      if (generationRef.current === generation) setSubmitting(false);
    }
  };

  const pct = stats && stats.total >= 5
    ? Math.round((stats.helpful / stats.total) * 100)
    : null;

  return (
    <div className="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10 text-center">
      <p className="text-sm text-neutral-300 mb-3">{t('feedback.question')}</p>
      <div className="flex justify-center gap-3 mb-3">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={voted !== null || submitting}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
            voted === true
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : voted !== null
                ? 'bg-white/5 text-neutral-500 cursor-not-allowed'
                : 'bg-white/10 text-white hover:bg-emerald-500/20 hover:text-emerald-400 border border-white/10'
          }`}
        >
          <ThumbsUp size={14} /> {t('feedback.yes')}
        </button>
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={voted !== null || submitting}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
            voted === false
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              : voted !== null
                ? 'bg-white/5 text-neutral-500 cursor-not-allowed'
                : 'bg-white/10 text-white hover:bg-rose-500/20 hover:text-rose-400 border border-white/10'
          }`}
        >
          <ThumbsDown size={14} /> {t('feedback.no')}
        </button>
      </div>
      <div aria-live="polite" role={error ? 'alert' : 'status'}>
        {submitting && (
          <p className="text-xs text-neutral-400">
            {t('feedback.submitting', { defaultValue: 'Sending feedback…' })}
          </p>
        )}
        {error && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs text-rose-400">{error}</p>
            <button
              type="button"
              onClick={() => {
                if (failedVote !== null) {
                  void submit(failedVote);
                } else {
                  setLoadAttempt((attempt) => attempt + 1);
                }
              }}
              disabled={submitting}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              {t('feedback.retry', { defaultValue: 'Retry' })}
            </button>
          </div>
        )}
        {voted !== null && (
          <p className="text-xs text-neutral-500">{t('feedback.thanks')}</p>
        )}
        {pct !== null && (
          <p className="text-xs text-neutral-500 mt-1">
            {t('feedback.stats', { pct, total: stats!.total })}
          </p>
        )}
      </div>
    </div>
  );
}
