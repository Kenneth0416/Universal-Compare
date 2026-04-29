/**
 * PosterCover - 小红书风格封面海报
 * 集成雷达图、渐变背景、品牌元素
 */
import React, { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { ComparisonResult } from '../../services/geminiService';
import { MiniRadarChart } from './MiniRadarChart';

interface PosterCoverProps {
  result: ComparisonResult;
  /** 设计宽度 (px) - 渲染时 2x */
  width?: number;
  /** 设计高度 (px) - 渲染时 2x */
  height?: number;
}

const POSTER_WIDTH = 540;
const POSTER_HEIGHT = 720;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value);

const containsCjk = (value: string) => /[\u3400-\u9fff]/.test(value);

const compactPosterLabel = (label: string): string => {
  const normalized = label
    .replace(/\([^)]*\)/g, '')
    .replace(/\bSuitability for\b/gi, '')
    .replace(/\bProcessing Power\b/gi, 'Power')
    .replace(/\bOS Capabilities and Multitasking\b/gi, 'OS Multitask')
    .replace(/\bDisplay Quality and Features\b/gi, 'Display Quality')
    .replace(/\bInput Methods and Accessories\b/gi, 'Input Methods')
    .replace(/\bPortability and Battery Life\b/gi, 'Battery Life')
    .replace(/\bProfessional\b/gi, 'Pro')
    .replace(/\bWorkloads\b/gi, 'Work')
    .replace(/\bMultitasking\b/gi, 'Multitask')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return label;
  }

  if (containsCjk(normalized)) {
    const chars = Array.from(normalized.replace(/\s+/g, ''));
    if (chars.length <= 4) {
      return normalized;
    }
    if (chars.length <= 8) {
      return `${chars.slice(0, 4).join('')}\n${chars.slice(4).join('')}`;
    }
    return `${chars.slice(0, 4).join('')}\n${chars.slice(4, 8).join('')}`;
  }

  const words = normalized.split(' ').filter(Boolean);
  if (words.length <= 1) {
    return normalized;
  }
  if (words.length === 2) {
    return `${words[0]}\n${words[1]}`;
  }

  const midpoint = Math.ceil(words.length / 2);
  return `${words.slice(0, midpoint).join(' ')}\n${words.slice(midpoint).join(' ')}`;
};

const flattenPosterLabel = (label: string): string =>
  label.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

