/**
 * DimensionCard - 单维度对比卡片
 * 用于小红书多图分享，每张卡片展示一个维度的详细对比
 */
import React from 'react';
import { ComparisonResult } from '../../services/geminiService';
import i18n, { normalizeLanguage } from '../../i18n';
import { clampPosterText, formatPosterScore, normalizePosterScore } from './posterUtils';

interface DimensionCardProps {
  dimension: ComparisonResult['dimensions'][number];
  entityA: string;
  entityB: string;
  dimensionIndex: number;
  totalDimensions: number;
  width?: number;
  height?: number;
  language?: string;
  shareUrl?: string;
}

function cardT(lang: string | undefined, key: string): string {
  return i18n.t(`poster.${key}`, { lng: normalizeLanguage(lang) });
}

export const DimensionCard: React.FC<DimensionCardProps> = ({
  dimension,
  entityA,
  entityB,
  dimensionIndex,
  totalDimensions,
  width = 540,
  height = 720,
  language,
  shareUrl,
}) => {
  const url = shareUrl || (typeof window !== 'undefined' ? window.location.href : '');
  const scoreA = normalizePosterScore(dimension.analysis?.optional_score_a);
  const scoreB = normalizePosterScore(dimension.analysis?.optional_score_b);
  const isAWinner = scoreA !== null && scoreB !== null && scoreA > scoreB;
  const isBWinner = scoreA !== null && scoreB !== null && scoreB > scoreA;
  const isTie = scoreA !== null && scoreB !== null && scoreA === scoreB;
  const diff = scoreA !== null && scoreB !== null ? Math.abs(scoreA - scoreB) : null;
  const barWidthA = (scoreA ?? 0) * 10;
  const barWidthB = (scoreB ?? 0) * 10;
  const title = clampPosterText(dimension.label, 64);
  const titleFontSize = title.length > 42 ? 18 : title.length > 26 ? 21 : 24;

  return (
    <div
      id={`dimension-card-${dimensionIndex}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        background: 'linear-gradient(180deg, #0f0a1e 0%, #1a1040 100%)',
        fontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", -apple-system, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
      className="flex flex-col text-white"
    >
      {/* 顶部装饰 */}
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{
          background: `linear-gradient(90deg, #818cf8 0%, #c084fc ${isAWinner ? '100%' : isBWinner ? '0%' : '50%'}, #c084fc 100%)`,
        }}
      />

      {/* 页码指示 */}
      <div className="relative flex-shrink-0 pt-4 px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center text-xs font-bold text-white/60"
            >
              {dimensionIndex + 1}
            </div>
            <span className="text-[10px] text-white/40 font-medium tracking-wider">
              / {totalDimensions}
            </span>
          </div>
          <span className="text-[10px] text-white/30">{cardT(language, 'dimensionDetail')}</span>
        </div>
      </div>

      {/* 维度标题 */}
      <div className="relative flex-shrink-0 pt-6 px-6 text-center">
        <div className="inline-block px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300/80 text-[10px] font-medium mb-3">
          {dimension.key?.replace(/_/g, ' ').toUpperCase() || cardT(language, 'comparison').toUpperCase()}
        </div>
        <h2
          className="font-bold text-2xl text-white mb-2"
          style={{
            letterSpacing: '-0.01em',
            fontSize: `${titleFontSize}px`,
            lineHeight: 1.2,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {title}
        </h2>
        {dimension.why_it_matters && (
          <p className="text-xs text-white/50 max-w-[90%] mx-auto leading-relaxed">
            {clampPosterText(dimension.why_it_matters, 100)}
          </p>
        )}
      </div>

      {/* 分数对比区 */}
      <div className="relative flex-1 flex flex-col justify-center px-6 py-4">
        {/* Entity A */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${isAWinner ? 'bg-indigo-400' : 'bg-white/30'}`}
              />
              <span
                className={`max-w-[300px] truncate text-sm font-medium ${isAWinner ? 'text-indigo-300' : 'text-white/60'}`}
              >
                {entityA}
              </span>
              {isAWinner && (
                <span className="text-[10px] text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded">
                  {cardT(language, 'wins')}
                </span>
              )}
            </div>
            <span
              className={`text-3xl font-bold ${isAWinner ? 'text-indigo-300' : 'text-white/40'}`}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatPosterScore(scoreA)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${barWidthA}%`,
                background: isAWinner
                  ? 'linear-gradient(90deg, #818cf8 0%, #a78bfa 100%)'
                  : 'linear-gradient(90deg, #6366f1 0%, #818cf8 100%)',
                opacity: isAWinner ? 1 : 0.5,
              }}
            />
          </div>
        </div>

        {/* VS 分隔 */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-xs text-white/30 font-medium">VS</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Entity B */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${isBWinner ? 'bg-purple-400' : 'bg-white/30'}`}
              />
              <span
                className={`max-w-[300px] truncate text-sm font-medium ${isBWinner ? 'text-purple-300' : 'text-white/60'}`}
              >
                {entityB}
              </span>
              {isBWinner && (
                <span className="text-[10px] text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded">
                  {cardT(language, 'wins')}
                </span>
              )}
            </div>
            <span
              className={`text-3xl font-bold ${isBWinner ? 'text-purple-300' : 'text-white/40'}`}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatPosterScore(scoreB)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${barWidthB}%`,
                background: isBWinner
                  ? 'linear-gradient(90deg, #c084fc 0%, #e879f9 100%)'
                  : 'linear-gradient(90deg, #a855f7 0%, #c084fc 100%)',
                opacity: isBWinner ? 1 : 0.5,
              }}
            />
          </div>
        </div>

        {/* 差距指示 */}
        {!isTie && diff !== null && (
          <div className="text-center">
            <span className="text-xs text-white/40">
              {cardT(language, 'gap')}{' '}
              <span className="text-indigo-300/80 font-semibold">
                {diff.toFixed(1)}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* 详细分析区 */}
      <div className="relative flex-shrink-0 px-6 pb-4">
        {dimension.analysis?.key_difference && (
          <div
            className="p-4 rounded-xl bg-white/5 border border-white/10 mb-3"
          >
            <div className="text-[10px] text-indigo-300/60 font-semibold uppercase tracking-wider mb-2">
              {cardT(language, 'keyDifference')}
            </div>
            <p className="text-sm text-white/80 leading-relaxed">
              {clampPosterText(dimension.analysis.key_difference, 180)}
            </p>
          </div>
        )}

        {/* 双方分析 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
            <div className="text-[10px] text-indigo-300/80 font-medium mb-1 truncate">
              {entityA}
            </div>
            <p className="text-xs text-white/60 leading-relaxed line-clamp-3">
              {clampPosterText(dimension.analysis?.item_a_summary, 150) || cardT(language, 'noAnalysis')}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <div className="text-[10px] text-purple-300/80 font-medium mb-1 truncate">
              {entityB}
            </div>
            <p className="text-xs text-white/60 leading-relaxed line-clamp-3">
              {clampPosterText(dimension.analysis?.item_b_summary, 150) || cardT(language, 'noAnalysis')}
            </p>
          </div>
        </div>
      </div>

      {/* 底部品牌 */}
      <div
        className="relative flex-shrink-0 flex items-center justify-between px-6 py-3"
        style={{
          background: 'rgba(0,0,0,0.3)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div className="text-xs font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
          CompareAI
        </div>
        <div className="max-w-[360px] truncate text-[10px] text-white/30">{url}</div>
      </div>
    </div>
  );
};

export default DimensionCard;
