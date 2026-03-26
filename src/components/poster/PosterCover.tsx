/**
 * PosterCover - 小红书风格封面海报
 * 集成雷达图、渐变背景、品牌元素
 */
import React, { useEffect, useState, useRef } from 'react';
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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value);

export const PosterCover: React.FC<PosterCoverProps> = ({
  result,
  width = 540,
  height = 720,
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

  const winner = avgA > avgB ? result.entityA.name : avgB > avgA ? result.entityB.name : null;
  const loser = avgA > avgB ? result.entityB.name : avgB > avgA ? result.entityA.name : null;

  // 雷达图数据
  const radarData = result.dimensions.map((dim) => ({
    subject: dim.label.length > 8 ? dim.label.substring(0, 8) + '...' : dim.label,
    [result.entityA.name]: isFiniteNumber(dim.analysis?.optional_score_a) ? dim.analysis!.optional_score_a : 0,
    [result.entityB.name]: isFiniteNumber(dim.analysis?.optional_score_b) ? dim.analysis!.optional_score_b : 0,
  }));

  if (!mounted) return null;

  return (
    <div
      id="poster-cover"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        background: 'linear-gradient(145deg, #0f0a1e 0%, #1a1040 50%, #0d0620 100%)',
        fontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", -apple-system, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
      className="flex flex-col text-white"
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
      <div className="relative flex-shrink-0 pt-6 px-6">
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
          <div className="px-3 py-1 rounded-full bg-white/10 text-[10px] text-white/70 font-medium">
            {result.dimensions.length} 维度对比
          </div>
        </div>
      </div>

      {/* 主标题区 */}
      <div className="relative flex-shrink-0 pt-6 px-6 text-center">
        <h1
          className="font-bold leading-tight mb-3"
          style={{ fontSize: '28px', letterSpacing: '-0.02em' }}
        >
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300">
            {result.entityA.name}
          </span>
          <span className="text-white/40 mx-3 font-light">VS</span>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-300 via-purple-300 to-indigo-300">
            {result.entityB.name}
          </span>
        </h1>

        {result.recommendation?.short_verdict && (
          <p className="text-sm text-white/70 max-w-[90%] mx-auto leading-relaxed">
            {result.recommendation.short_verdict}
          </p>
        )}
      </div>

      {/* 分数对比 + 雷达图 */}
      <div className="relative flex-1 flex items-center justify-center gap-4 px-6 py-4">
        {/* Entity A 分数 */}
        <div className="flex flex-col items-center">
          <div
            className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-indigo-400 to-indigo-600"
            style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}
          >
            {avgA.toFixed(1)}
          </div>
          <div className="text-[10px] text-indigo-300/80 mt-1 font-medium max-w-[80px] text-center truncate">
            {result.entityA.name}
          </div>
        </div>

        {/* 雷达图 */}
        <div
          className="flex items-center justify-center"
          style={{
            width: '160px',
            height: '160px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <MiniRadarChart
            data={radarData}
            entityA={result.entityA.name}
            entityB={result.entityB.name}
            size={140}
          />
        </div>

        {/* Entity B 分数 */}
        <div className="flex flex-col items-center">
          <div
            className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-purple-400 to-pink-600"
            style={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}
          >
            {avgB.toFixed(1)}
          </div>
          <div className="text-[10px] text-purple-300/80 mt-1 font-medium max-w-[80px] text-center truncate">
            {result.entityB.name}
          </div>
        </div>
      </div>

      {/* 推荐标签 */}
      {winner && (
        <div className="relative flex-shrink-0 flex justify-center pb-4">
          <div
            className="flex items-center gap-2 px-5 py-2 rounded-full"
            style={{
              background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.15) 0%, rgba(16, 185, 129, 0.1) 100%)',
              border: '1px solid rgba(52, 211, 153, 0.3)',
              boxShadow: '0 4px 20px rgba(52, 211, 153, 0.15)',
            }}
          >
            <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <span className="text-emerald-300 text-sm font-semibold">
              推荐 {winner}
            </span>
            {loser && (
              <span className="text-white/40 text-xs">
                优于 {loser}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 底部品牌区 */}
      <div
        className="relative flex-shrink-0 flex items-center justify-between px-6 py-4"
        style={{
          background: 'rgba(0,0,0,0.3)',
          backdropFilter: 'blur(10px)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div className="flex items-center gap-3">
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
          <div className="text-[10px] text-white/40 leading-tight">
            <div>AI-powered comparison</div>
            <div className="text-white/30">{url}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-[10px] text-white/50">扫码体验</div>
            <div className="text-[10px] text-white/30">生成你的对比</div>
          </div>
          <div
            className="p-1.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.95)' }}
          >
            <QRCodeCanvas
              value={url}
              size={48}
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