const clampPosterText = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}…`;

const normalizePosterUrl = (value: string): string => {
  try {
    return new URL(value).href.replace(/^https?:\/\//, '');
  } catch {
    return value.replace(/^https?:\/\//, '');
  }
};

const splitPosterUrl = (value: string): string[] => {
  if (value.length <= 34) {
    return [value];
  }

  const slashIndex = value.indexOf('/', 24);
  if (slashIndex > 0 && slashIndex < 42) {
    return [value.slice(0, slashIndex), value.slice(slashIndex)];
  }

  return [value.slice(0, 34), value.slice(34, 68)];
};

export const PosterCover: React.FC<PosterCoverProps> = ({
  result,
  width = POSTER_WIDTH,
  height = POSTER_HEIGHT,
}) => {
  const [mounted, setMounted] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    setMounted(true);
    setUrl(window.location.href);
  }, []);

  // 计算数据
  const totalA = result.dimensions.reduce(
    (sum, dim) => sum + (isFiniteNumber(dim.analysis?.optional_score_a) ? dim.analysis!.optional_score_a : 0),
    0
  );
  const totalB = result.dimensions.reduce(
    (sum, dim) => sum + (isFiniteNumber(dim.analysis?.optional_score_b) ? dim.analysis!.optional_score_b : 0),
    0
  );
  const avgA = result.dimensions.length > 0 ? totalA / result.dimensions.length : 0;
  const avgB = result.dimensions.length > 0 ? totalB / result.dimensions.length : 0;

  const posterWidth = width || POSTER_WIDTH;
  const posterHeight = height || POSTER_HEIGHT;
  const winner = avgA > avgB ? result.entityA.name : avgB > avgA ? result.entityB.name : null;
  const loser = avgA > avgB ? result.entityB.name : avgB > avgA ? result.entityA.name : null;
  const entityADisplay = clampPosterText(result.entityA.name, 18);
  const entityBDisplay = clampPosterText(result.entityB.name, 18);
  const titleFontSize = Math.max(
    20,
    26 - Math.max(entityADisplay.length + entityBDisplay.length - 22, 0) * 0.35
  );
  const verdict = result.recommendation?.short_verdict
    ? clampPosterText(result.recommendation.short_verdict, 86)
    : '';
  const accessUrl = normalizePosterUrl(url);
  const accessUrlLines = splitPosterUrl(accessUrl);

  const dimensionLegend = result.dimensions.map((dim, index) => {
    const shortLabel = compactPosterLabel(dim.label);
    const legendLabel = clampPosterText(flattenPosterLabel(shortLabel), 22);

    return {
      index: index + 1,
      legendLabel,
      chartLabel: String(index + 1),
      scoreA: isFiniteNumber(dim.analysis?.optional_score_a) ? dim.analysis!.optional_score_a : 0,
      scoreB: isFiniteNumber(dim.analysis?.optional_score_b) ? dim.analysis!.optional_score_b : 0,
    };
  });

  const radarData = dimensionLegend.map((dim) => ({
    subject: dim.chartLabel,
    [result.entityA.name]: dim.scoreA,
    [result.entityB.name]: dim.scoreB,
  }));

  if (!mounted) return null;

  return (
    <div
      id="poster-cover"
      style={{
        width: `${posterWidth}px`,
        height: `${posterHeight}px`,
        minWidth: `${posterWidth}px`,
        maxWidth: `${posterWidth}px`,
        minHeight: `${posterHeight}px`,
        maxHeight: `${posterHeight}px`,
        background: 'linear-gradient(145deg, #0f0a1e 0%, #1a1040 50%, #0d0620 100%)',
        fontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", -apple-system, sans-serif',
        position: 'relative',
        overflow: 'hidden',
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateRows: '44px 104px 64px 286px 132px 90px',
      }}
      className="text-white"
    >
      {/* 背景装饰 - 渐变光晕 */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-20%',
          left: '-10%',
          width: '60%',
          height: '60%',
          background: 'radial-gradient(circle, rgba(129, 140, 248, 0.15) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          bottom: '-10%',
          right: '-10%',
          width: '50%',
          height: '50%',
          background: 'radial-gradient(circle, rgba(192, 132, 252, 0.12) 0%, transparent 70%)',
        }}
      />

      {/* 顶部标签 */}
      <div className="relative pt-3.5 px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center"
              style={{ boxShadow: '0 4px 20px rgba(129, 140, 248, 0.4)' }}
            >
              <span className="text-white font-bold text-sm">AI</span>
            </div>
            <span className="text-xs text-white/60 font-medium tracking-wider">
              COMPARE
            </span>
          </div>
          <div
            className="px-3 py-1 rounded-full text-[10px] text-white/75 font-semibold"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            {dimensionLegend.length} 维度总览
          </div>
        </div>
      </div>

      {/* 主标题区 */}
      <div className="relative px-6 pt-2 text-center overflow-hidden">
        <div className="text-[10px] uppercase tracking-[0.28em] text-white/35 mb-2">
          Visual Comparison Poster
        </div>
        <div
          className="font-bold mb-2.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1"
          style={{ fontSize: `${titleFontSize}px`, lineHeight: 1.08, letterSpacing: '-0.025em' }}
        >
          <span className="max-w-[190px] truncate text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300">
            {entityADisplay}
          </span>
          <span className="text-white/38 tracking-[0.28em]" style={{ fontSize: '0.48em' }}>
            VS
          </span>
          <span className="max-w-[190px] truncate text-transparent bg-clip-text bg-gradient-to-r from-pink-300 via-purple-300 to-indigo-300">
            {entityBDisplay}
          </span>
        </div>

        {winner && (
          <div
            className="inline-flex items-center gap-2 px-4 py-1 rounded-full mb-2"
            style={{
              background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.16) 0%, rgba(16, 185, 129, 0.1) 100%)',
              border: '1px solid rgba(52, 211, 153, 0.3)',
              boxShadow: '0 4px 18px rgba(52, 211, 153, 0.12)',
            }}
          >
            <span className="text-[10px] uppercase tracking-[0.22em] text-emerald-200/70">Winner</span>
            <span className="text-sm font-semibold text-emerald-300">{winner}</span>
            {loser && (
              <span className="text-[10px] text-white/38">vs {loser}</span>
            )}
          </div>
        )}

        {verdict && (
          <p
            className="text-[10px] text-white/68 max-w-[86%] mx-auto leading-[1.45]"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {verdict}
          </p>
        )}
      </div>

      {/* 顶部评分卡 */}
      <div className="relative px-6 pt-0.5 overflow-hidden">
        <div className="grid grid-cols-2 gap-3">
          <div
            className="rounded-2xl px-4 py-2"
            style={{
              background: 'linear-gradient(180deg, rgba(99, 102, 241, 0.18) 0%, rgba(15, 23, 42, 0.18) 100%)',
              border: '1px solid rgba(129, 140, 248, 0.22)',
              boxShadow: '0 10px 28px rgba(67, 56, 202, 0.12)',
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.22em] text-indigo-200/55 mb-2">
              Average Score
            </div>
            <div
              className="text-[34px] font-black text-transparent bg-clip-text bg-gradient-to-b from-indigo-300 to-indigo-500"
              style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}
            >
              {avgA.toFixed(1)}
            </div>
            <div className="mt-1 text-[11px] text-indigo-100/86 font-medium truncate">
              {result.entityA.name}
            </div>
          </div>
          <div
            className="rounded-2xl px-4 py-2"
            style={{
              background: 'linear-gradient(180deg, rgba(192, 132, 252, 0.18) 0%, rgba(15, 23, 42, 0.18) 100%)',
              border: '1px solid rgba(192, 132, 252, 0.22)',
              boxShadow: '0 10px 28px rgba(168, 85, 247, 0.12)',
            }}
          >
            <div className="text-[10px] uppercase tracking-[0.22em] text-purple-200/55 mb-2">
              Average Score
            </div>
            <div
              className="text-[34px] font-black text-transparent bg-clip-text bg-gradient-to-b from-purple-300 to-pink-500"
              style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}
            >
              {avgB.toFixed(1)}
            </div>
            <div className="mt-1 text-[11px] text-purple-100/86 font-medium truncate">
              {result.entityB.name}
            </div>
          </div>
        </div>
      </div>

      {/* 雷达图主视觉 */}
      <div className="relative px-6 pt-1 overflow-hidden">
        <div
          className="mx-auto relative flex items-center justify-center"
          style={{
            width: '312px',
            height: '276px',
          }}
        >
          <div
            className="absolute inset-0 rounded-[36px]"
            style={{
              background: 'radial-gradient(circle at 50% 38%, rgba(99, 102, 241, 0.18) 0%, rgba(17, 24, 39, 0.08) 48%, rgba(255, 255, 255, 0.02) 100%)',
              border: '1px solid rgba(255,255,255,0.09)',
              boxShadow: '0 20px 50px rgba(6, 8, 24, 0.45)',
            }}
          />
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full"
            style={{
              background: 'rgba(7,10,26,0.58)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <span className="text-[10px] tracking-[0.24em] uppercase text-white/46">
              Radar Overview
            </span>
          </div>
          <MiniRadarChart
            data={radarData}
            entityA={result.entityA.name}
            entityB={result.entityB.name}
            size={270}
          />
        </div>
      </div>

      {/* 维度图例 */}
      <div className="relative px-6 pt-1.5 overflow-hidden">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-[0.22em] text-white/42">
            Axis Legend
          </div>
          <div className="text-[10px] text-white/30">
            图上以编号显示维度
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {dimensionLegend.map((dim) => (
            <div
              key={dim.index}
              className="rounded-2xl px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.045)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{
                    background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.9) 0%, rgba(192, 132, 252, 0.9) 100%)',
                    color: '#ffffff',
                  }}
                >
                  {dim.index}
                </div>
                <div className="min-w-0">
                  <div
                    className="text-[10px] text-white/88 font-semibold leading-[1.2]"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {dim.legendLabel}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 底部访问区 */}
      <div
        className="relative flex items-center justify-between px-6 py-3 overflow-hidden"
        style={{
          background: 'rgba(5,8,22,0.5)',
          backdropFilter: 'blur(10px)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div className="flex items-start gap-3 min-w-0 pr-3">
          <div
            className="text-xl font-bold"
            style={{
              background: 'linear-gradient(135deg, #818cf8 0%, #c084fc 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            CompareAI
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/48 mb-1">
              Scan Or Visit
            </div>
            <div className="text-[10px] text-white/72 leading-[1.35]">
              用二维码打开，或直接访问下方网址
            </div>
            <div
              className="mt-1 text-[9px] text-white/40 font-mono leading-[1.3]"
              style={{ wordBreak: 'break-all' }}
            >
              {accessUrlLines.map((line, index) => (
                <div key={`${line}-${index}`}>{line}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div
            className="p-1.5 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.95)' }}
          >
            <QRCodeCanvas
              value={url}
              size={56}
              bgColor="transparent"
              fgColor="#1a1a2e"
              level="M"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PosterCover;
