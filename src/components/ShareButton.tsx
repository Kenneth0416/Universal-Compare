import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Share2, X, Image, Loader2, Layers, Check, Link2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ComparisonResult } from '../services/geminiService';
import {
  generatePosterBlob,
  downloadPoster,
  nativeShare,
} from '../services/shareService';
import { PosterCover } from './poster/PosterCover';
import { DimensionCard } from './poster/DimensionCard';

interface ShareButtonProps {
  result: ComparisonResult;
  className?: string;
}

// 分享選項配置
const shareOptions = [
  {
    id: 'all',
    label: '下載全套',
    sublabel: '封面 + 維度卡片',
    icon: Layers,
    gradient: 'from-indigo-500 via-purple-500 to-pink-500',
    glowColor: '#8b5cf6',
  },
  {
    id: 'cover',
    label: '封面海報',
    sublabel: '雷達圖總覽',
    icon: Image,
    gradient: 'from-purple-500 via-pink-500 to-rose-500',
    glowColor: '#ec4899',
  },
  {
    id: 'cards',
    label: '維度卡片',
    sublabel: '詳細對比圖',
    icon: Layers,
    gradient: 'from-pink-500 via-rose-500 to-red-500',
    glowColor: '#f43f5e',
  },
  {
    id: 'link',
    label: '複製連結',
    sublabel: '快速分享',
    icon: Link2,
    gradient: 'from-cyan-500 via-teal-500 to-emerald-500',
    glowColor: '#14b8a6',
  },
];

