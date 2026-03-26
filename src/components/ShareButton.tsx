import React, { useState, useRef, useEffect } from 'react';
import { Share2, X, Image, Loader2, Layers, Check, Download } from 'lucide-react';
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

export const ShareButton: React.FC<ShareButtonProps> = ({ result, className = '' }) => {
  const [showPanel, setShowPanel] = useState(false);
  const [isGenerating, setIsGenerating] = useState<'cover' | 'cards' | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tempContainerRef = useRef<HTMLDivElement | null>(null);

  // 点击外部关闭面板
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false);
      }
    };

    if (showPanel) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showPanel]);

  // 清理临时容器
  useEffect(() => {
    return () => {
      if (tempContainerRef.current) {
        document.body.removeChild(tempContainerRef.current);
      }
    };
  }, []);

  // 创建临时渲染容器
  const createTempContainer = () => {
    if (tempContainerRef.current) {
      document.body.removeChild(tempContainerRef.current);
    }
    const container = document.createElement('div');
    container.id = 'temp-poster-container';
    container.style.cssText = 'position: fixed; left: -9999px; top: 0; z-index: -1;';
    document.body.appendChild(container);
    tempContainerRef.current = container;
    return container;
  };

  // 等待渲染完成
  const waitForRender = (ms = 300) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  // 下载封面海报
  const handleDownloadCover = async () => {
    setIsGenerating('cover');
    setError(null);
    setSuccess(null);

    try {
      const container = createTempContainer();
      const { createRoot } = await import('react-dom/client');
      const root = createRoot(container);

      await new Promise<void>((resolve) => {
        root.render(<PosterCover result={result} width={540} height={720} />);
        setTimeout(resolve, 100);
      });

      await waitForRender(500);

      const posterElement = document.getElementById('poster-cover');
      if (!posterElement) throw new Error('海报容器未找到');

      const blob = await generatePosterBlob({
        containerElement: posterElement,
        pixelRatio: 2,
      });

      const filename = `${result.entityA.name}-vs-${result.entityB.name}-对比报告.png`;
      downloadPoster(blob, filename);

      root.unmount();
      document.body.removeChild(container);
      tempContainerRef.current = null;

      setSuccess('封面海报已下载');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('生成海报失败:', err);
      setError('生成失败，请重试');
    } finally {
      setIsGenerating(null);
    }
  };

  // 下载维度卡片
  const handleDownloadCards = async () => {
    setIsGenerating('cards');
    setError(null);
    setSuccess(null);

    try {
      const container = createTempContainer();
      const { createRoot } = await import('react-dom/client');

      for (let i = 0; i < result.dimensions.length; i++) {
        const root = createRoot(container);

        await new Promise<void>((resolve) => {
          root.render(
            <DimensionCard
              dimension={result.dimensions[i]}
              entityA={result.entityA.name}
              entityB={result.entityB.name}
              dimensionIndex={i}
              totalDimensions={result.dimensions.length}
              width={540}
              height={720}
            />
          );
          setTimeout(resolve, 100);
        });

        await waitForRender(500);

        const cardElement = document.getElementById(`dimension-card-${i}`);
        if (!cardElement) throw new Error(`卡片 ${i} 未找到`);

        const blob = await generatePosterBlob({
          containerElement: cardElement,
          pixelRatio: 2,
        });

        const filename = `${result.entityA.name}-vs-${result.entityB.name}-${result.dimensions[i].label}.png`;
        downloadPoster(blob, filename);

        root.unmount();
        await waitForRender(300);
      }

      document.body.removeChild(container);
      tempContainerRef.current = null;

      setSuccess(`已下载 ${result.dimensions.length} 张维度卡片`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('生成卡片失败:', err);
      setError('生成失败，请重试');
    } finally {
      setIsGenerating(null);
    }
  };

  // 下载全部
  const handleDownloadAll = async () => {
    setIsGenerating('all');
    setError(null);
    setSuccess(null);

    try {
      // 先生成封面
      const container = createTempContainer();
      const { createRoot } = await import('react-dom/client');
      const root = createRoot(container);

      await new Promise<void>((resolve) => {
        root.render(<PosterCover result={result} width={540} height={720} />);
        setTimeout(resolve, 100);
      });

      await waitForRender(500);

      const posterElement = document.getElementById('poster-cover');
      if (!posterElement) throw new Error('海报容器未找到');

      const coverBlob = await generatePosterBlob({
        containerElement: posterElement,
        pixelRatio: 2,
      });

      const coverFilename = `${result.entityA.name}-vs-${result.entityB.name}-对比报告.png`;
      downloadPoster(coverBlob, coverFilename);

      root.unmount();

      // 再生成卡片
      for (let i = 0; i < result.dimensions.length; i++) {
        const cardRoot = createRoot(container);

        await new Promise<void>((resolve) => {
          cardRoot.render(
            <DimensionCard
              dimension={result.dimensions[i]}
              entityA={result.entityA.name}
              entityB={result.entityB.name}
              dimensionIndex={i}
              totalDimensions={result.dimensions.length}
              width={540}
              height={720}
            />
          );
          setTimeout(resolve, 100);
        });

        await waitForRender(500);

        const cardElement = document.getElementById(`dimension-card-${i}`);
        if (!cardElement) throw new Error(`卡片 ${i} 未找到`);

        const cardBlob = await generatePosterBlob({
          containerElement: cardElement,
          pixelRatio: 2,
        });

        const cardFilename = `${result.entityA.name}-vs-${result.entityB.name}-${result.dimensions[i].label}.png`;
        downloadPoster(cardBlob, cardFilename);

        cardRoot.unmount();
        await waitForRender(300);
      }

      document.body.removeChild(container);
      tempContainerRef.current = null;

      setSuccess(`已下载 ${result.dimensions.length + 1} 张图片`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('生成失败:', err);
      setError('生成失败，请重试');
    } finally {
      setIsGenerating(null);
    }
  };

  // 系统分享
  const handleNativeShare = async () => {
    const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
    const success = await nativeShare({
      title: `${result.entityA.name} VS ${result.entityB.name} - AI 对比报告`,
      text: result.recommendation?.short_verdict || `来看看 ${result.entityA.name} 和 ${result.entityB.name} 的对比分析！`,
      url: shareUrl,
    });

    if (success) {
      setShowPanel(false);
    }
  };

  return (
    <div className={`relative ${className}`} ref={panelRef}>
      {/* 分享按钮 */}
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50"
      >
        <Share2 size={16} />
        <span>分享海报</span>
      </button>

      {/* 分享面板 */}
      {showPanel && (
        <div className="absolute right-0 top-full mt-3 w-72 bg-[#0f0a1e]/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <span className="text-sm font-semibold text-white">分享到小红书</span>
            <button
              onClick={() => setShowPanel(false)}
              className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-3 space-y-2">
            {/* 下载全部 */}
            <button
              onClick={handleDownloadAll}
              disabled={isGenerating !== null}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 hover:from-indigo-500/30 hover:to-purple-500/30 text-left transition-all disabled:opacity-50"
            >
              {isGenerating === 'all' ? (
                <Loader2 size={20} className="text-indigo-400 animate-spin" />
              ) : (
                <Layers size={20} className="text-indigo-400" />
              )}
              <div>
                <div className="text-sm font-semibold text-white">
                  {isGenerating === 'all' ? '生成中...' : '下载全套'}
                </div>
                <div className="text-xs text-white/50">
                  封面 + {result.dimensions.length} 张维度卡片
                </div>
              </div>
            </button>

            {/* 分隔线 */}
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[10px] text-white/30 font-medium">或选择</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* 封面海报 */}
            <button
              onClick={handleDownloadCover}
              disabled={isGenerating !== null}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all disabled:opacity-50"
            >
              {isGenerating === 'cover' ? (
                <Loader2 size={18} className="text-purple-400 animate-spin" />
              ) : (
                <Image size={18} className="text-purple-400" />
              )}
              <div>
                <div className="text-sm font-medium text-white">
                  {isGenerating === 'cover' ? '生成中...' : '封面海报'}
                </div>
                <div className="text-xs text-white/50">雷达图 + 总览</div>
              </div>
            </button>

            {/* 维度卡片 */}
            <button
              onClick={handleDownloadCards}
              disabled={isGenerating !== null}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-all disabled:opacity-50"
            >
              {isGenerating === 'cards' ? (
                <Loader2 size={18} className="text-pink-400 animate-spin" />
              ) : (
                <Layers size={18} className="text-pink-400" />
              )}
              <div>
                <div className="text-sm font-medium text-white">
                  {isGenerating === 'cards' ? '生成中...' : '维度卡片'}
                </div>
                <div className="text-xs text-white/50">
                  {result.dimensions.length} 张详细对比
                </div>
              </div>
            </button>

            {/* 系统分享 */}
            {'share' in navigator && (
              <>
                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-[10px] text-white/30 font-medium">更多</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>

                <button
                  onClick={handleNativeShare}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors"
                >
                  <Share2 size={18} className="text-emerald-400" />
                  <div>
                    <div className="text-sm font-medium text-white">分享链接</div>
                    <div className="text-xs text-white/50">复制链接给好友</div>
                  </div>
                </button>
              </>
            )}
          </div>

          {/* 消息提示 */}
          {success && (
            <div className="mx-3 mb-3 p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center gap-2">
              <Check size={16} className="text-emerald-400" />
              <span className="text-xs text-emerald-300">{success}</span>
            </div>
          )}

          {error && (
            <div className="mx-3 mb-3 p-3 rounded-xl bg-red-500/20 border border-red-500/30">
              <span className="text-xs text-red-400">{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ShareButton;
