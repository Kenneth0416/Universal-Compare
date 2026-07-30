import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, ChevronDown, Eye, FileArchive, Image as ImageIcon, Loader2, Share2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ComparisonResult } from '../services/geminiService';
import { PosterCover } from './poster/PosterCover';

export interface PosterExportOption {
  id: 'all' | 'cover' | 'cards' | 'link';
  label: string;
  sublabel: string;
  icon: LucideIcon;
  gradient: string;
  glowColor: string;
}

interface PosterExportDialogProps {
  open: boolean;
  result: ComparisonResult;
  language: string;
  shareUrl: string;
  options: PosterExportOption[];
  isGenerating: string | null;
  success: string | null;
  error: string | null;
  onClose: () => void;
  onCancel: () => void;
  onOption: (id: PosterExportOption['id']) => void;
  onNativeShare: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export default function PosterExportDialog({
  open,
  result,
  language,
  shareUrl,
  options,
  isGenerating,
  success,
  error,
  onClose,
  onCancel,
  onOption,
  onNativeShare,
  t,
}: PosterExportDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(false);
  const [showMobilePreview, setShowMobilePreview] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!open) {
      setShowMobilePreview(false);
      return;
    }

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (busyRef.current) onCancel();
        else onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  const primary = options.find((option) => option.id === 'all')!;
  const secondary = options.filter((option) => option.id !== 'all');
  const busy = isGenerating !== null;
  onCloseRef.current = onClose;
  busyRef.current = busy;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6"
          initial={prefersReducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReducedMotion ? undefined : { opacity: 0 }}
          transition={prefersReducedMotion ? { duration: 0 } : undefined}
        >
          <motion.button
            type="button"
            aria-label={t('share.close')}
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-md"
            onClick={() => busy ? onCancel() : onClose()}
          />

          <motion.section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-busy={busy}
            initial={prefersReducedMotion ? false : { y: 80, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={prefersReducedMotion ? undefined : { y: 80, opacity: 0, scale: 0.98 }}
            transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }}
            className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#0c0a18] shadow-[0_-20px_80px_rgba(0,0,0,0.55)] md:max-w-4xl md:rounded-[28px] md:shadow-2xl"
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20 md:hidden" />

            <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 pb-4 pt-4 md:px-6 md:py-5">
              <div className="min-w-0">
                <h2 id={titleId} className="text-lg font-bold text-white md:text-xl">{t('share.exportTitle')}</h2>
                <p className="mt-1 truncate text-xs text-white/45 md:text-sm">
                  {result.entityA.name} <span className="text-white/25">vs</span> {result.entityB.name}
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => busy ? onCancel() : onClose()}
                aria-label={busy ? t('share.cancel', { defaultValue: 'Cancel export' }) : t('share.close')}
                className="grid min-h-11 min-w-11 place-items-center rounded-full bg-white/5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={19} />
              </button>
            </header>

            <div className="min-h-0 overflow-y-auto overscroll-contain md:grid md:grid-cols-[360px_minmax(0,1fr)] md:overflow-hidden">
              <aside className="hidden items-center justify-center border-r border-white/10 bg-gradient-to-br from-indigo-950/35 via-purple-950/20 to-transparent p-6 md:flex">
                <div>
                  <div className="mb-3 flex items-center justify-between text-xs text-white/45">
                    <span className="inline-flex items-center gap-1.5"><Eye size={14} /> {t('share.preview')}</span>
                    <span>1080 × 1440 PNG</span>
                  </div>
                  <div className="h-[432px] w-[324px] overflow-hidden rounded-2xl shadow-[0_24px_70px_rgba(0,0,0,0.5)] ring-1 ring-white/10">
                    <div className="origin-top-left scale-[0.6]">
                      <PosterCover result={result} language={language} shareUrl={shareUrl} />
                    </div>
                  </div>
                </div>
              </aside>

              <div className="p-4 md:max-h-[650px] md:overflow-y-auto md:p-6">
                <button
                  type="button"
                  onClick={() => setShowMobilePreview((value) => !value)}
                  className="mb-3 flex min-h-12 w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white/75 md:hidden"
                >
                  <span className="inline-flex items-center gap-2"><Eye size={17} className="text-indigo-300" /> {t('share.preview')}</span>
                  <ChevronDown size={17} className={`transition-transform ${showMobilePreview ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence initial={false}>
                  {showMobilePreview && (
                    <motion.div
                      initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 232, opacity: 1 }}
                      exit={prefersReducedMotion ? undefined : { height: 0, opacity: 0 }}
                      transition={prefersReducedMotion ? { duration: 0 } : undefined}
                      className="mb-4 overflow-hidden rounded-2xl bg-black/30 md:hidden"
                    >
                      <div className="mx-auto h-[216px] w-[162px] overflow-hidden rounded-xl shadow-xl">
                        <div className="origin-top-left scale-[0.3]">
                          <PosterCover result={result} language={language} shareUrl={shareUrl} />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/35">{t('share.exportOptions')}</p>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOption(primary.id)}
                  className="group flex min-h-[76px] w-full items-center gap-4 rounded-2xl border border-indigo-400/30 bg-gradient-to-r from-indigo-500/20 via-purple-500/15 to-pink-500/10 p-4 text-left transition hover:border-indigo-300/50 hover:bg-indigo-500/25 disabled:cursor-wait disabled:opacity-55"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20">
                    {isGenerating === primary.id ? <Loader2 className="animate-spin" size={22} /> : <FileArchive size={22} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-white">{isGenerating === primary.id ? t('share.generating') : primary.label}</span>
                    <span className="mt-0.5 block text-xs text-white/45">{primary.sublabel}</span>
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-white/50">ZIP</span>
                </button>

                <div className="mt-3 space-y-2">
                  {secondary.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      disabled={busy}
                      onClick={() => onOption(option.id)}
                      className="flex min-h-[68px] w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-left transition hover:border-white/20 hover:bg-white/[0.07] disabled:cursor-wait disabled:opacity-50"
                    >
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${option.gradient}`}>
                        {isGenerating === option.id ? <Loader2 className="animate-spin text-white" size={20} /> : <option.icon className="text-white" size={19} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-white">{isGenerating === option.id ? t('share.generating') : option.label}</span>
                        <span className="mt-0.5 block text-xs text-white/40">{option.sublabel}</span>
                      </span>
                      {option.id !== 'link' && (
                        <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-bold text-white/35">
                          {option.id === 'cover' ? 'PNG' : 'ZIP'}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {canNativeShare && (
                  <button
                    type="button"
                    onClick={onNativeShare}
                    disabled={busy}
                    className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/15 disabled:opacity-50"
                  >
                    {isGenerating === 'native' ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
                    {isGenerating === 'native' ? t('share.generating') : t('share.useNativeShare')}
                  </button>
                )}

                <AnimatePresence mode="popLayout">
                  {(success || error) && (
                    <motion.div
                      role="status"
                      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={prefersReducedMotion ? undefined : { opacity: 0, y: 8 }}
                      transition={prefersReducedMotion ? { duration: 0 } : undefined}
                      className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm ${
                        success
                          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                          : 'border-red-500/25 bg-red-500/10 text-red-300'
                      }`}
                    >
                      {success ? <Check size={17} className="mt-0.5 shrink-0" /> : <ImageIcon size={17} className="mt-0.5 shrink-0" />}
                      <span>{success || error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
