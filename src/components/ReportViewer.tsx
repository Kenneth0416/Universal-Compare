import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import ComparisonResultView from './ComparisonResultView';
import MinimalGrid from './react-bits/MinimalGrid';
import { getReport, getReportBySlug, type ReportData } from '../services/reportService';
import type { ComparisonResult } from '../services/geminiService';

export default function ReportViewer() {
  const pathname = window.location.pathname;
  const isCompareUrl = pathname.startsWith('/compare/');
  const reportKey = pathname.replace(isCompareUrl ? '/compare/' : '/r/', '');
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!reportKey) {
      setError('Invalid report URL');
      setLoading(false);
      return;
    }

    const loadReport = isCompareUrl ? getReportBySlug : getReport;

    loadReport(reportKey)
      .then((data) => {
        setReport(data);
        document.title = `${data.itemA} vs ${data.itemB} — CompareAI`;
      })
      .catch((err) => {
        setError(err.message === 'Report not found'
          ? 'Report not found. It may have been deleted.'
          : 'Failed to load report. Please try again.');
      })
      .finally(() => setLoading(false));
  }, [isCompareUrl, reportKey]);

  return (
    <div className="min-h-screen font-sans selection:bg-indigo-500/30 selection:text-indigo-200 relative">
      {/* Back to Home */}
      <div className="fixed top-4 left-4 z-50">
        <a
          href="/"
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 backdrop-blur-md border border-white/10 text-sm text-neutral-400 hover:text-white transition-all"
        >
          <ArrowLeft size={16} />
          Home
        </a>
      </div>

      <MinimalGrid />

      <main className="pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto relative z-10">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-4 py-32">
            <Loader2 className="animate-spin text-indigo-400" size={32} />
            <p className="text-neutral-400">Loading report...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center gap-4 py-32">
            <div className="bg-red-500/10 text-red-400 p-6 rounded-2xl flex flex-col items-center gap-3 border border-red-500/20 backdrop-blur-md max-w-md text-center">
              <AlertCircle size={24} />
              <p className="font-medium">{error}</p>
              <a href="/" className="text-sm text-indigo-400 hover:text-indigo-300 underline underline-offset-4">
                Go back to CompareAI
              </a>
            </div>
          </div>
        )}

        {report && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* Report Header */}
            <div className="text-center mb-12">
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
                {report.itemA} <span className="text-indigo-400">vs</span> {report.itemB}
              </h1>
              <p className="text-sm text-neutral-500 font-mono">
                Report #{report.reportId} • {new Date(report.createdAt).toLocaleDateString()} • {report.viewCount} views
              </p>
            </div>

            <ComparisonResultView
              result={report.result as ComparisonResult}
              showShare={true}
            />
          </motion.div>
        )}
      </main>
    </div>
  );
}
