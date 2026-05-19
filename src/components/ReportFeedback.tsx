import { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FeedbackStats {
  helpful: number;
  total: number;
}

export default function ReportFeedback({ reportId }: { reportId: string }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [voted, setVoted] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const storageKey = `feedback:${reportId}`;

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) setVoted(stored === 'true');

    fetch(`/api/reports/${reportId}/feedback`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, [reportId, storageKey]);

  const submit = async (helpful: boolean) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpful }),
      });
      if (res.ok) {
        const updated = await res.json();
        setStats(updated);
        setVoted(helpful);
        localStorage.setItem(storageKey, String(helpful));
      }
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
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
          onClick={() => submit(true)}
          disabled={voted !== null || submitting}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
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
          onClick={() => submit(false)}
          disabled={voted !== null || submitting}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
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
      {voted !== null && (
        <p className="text-xs text-neutral-500">{t('feedback.thanks')}</p>
      )}
      {pct !== null && (
        <p className="text-xs text-neutral-500 mt-1">
          {t('feedback.stats', { pct, total: stats!.total })}
        </p>
      )}
    </div>
  );
}
