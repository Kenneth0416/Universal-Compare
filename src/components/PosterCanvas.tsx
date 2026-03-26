import React, { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { ComparisonResult } from '../services/geminiService';

interface PosterCanvasProps {
  result: ComparisonResult;
  /** 宽度，默认 540 (设计尺寸 1080 的一半，用于高清渲染) */
  width?: number;
  /** 高度，默认 720 (设计尺寸 1440 的一半) */
  height?: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value);

export const PosterCanvas: React.FC<PosterCanvasProps> = ({
  result,
  width = 540,
  height = 720,
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // 计算总分
  const totalA = result.dimensions.reduce((sum, dim) => {
    const score = dim.analysis?.optional_score_a;
    return sum + (isFiniteNumber(score) ? score : 0);
  }, 0);
  const totalB = result.dimensions.reduce((sum, dim) => {
    const score = dim.analysis?.optional_score_b;
    return sum + (isFiniteNumber(score) ? score : 0);
  }, 0);
  const avgA = result.dimensions.length > 0 ? totalA / result.dimensions.length : 0;
  const avgB = result.dimensions.length > 0 ? totalB / result.dimensions.length : 0;

  // Top 3 维度
  const topDimensions = [...result.dimensions]
    .map((dim) => ({
      ...dim,
      diff: Math.abs(
        (dim.analysis?.optional_score_a ?? 0) - (dim.analysis?.optional_score_b ?? 0)
      ),
    }))
    .sort((a, b) => b.diff - a.diff)
    .slice(0, 3);

  // 胜出者
  const winner = avgA > avgB ? result.entityA.name : avgB > avgA ? result.entityB.name : null;
  const loser = avgA > avgB ? result.entityB.name : avgB > avgA ? result.entityA.name : null;

  return (
    <div
      id="poster-canvas"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        background: 'linear-gradient(180deg, #1e1b4b 0%, #0f0a1e 100%)',
        fontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", -apple-system, sans-serif',
      }}
      className="flex flex-col p-6 text-white overflow-hidden"
    >
      {/* Header - 顶部 Hook */}
      <div className="flex-shrink-0 text-center mb-4">
        <div className="inline-block px-3 py-1 rounded-full bg-white/10 text-xs font-medium text-white/80 mb-3">
          AI 对比报告
        </div>
        <h1 className="text-3xl font-bold leading-tight mb-2">
          <span className="text-indigo-300">{result.entityA.name}</span>
          <span className="text-white/60 mx-2">VS</span>
          <span className="text-purple-300">{result.entityB.name}</span>
        </h1>
        {result.recommendation?.short_verdict && (
          <p className="text-sm text-white/70">{result.recommendation.short_verdict}</p>
        )}
      </div>

      {/* Score Summary */}
      <div className="flex-shrink-0 flex justify-center gap-8 mb-4">
        <div className="text-center">
          <div className="text-4xl font-bold text-indigo-300">{avgA.toFixed(1)}</div>
          <div className="text-xs text-white/50">{result.entityA.name}</div>
        </div>
        <div className="flex items-center text-2xl text-white/30">:</div>
        <div className="text-center">
          <div className="text-4xl font-bold text-purple-300">{avgB.toFixed(1)}</div>
          <div className="text-xs text-white/50">{result.entityB.name}</div>
        </div>
      </div>

      {/* Winner Badge */}
      {winner && (
        <div className="flex-shrink-0 text-center mb-4">
          <span className="inline-flex items-center gap-1 px-4 py-1.5 rounded-full bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-medium">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            推荐：{winner}
          </span>
        </div>
      )}

      {/* Dimensions Grid */}
      <div className="flex-1 grid grid-cols-1 gap-2 overflow-hidden mb-4">
        <div className="text-xs font-bold text-white/40 uppercase tracking-wider mb-1">
          核心对比维度
        </div>
        {topDimensions.map((dim, idx) => {
          const scoreA = dim.analysis?.optional_score_a ?? 0;
          const scoreB = dim.analysis?.optional_score_b ?? 0;
          const isAWinner = scoreA > scoreB;
          const isBWinner = scoreB > scoreA;

          return (
            <div
              key={dim.key || idx}
              className="flex items-center gap-3 p-2 rounded-lg bg-white/5"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{dim.label}</div>
                <div className="text-xs text-white/50 truncate">
                  {dim.analysis?.key_difference}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                    isAWinner
                      ? 'bg-indigo-500/30 text-indigo-300'
                      : isBWinner
                      ? 'bg-purple-500/30 text-purple-300'
                      : 'bg-white/10 text-white/50'
                  }`}
                >
                  {scoreA.toFixed(1)}
                </span>
                <span className="text-white/30">|</span>
                <span
                  className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                    isBWinner
                      ? 'bg-purple-500/30 text-purple-300'
                      : isAWinner
                      ? 'bg-indigo-500/30 text-indigo-300'
                      : 'bg-white/10 text-white/50'
                  }`}
                >
                  {scoreB.toFixed(1)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom - Brand + QR */}
      <div className="flex-shrink-0 flex items-center justify-between pt-3 border-t border-white/10">
        <div className="flex items-center gap-2">
          <div className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            CompareAI
          </div>
          <div className="text-[10px] text-white/40">Powered by AI</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] text-white/50">扫码生成你的对比</div>
            <div className="text-[10px] text-white/30">{window.location.host}</div>
          </div>
          <div className="p-1 bg-white rounded">
            <QRCodeCanvas
              value={typeof window !== 'undefined' ? window.location.href : ''}
              size={56}
              bgColor="#ffffff"
              fgColor="#000000"
              level="M"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PosterCanvas;