export const ShareButton: React.FC<ShareButtonProps> = ({ result, className = '' }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isGenerating, setIsGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const tempContainerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);

  // 清理臨時容器
  useEffect(() => {
    return () => {
      if (tempContainerRef.current) {
        document.body.removeChild(tempContainerRef.current);
      }
    };
  }, []);

  // ESC 鍵關閉
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isExpanded]);

  // 創建臨時渲染容器
  const createTempContainer = useCallback(() => {
    if (tempContainerRef.current) {
      document.body.removeChild(tempContainerRef.current);
    }
    const container = document.createElement('div');
    container.id = 'temp-poster-container';
    container.style.cssText = 'position: fixed; left: -9999px; top: 0; z-index: -1;';
    document.body.appendChild(container);
    tempContainerRef.current = container;
    return container;
  }, []);

  const waitForRender = useCallback((ms = 300) =>
    new Promise((resolve) => setTimeout(resolve, ms)), []);

  // 生成海報的核心邏輯
  const generatePoster = async (type: 'cover' | 'card', index?: number) => {
    const container = createTempContainer();
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(container);

    if (type === 'cover') {
      await new Promise<void>((resolve) => {
        root.render(<PosterCover result={result} width={540} height={720} />);
        setTimeout(resolve, 100);
      });
      await waitForRender(500);
      const posterElement = document.getElementById('poster-cover');
      if (!posterElement) throw new Error('海報容器未找到');
      const blob = await generatePosterBlob({ containerElement: posterElement, pixelRatio: 2 });
      const filename = `${result.entityA.name}-vs-${result.entityB.name}-對比報告.png`;
      downloadPoster(blob, filename);
    } else if (type === 'card' && index !== undefined) {
      await new Promise<void>((resolve) => {
        root.render(
          <DimensionCard
            dimension={result.dimensions[index]}
            entityA={result.entityA.name}
            entityB={result.entityB.name}
            dimensionIndex={index}
            totalDimensions={result.dimensions.length}
            width={540}
            height={720}
          />
        );
        setTimeout(resolve, 100);
      });
      await waitForRender(500);
      const cardElement = document.getElementById(`dimension-card-${index}`);
      if (!cardElement) throw new Error(`卡片 ${index} 未找到`);
      const blob = await generatePosterBlob({ containerElement: cardElement, pixelRatio: 2 });
      const filename = `${result.entityA.name}-vs-${result.entityB.name}-${result.dimensions[index].label}.png`;
      downloadPoster(blob, filename);
    }

    root.unmount();
    document.body.removeChild(container);
    tempContainerRef.current = null;
  };

  // 處理下載全套
  const handleDownloadAll = async () => {
    setIsGenerating('all');
    setError(null);
    setSuccess(null);
    try {
      await generatePoster('cover');
      for (let i = 0; i < result.dimensions.length; i++) {
        await generatePoster('card', i);
      }
      setSuccess(`已下載 ${result.dimensions.length + 1} 張圖片`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('生成失敗:', err);
      setError('生成失敗，請重試');
    } finally {
      setIsGenerating(null);
    }
  };

  const handleDownloadCover = async () => {
    setIsGenerating('cover');
    setError(null);
    setSuccess(null);
    try {
      await generatePoster('cover');
      setSuccess('封面海報已下載');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('生成失敗:', err);
      setError('生成失敗，請重試');
    } finally {
      setIsGenerating(null);
    }
  };

  const handleDownloadCards = async () => {
    setIsGenerating('cards');
    setError(null);
    setSuccess(null);
    try {
      for (let i = 0; i < result.dimensions.length; i++) {
        await generatePoster('card', i);
      }
      setSuccess(`已下載 ${result.dimensions.length} 張維度卡片`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('生成失敗:', err);
      setError('生成失敗，請重試');
    } finally {
      setIsGenerating(null);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setSuccess('連結已複製');
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError('複製失敗');
    }
  };

  const handleNativeShare = async () => {
    const shareUrl = window.location.href;
    const success = await nativeShare({
      title: `${result.entityA.name} VS ${result.entityB.name} - AI 對比報告`,
      text: result.recommendation?.short_verdict || `來看看 ${result.entityA.name} 和 ${result.entityB.name} 的對比分析！`,
      url: shareUrl,
    });
    if (success) {
      setIsExpanded(false);
    }
  };

  // 點擊選項處理
  const handleOptionClick = (id: string) => {
    switch (id) {
      case 'all':
        handleDownloadAll();
        break;
      case 'cover':
        handleDownloadCover();
        break;
      case 'cards':
        handleDownloadCards();
        break;
      case 'link':
        handleCopyLink();
        break;
    }
  };

  return (
    <div className={`relative ${className}`} ref={buttonRef}>
      {/* 背景遮罩 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsExpanded(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      {/* 主按鈕 -> 展開容器 */}
      <AnimatePresence mode="wait">
        {!isExpanded ? (
          // 初始狀態：圓角矩形按鈕
          <motion.button
            key="trigger"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setIsExpanded(true)}
            className="relative overflow-hidden bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 shadow-xl shadow-purple-500/40 flex items-center gap-2 px-5 py-3 rounded-2xl z-50"
          >
            {/* 漸變動畫底層 */}
            <motion.div
              className="absolute inset-0 opacity-90"
              animate={{
                backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
              }}
              transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
              style={{
                background: 'linear-gradient(135deg, #4f46e5, #9333ea, #ec4899, #4f46e5)',
                backgroundSize: '300% 300%',
              }}
            />

            {/* 按鈕內容 */}
            <div className="relative flex items-center gap-2">
              <motion.div
                animate={{ rotate: [0, 15, -15, 0] }}
                transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 2 }}
              >
                <Sparkles size={18} className="text-white" />
              </motion.div>
              <span className="text-white font-semibold text-sm">分享海報</span>
            </div>
          </motion.button>
        ) : (
          // 展開後：大容器 + 選項
          <motion.div
            key="expanded"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="relative z-50"
          >
            {/* 外層發光邊框 */}
            <motion.div
              className="absolute -inset-1 rounded-3xl opacity-75"
              style={{
                background: 'linear-gradient(135deg, #8b5cf6, #ec4899, #f43f5e, #8b5cf6)',
                backgroundSize: '300% 300%',
                animation: 'gradient-rotate 3s ease infinite',
              }}
              animate={{
                opacity: [0.5, 0.8, 0.5],
              }}
              transition={{ duration: 2, repeat: Infinity }}
            />

            {/* 主容器 */}
            <div className="relative bg-[#0f0a1e]/95 backdrop-blur-xl rounded-3xl p-1 overflow-hidden">
              {/* 頂部標題欄 */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-purple-400" />
                  <span className="text-sm font-semibold text-white">分享海報</span>
                </div>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setIsExpanded(false)}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white transition-colors"
                >
                  <X size={16} />
                </motion.button>
              </div>

              {/* 選項網格 */}
              <div className="p-3 grid grid-cols-2 gap-2">
                {shareOptions.map((option, index) => (
                  <motion.button
                    key={option.id}
                    initial={{ opacity: 0, y: 20, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{
                      delay: index * 0.08,
                      type: 'spring',
                      stiffness: 400,
                      damping: 25,
                    }}
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleOptionClick(option.id)}
                    disabled={isGenerating !== null}
                    className={`
                      relative overflow-hidden flex flex-col items-center gap-2 p-4 rounded-2xl
                      bg-gradient-to-br ${option.gradient} p-[1px]
                      disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                  >
                    {/* 漸變背景 */}
                    <div
                      className="absolute inset-[1px] rounded-2xl bg-[#0f0a1e]/95"
                      style={{ background: 'rgba(15, 10, 30, 0.95)' }}
                    />

                    {/* 內容 */}
                    <div className="relative flex flex-col items-center gap-2">
                      {isGenerating === option.id ? (
                        <Loader2 size={28} className="text-white animate-spin" />
                      ) : (
                        <motion.div
                          whileHover={{ rotate: 360 }}
                          transition={{ duration: 0.5 }}
                          className={`p-2 rounded-xl bg-gradient-to-br ${option.gradient}`}
                        >
                          <option.icon size={24} className="text-white" />
                        </motion.div>
                      )}
                      <div className="text-center">
                        <div className="text-sm font-semibold text-white">
                          {isGenerating === option.id ? '生成中...' : option.label}
                        </div>
                        <div className="text-[10px] text-white/60 mt-0.5">{option.sublabel}</div>
                      </div>
                    </div>

                    {/* 懸停光暈 */}
                    <motion.div
                      className="absolute inset-0 rounded-2xl opacity-0"
                      style={{ background: option.glowColor }}
                      animate={{
                        opacity: [0, 0.15, 0],
                      }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  </motion.button>
                ))}
              </div>

              {/* 系統分享入口 */}
              {'share' in navigator && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: shareOptions.length * 0.08 + 0.1 }}
                  className="px-3 pb-3"
                >
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleNativeShare}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                  >
                    <Share2 size={18} className="text-emerald-400" />
                    <span className="text-sm font-medium text-white">使用系統分享</span>
                  </motion.button>
                </motion.div>
              )}

              {/* 消息提示 */}
              <AnimatePresence>
                {success && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, y: 10 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mx-3 mb-3 p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center gap-2"
                  >
                    <Check size={16} className="text-emerald-400" />
                    <span className="text-sm text-emerald-300">{success}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0, y: 10 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mx-3 mb-3 p-3 rounded-xl bg-red-500/20 border border-red-500/30"
                  >
                    <span className="text-sm text-red-400">{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 全局樣式 - 漸變動畫 */}
      <style>{`
        @keyframes gradient-rotate {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
    </div>
  );
};

export default ShareButton;
