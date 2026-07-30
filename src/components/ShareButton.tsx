import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Image, Layers, Link2, Sparkles } from 'lucide-react';
import PosterExportDialog, { type PosterExportOption } from './PosterExportDialog';
import { motion, useReducedMotion } from 'motion/react';
import { ComparisonResult } from '../services/geminiService';
import {
  generatePosterBlob,
  downloadPoster,
  nativeShare,
  assertPosterArchiveBudget,
  normalizeHttpUrl,
} from '../services/shareService';
import { PosterCover } from './poster/PosterCover';
import { DimensionCard } from './poster/DimensionCard';
import {
  buildPosterFilename,
  MAX_POSTER_DIMENSIONS,
  sanitizePosterFilename,
} from './poster/posterUtils';
import { useTranslation } from 'react-i18next';

interface ShareButtonProps {
  result: ComparisonResult;
  reportUrl?: string | null;
  className?: string;
  /** Optional persistence state; omitted for already-persisted report viewers. */
  reportStatus?: 'saving' | 'ready' | 'error';
  onRetrySave?: () => void;
  /** Language of the report content; defaults to current UI language. */
  language?: string;
}

export const ShareButton: React.FC<ShareButtonProps> = ({
  result,
  reportUrl,
  className = '',
  reportStatus,
  onRetrySave,
  language,
}) => {
  const { t, i18n: i18nInstance } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const tempContainerRef = useRef<HTMLDivElement | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const operationRef = useRef<AbortController | null>(null);

  const shareOptions: PosterExportOption[] = [
    {
      id: 'all',
      label: t('share.downloadAll'),
      sublabel: t('share.downloadAllDesc'),
      icon: Layers,
      gradient: 'from-indigo-500 via-purple-500 to-pink-500',
      glowColor: '#8b5cf6',
    },
    {
      id: 'cover',
      label: t('share.downloadCover'),
      sublabel: t('share.downloadCoverDesc'),
      icon: Image,
      gradient: 'from-purple-500 via-pink-500 to-rose-500',
      glowColor: '#ec4899',
    },
    {
      id: 'cards',
      label: t('share.downloadCards'),
      sublabel: t('share.downloadCardsDesc'),
      icon: Layers,
      gradient: 'from-pink-500 via-rose-500 to-red-500',
      glowColor: '#f43f5e',
    },
    {
      id: 'link',
      label: t('share.copyLink'),
      sublabel: t('share.copyLinkDesc'),
      icon: Link2,
      gradient: 'from-cyan-500 via-teal-500 to-emerald-500',
      glowColor: '#14b8a6',
    },
  ];

  const currentLang = language || i18nInstance.resolvedLanguage || i18nInstance.language || 'en';
  const explicitReportUrl = normalizeHttpUrl(reportUrl, window.location.origin);
  const isPersistedViewer = /^\/(?:r|compare)\/[^/]+\/?$/.test(window.location.pathname);
  const viewerUrl = isPersistedViewer ? normalizeHttpUrl(window.location.href) : null;
  const shareUrl = explicitReportUrl ?? viewerUrl;
  const isSaveFailed = !shareUrl && reportStatus === 'error';
  const isPreparing = !shareUrl && !isSaveFailed;
  const exportDimensions = (Array.isArray(result.dimensions) ? result.dimensions : []).slice(0, MAX_POSTER_DIMENSIONS);

  const showFeedback = useCallback((message: string) => {
    setSuccess(message);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setSuccess(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
      operationRef.current?.abort();
      if (tempContainerRef.current?.parentNode) {
        tempContainerRef.current.parentNode.removeChild(tempContainerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isExpanded]);

  const createTempContainer = useCallback(() => {
    if (tempContainerRef.current) {
      document.body.removeChild(tempContainerRef.current);
    }
    const container = document.createElement('div');
    container.style.cssText = 'position: fixed; left: -10000px; top: 0; width: 540px; height: 720px; pointer-events: none;';
    document.body.appendChild(container);
    tempContainerRef.current = container;
    return container;
  }, []);

  const waitForRender = useCallback(async (signal: AbortSignal) => {
    signal.throwIfAborted();
    await document.fonts?.ready;
    signal.throwIfAborted();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    // QR canvas and Recharts SVG finish their first paint after React commits.
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    signal.throwIfAborted();
  }, []);

  const generatePoster = async (
    type: 'cover' | 'card',
    signal: AbortSignal,
    index?: number
  ): Promise<{ blob: Blob; filename: string }> => {
    if (!shareUrl) throw new Error('REPORT_URL_NOT_READY');
    signal.throwIfAborted();
    const container = createTempContainer();
    let root: ReturnType<typeof import('react-dom/client').createRoot> | null = null;

    try {
      const { createRoot } = await import('react-dom/client');
      root = createRoot(container);
      const baseName = sanitizePosterFilename(`${result.entityA.name}-vs-${result.entityB.name}`);

      if (type === 'cover') {
        root.render(
          <PosterCover result={result} width={540} height={720} language={currentLang} shareUrl={shareUrl} />
        );
      } else {
        if (index === undefined || !exportDimensions[index]) throw new Error('INVALID_POSTER_CARD');
        root.render(
          <DimensionCard
            dimension={exportDimensions[index]}
            entityA={result.entityA.name}
            entityB={result.entityB.name}
            dimensionIndex={index}
            totalDimensions={exportDimensions.length}
            width={540}
            height={720}
            language={currentLang}
            shareUrl={shareUrl}
          />
        );
      }

      await waitForRender(signal);
      const posterElement = container.firstElementChild as HTMLElement | null;
      if (!posterElement) throw new Error('POSTER_ELEMENT_NOT_FOUND');
      const blob = await generatePosterBlob({ containerElement: posterElement, pixelRatio: 2, signal });
      const uniqueSuffix = type === 'cover'
        ? 'cover'
        : `dimension-${String((index ?? 0) + 1).padStart(2, '0')}`;
      const descriptiveBase = type === 'cover'
        ? `${baseName}-${t('share.reportSuffix')}`
        : `${baseName}-${exportDimensions[index!].label}`;
      return { blob, filename: buildPosterFilename(descriptiveBase, uniqueSuffix) };
    } finally {
      root?.unmount();
      container.remove();
      if (tempContainerRef.current === container) tempContainerRef.current = null;
    }
  };

  const downloadZip = async (
    images: Array<{ blob: Blob; filename: string }>,
    suffix: string,
    signal: AbortSignal
  ) => {
    signal.throwIfAborted();
    assertPosterArchiveBudget(images);
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    images.forEach((image) => zip.file(image.filename, image.blob));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    signal.throwIfAborted();
    assertPosterArchiveBudget([{ blob }]);
    const baseName = sanitizePosterFilename(`${result.entityA.name}-vs-${result.entityB.name}`);
    downloadPoster(blob, buildPosterFilename(baseName, suffix, 'zip'));
  };

  const beginOperation = (id: string): AbortController | null => {
    if (operationRef.current) return null;
    const controller = new AbortController();
    operationRef.current = controller;
    setIsGenerating(id);
    setError(null);
    setSuccess(null);
    return controller;
  };

  const finishOperation = (controller: AbortController) => {
    if (operationRef.current === controller) {
      operationRef.current = null;
      setIsGenerating(null);
    }
  };

  const reportGenerationError = (error: unknown) => {
    if ((error as Error).name === 'AbortError') return;
    console.error(error);
    setError(t('share.generateFailed'));
  };

  const handleDownloadAll = async () => {
    const controller = beginOperation('all');
    if (!controller) return;
    try {
      const images = [await generatePoster('cover', controller.signal)];
      for (let i = 0; i < exportDimensions.length; i++) {
        images.push(await generatePoster('card', controller.signal, i));
      }
      await downloadZip(images, 'all-posters', controller.signal);
      showFeedback(t('share.downloadedAll', { count: images.length }));
    } catch (error) {
      reportGenerationError(error);
    } finally {
      finishOperation(controller);
    }
  };

  const handleDownloadCover = async () => {
    const controller = beginOperation('cover');
    if (!controller) return;
    try {
      const image = await generatePoster('cover', controller.signal);
      downloadPoster(image.blob, image.filename);
      showFeedback(t('share.downloadedCover'));
    } catch (error) {
      reportGenerationError(error);
    } finally {
      finishOperation(controller);
    }
  };

  const handleDownloadCards = async () => {
    const controller = beginOperation('cards');
    if (!controller) return;
    try {
      const images = [];
      for (let i = 0; i < exportDimensions.length; i++) {
        images.push(await generatePoster('card', controller.signal, i));
      }
      if (!images.length) throw new Error('NO_DIMENSION_CARDS');
      await downloadZip(images, 'dimension-cards', controller.signal);
      showFeedback(t('share.downloadedCards', { count: images.length }));
    } catch (error) {
      reportGenerationError(error);
    } finally {
      finishOperation(controller);
    }
  };

  const handleCopyLink = async () => {
    setError(null);
    try {
      if (!shareUrl) throw new Error('REPORT_URL_NOT_READY');
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement('textarea');
        input.value = shareUrl;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        if (!copied) throw new Error('COPY_FAILED');
      }
      showFeedback(t('share.linkCopied'));
    } catch {
      setError(t('share.copyFailed'));
    }
  };

  const handleNativeShare = async () => {
    const controller = beginOperation('native');
    if (!controller) return;
    try {
      const image = await generatePoster('cover', controller.signal);
      const file = new File([image.blob], image.filename, { type: 'image/png' });
      const outcome = await nativeShare({
        title: `${result.entityA.name} VS ${result.entityB.name} - ${t('share.reportSuffix')}`,
        text: result.recommendation?.short_verdict || `${result.entityA.name} vs ${result.entityB.name}`,
        url: shareUrl ?? undefined,
        files: [file],
      });
      if (outcome === 'shared') setIsExpanded(false);
      if (outcome === 'failed' || outcome === 'unavailable') setError(t('share.nativeShareFailed'));
    } catch (error) {
      reportGenerationError(error);
    } finally {
      finishOperation(controller);
    }
  };

  const handleCancel = () => operationRef.current?.abort();

  const handleOptionClick = (id: PosterExportOption['id']) => {
    switch (id) {
      case 'all': handleDownloadAll(); break;
      case 'cover': handleDownloadCover(); break;
      case 'cards': handleDownloadCards(); break;
      case 'link': handleCopyLink(); break;
    }
  };

  return (
    <div className={`relative ${className}`}>
      <PosterExportDialog
        open={isExpanded}
        result={result}
        language={currentLang}
        shareUrl={shareUrl ?? ''}
        options={shareOptions}
        isGenerating={isGenerating}
        success={success}
        error={error}
        onClose={() => setIsExpanded(false)}
        onCancel={handleCancel}
        onOption={handleOptionClick}
        onNativeShare={handleNativeShare}
        t={t}
      />

      <motion.button
        key="trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isExpanded}
        disabled={!shareUrl}
        aria-describedby={!shareUrl ? 'share-availability-status' : undefined}
        initial={prefersReducedMotion ? false : { opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
        transition={prefersReducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }}
        whileHover={prefersReducedMotion ? undefined : { scale: 1.03, y: -2 }}
        whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
        onClick={() => setIsExpanded(true)}
        className="relative z-10 flex items-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 px-5 py-3 shadow-xl shadow-purple-500/40 disabled:cursor-not-allowed disabled:grayscale disabled:opacity-50"
      >
        <motion.div
          className="absolute inset-0 opacity-90"
          animate={prefersReducedMotion ? undefined : { backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
          transition={prefersReducedMotion ? { duration: 0 } : { duration: 4, repeat: Infinity, ease: 'linear' }}
          style={{ background: 'linear-gradient(135deg, #4f46e5, #9333ea, #ec4899, #4f46e5)', backgroundSize: '300% 300%' }}
        />
        <div className="relative flex items-center gap-2">
          <motion.div
            animate={prefersReducedMotion ? undefined : { rotate: [0, 15, -15, 0] }}
            transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.5, repeat: Infinity, repeatDelay: 2 }}
          >
            <Sparkles size={18} className="text-white" />
          </motion.div>
          <span className="text-white font-semibold text-sm">
            {isPreparing
              ? t('share.preparing', { defaultValue: 'Preparing share…' })
              : isSaveFailed
                ? t('share.saveFailed', { defaultValue: 'Sharing unavailable' })
                : t('share.sharePoster')}
          </span>
        </div>
      </motion.button>
      {!shareUrl && (
        <div id="share-availability-status" role={isSaveFailed ? 'alert' : 'status'} className="mt-2 text-center text-xs text-neutral-400">
          <span>
            {isSaveFailed
              ? t('report.saveFailed', { defaultValue: 'The report could not be saved.' })
              : t('share.preparingDescription', { defaultValue: 'The share link is being prepared.' })}
          </span>
          {isSaveFailed && onRetrySave && (
            <button type="button" onClick={onRetrySave} className="ml-2 font-semibold text-indigo-300 underline underline-offset-2">
              {t('report.retrySave', { defaultValue: 'Retry' })}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ShareButton;
