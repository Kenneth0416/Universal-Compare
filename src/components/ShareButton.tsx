import React, { useState, useRef, useEffect } from 'react';
import { Share2, Download, X, Image, Loader2 } from 'lucide-react';
import { ComparisonResult } from '../services/geminiService';
import {
  generatePosterBlob,
  downloadPoster,
  nativeShare,
} from '../services/shareService';
import { PosterCanvas } from './PosterCanvas';

interface ShareButtonProps {
  result: ComparisonResult;
  className?: string;
}

export const ShareButton: React.FC<ShareButtonProps> = ({ result, className = '' }) => {
  const [showPanel, setShowPanel] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  // 下载海报
  const handleDownload = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      // 临时挂载海报容器
      const tempContainer = document.createElement('div');
      tempContainer.id = 'temp-poster-container';
      tempContainer.style.cssText = 'position: fixed; left: -9999px; top: 0; z-index: -1;';
      document.body.appendChild(tempContainer);

      // 渲染海报内容
      const { createRoot } = await import('react-dom/client');
      const root = createRoot(tempContainer);

      await new Promise<void>((resolve) => {
        root.render(
          <PosterCanvas result={result} width={540} height={720} />
        );
        // 等待渲染完成
        setTimeout(resolve, 100);
      });

      // 等待图片加载
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 查找海报容器
      const posterElement = document.getElementById('poster-canvas');
      if (!posterElement) {
        throw new Error('海报容器未找到');
      }

      // 生成海报
      const blob = await generatePosterBlob({
        containerElement: posterElement,
        pixelRatio: 2,
      });

      // 下载
      const filename = `${result.entityA.name}-vs-${result.entityB.name}-对比报告.png`;
      downloadPoster(blob, filename);

      // 清理
      root.unmount();
      document.body.removeChild(tempContainer);

      setShowPanel(false);
    } catch (err) {
      console.error('生成海报失败:', err);
      setError('生成失败，请重试');
    } finally {
      setIsGenerating(false);
    }
  };

  // 系统分享
  const handleNativeShare = async () => {
    const success = await nativeShare({
      title: `${result.entityA.name} VS ${result.entityB.name} - AI 对比报告`,
      text: result.recommendation?.short_verdict || `来看看 ${result.entityA.name} 和 ${result.entityB.name} 的对比分析！`,
      url: window.location.href,
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
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-all shadow-lg shadow-indigo-500/25"
      >
        <Share2 size={16} />
        <span>分享</span>
      </button>

      {/* 分享面板 */}
      {showPanel && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-[#1a1a2e]/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between p-3 border-b border-white/10">
            <span className="text-sm font-medium text-white">分享方式</span>
            <button
              onClick={() => setShowPanel(false)}
              className="p-1 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          <div className="p-2 space-y-1">
            {/* 下载海报 */}
            <button
              onClick={handleDownload}
              disabled={isGenerating}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left transition-colors disabled:opacity-50"
            >
              {isGenerating ? (
                <Loader2 size={18} className="text-indigo-400 animate-spin" />
              ) : (
                <Image size={18} className="text-indigo-400" />
              )}
              <div>
                <div className="text-sm font-medium text-white">
                  {isGenerating ? '生成中...' : '下载海报'}
                </div>
                <div className="text-xs text-white/50">PNG 格式，适合小红书</div>
              </div>
            </button>

            {/* 系统分享 */}
            {'share' in navigator && (
              <button
                onClick={handleNativeShare}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left transition-colors"
              >
                <Share2 size={18} className="text-purple-400" />
                <div>
                  <div className="text-sm font-medium text-white">分享到...</div>
                  <div className="text-xs text-white/50">调用系统分享面板</div>
                </div>
              </button>
            )}
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="px-3 pb-3">
              <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                {error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ShareButton;
