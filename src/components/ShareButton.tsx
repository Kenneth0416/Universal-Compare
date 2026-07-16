import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Image, Layers, Link2, Sparkles } from 'lucide-react';
import PosterExportDialog, { type PosterExportOption } from './PosterExportDialog';
import { motion } from 'motion/react';
import { ComparisonResult } from '../services/geminiService';
import {
  generatePosterBlob,
  downloadPoster,
  nativeShare,
} from '../services/shareService';
import { PosterCover } from './poster/PosterCover';
import { DimensionCard } from './poster/DimensionCard';
import { sanitizePosterFilename } from './poster/posterUtils';
import { useTranslation } from 'react-i18next';

interface ShareButtonProps {
  result: ComparisonResult;
  reportUrl?: string | null;
  className?: string;
}

export const ShareButton: React.FC<ShareButtonProps> = ({ result, reportUrl, className = '' }) => {
  const { t, i18n: i18nInstance } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const tempContainerRef = useRef<HTMLDivElement | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

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

  const currentLang = i18nInstance.resolvedLanguage || i18nInstance.language || 'en';
  const shareUrl = reportUrl
    ? new URL(reportUrl, window.location.origin).href
    : window.location.href;

  const showFeedback = useCallback((message: string) => {
    setSuccess(message);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setSuccess(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
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

  const waitForRender = useCallback(async () => {
    await document.fonts?.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    // QR canvas and Recharts SVG finish their first paint after React commits.
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }, []);

  const generatePoster = async (type: 'cover' | 'card', index?: number): Promise<{ blob: Blob; filename: string }> => {
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
        if (index === undefined || !result.dimensions[index]) throw new Error('INVALID_POSTER_CARD');
        root.render(
          <DimensionCard
            dimension={result.dimensions[index]}
            entityA={result.entityA.name}
            entityB={result.entityB.name}
            dimensionIndex={index}
            totalDimensions={result.dimensions.length}
            width={540}
            height={720}
            language={currentLang}
            shareUrl={shareUrl}
          />
        );
      }

      await waitForRender();
      const posterElement = container.firstElementChild as HTMLElement | null;
      if (!posterElement) throw new Error('POSTER_ELEMENT_NOT_FOUND');
      const blob = await generatePosterBlob({ containerElement: posterElement, pixelRatio: 2 });
      const suffix = type === 'cover'
        ? t('share.reportSuffix')
        : `${String((index ?? 0) + 1).padStart(2, '0')}-${result.dimensions[index!].label}`;
      return { blob, filename: `${sanitizePosterFilename(`${baseName}-${suffix}`)}.png` };
    } finally {
      root?.unmount();
      container.remove();
      if (tempContainerRef.current === container) tempContainerRef.current = null;
    }
  };

  const downloadZip = async (images: Array<{ blob: Blob; filename: string }>, suffix: string) => {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    images.forEach((image) => zip.file(image.filename, image.blob));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const baseName = sanitizePosterFilename(`${result.entityA.name}-vs-${result.entityB.name}`);
    downloadPoster(blob, `${baseName}-${suffix}.zip`);
  };

  const handleDownloadAll = async () => {
    setIsGenerating('all');
    setError(null);
    setSuccess(null);
    try {
      const images = [await generatePoster('cover')];
      for (let i = 0; i < result.dimensions.length; i++) images.push(await generatePoster('card', i));
      await downloadZip(images, 'all-posters');
      showFeedback(t('share.downloadedAll', { count: images.length }));
    } catch (err) {
      console.error(err);
      setError(t('share.generateFailed'));
    } finally {
      setIsGenerating(null);
    }
  };

  const handleDownloadCover = async () => {
    setIsGenerating('cover');
    setError(null);
    setSuccess(null);
    try {
      const image = await generatePoster('cover');
      downloadPoster(image.blob, image.filename);
      showFeedback(t('share.downloadedCover'));
    } catch (err) {
      console.error(err);
      setError(t('share.generateFailed'));
    } finally {
      setIsGenerating(null);
    }
  };

  const handleDownloadCards = async () => {
    setIsGenerating('cards');
    setError(null);
    setSuccess(null);
    try {
      const images = [];
      for (let i = 0; i < result.dimensions.length; i++) images.push(await generatePoster('card', i));
      if (!images.length) throw new Error('NO_DIMENSION_CARDS');
      await downloadZip(images, 'dimension-cards');
      showFeedback(t('share.downloadedCards', { count: images.length }));
    } catch (err) {
      console.error(err);
      setError(t('share.generateFailed'));
    } finally {
      setIsGenerating(null);
    }
  };

  const handleCopyLink = async () => {
    setError(null);
    try {
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
    setIsGenerating('native');
    setError(null);
    try {
      const image = await generatePoster('cover');
      const file = new File([image.blob], image.filename, { type: 'image/png' });
      const outcome = await nativeShare({
        title: `${result.entityA.name} VS ${result.entityB.name} - ${t('share.reportSuffix')}`,
        text: result.recommendation?.short_verdict || `${result.entityA.name} vs ${result.entityB.name}`,
        url: shareUrl,
        files: [file],
      });
      if (outcome === 'shared') setIsExpanded(false);
      if (outcome === 'failed' || outcome === 'unavailable') setError(t('share.nativeShareFailed'));
    } catch (err) {
      console.error(err);
      setError(t('share.generateFailed'));
    } finally {
      setIsGenerating(null);
    }
  };

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
        shareUrl={shareUrl}
        options={shareOptions}
        isGenerating={isGenerating}
        success={success}
        error={error}
        onClose={() => setIsExpanded(false)}
        onOption={handleOptionClick}
        onNativeShare={handleNativeShare}
        t={t}
      />

      <motion.button
        key="trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isExpanded}
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        whileHover={{ scale: 1.03, y: -2 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => setIsExpanded(true)}
        className="relative z-10 flex items-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 px-5 py-3 shadow-xl shadow-purple-500/40"
      >
        <motion.div
          className="absolute inset-0 opacity-90"
          animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
          style={{ background: 'linear-gradient(135deg, #4f46e5, #9333ea, #ec4899, #4f46e5)', backgroundSize: '300% 300%' }}
        />
        <div className="relative flex items-center gap-2">
          <motion.div animate={{ rotate: [0, 15, -15, 0] }} transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 2 }}>
            <Sparkles size={18} className="text-white" />
          </motion.div>
          <span className="text-white font-semibold text-sm">{t('share.sharePoster')}</span>
        </div>
      </motion.button>
    </div>
  );
};

export default ShareButton;
