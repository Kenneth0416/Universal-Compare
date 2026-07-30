import React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
  Legend
} from 'recharts';
import { ComparisonResult } from '../services/geminiService';
import { useTranslation } from 'react-i18next';
import { normalizeComparisonScore, stableDimensionKeys } from './poster/posterUtils';

interface DimensionChartProps {
  dimensions: ComparisonResult['dimensions'];
  entityA: string;
  entityB: string;
}

export const DimensionChart: React.FC<DimensionChartProps> = ({ dimensions, entityA, entityB }) => {
  const { t } = useTranslation();
  const safeDimensions = Array.isArray(dimensions) ? dimensions : [];
  const dimensionKeys = stableDimensionKeys(safeDimensions);

  const angleTick = (props: any) => {
    const { payload, x, y, textAnchor } = props;
    return (
      <text
        x={x}
        y={y}
        textAnchor={textAnchor}
        dominantBaseline="central"
        className="fill-white/70 text-[10px] sm:text-[12px] font-mono"
      >
        {payload.value}
      </text>
    );
  };

  if (safeDimensions.length === 0 || !entityA || !entityB) {
    return null;
  }

  const data = safeDimensions.map((dim) => {
    const scoreA = dim.analysis?.optional_score_a;
    const scoreB = dim.analysis?.optional_score_b;

    return {
      subject: dim.label,
      scoreA: normalizeComparisonScore(scoreA),
      scoreB: normalizeComparisonScore(scoreB),
      fullMark: 10,
    };
  });

  return (
    <div className="w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/50">
      <h3 className="text-xl font-bold text-white mb-8">{t('result.multidimensionalAnalysis')}</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        {/* Radar Chart */}
        <div className="h-[280px] sm:h-[350px] lg:h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%" minWidth={240} minHeight={240}>
            <RadarChart cx="50%" cy="50%" outerRadius="65%" data={data}>
              <PolarGrid stroke="rgba(255,255,255,0.1)" />
              <PolarAngleAxis 
                dataKey="subject" 
                tick={angleTick}
              />
              <PolarRadiusAxis 
                angle={30} 
                domain={[0, 10]} 
                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{ 
                  backgroundColor: 'rgba(15, 15, 15, 0.95)', 
                  borderColor: 'rgba(255,255,255,0.1)', 
                  borderRadius: '12px', 
                  color: '#fff',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                  fontFamily: 'Inter'
                }}
                itemStyle={{ fontWeight: 500 }}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '20px', fontFamily: 'Inter', fontSize: '14px', color: 'rgba(255,255,255,0.8)' }}
                iconType="circle"
              />
              <Radar
                name={entityA}
                dataKey="scoreA"
                stroke="#818cf8"
                fill="#818cf8"
                fillOpacity={0.4}
              />
              <Radar
                name={entityB}
                dataKey="scoreB"
                stroke="#c084fc"
                fill="#c084fc"
                fillOpacity={0.4}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Score Table */}
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[500px] text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="py-3 px-4 text-xs font-medium text-neutral-400 uppercase tracking-wider font-mono">{t('result.dimension')}</th>
                <th className="py-3 px-4 text-xs font-medium text-indigo-300 uppercase tracking-wider font-mono text-center">{entityA}</th>
                <th className="py-3 px-4 text-xs font-medium text-purple-300 uppercase tracking-wider font-mono text-center">{entityB}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {safeDimensions.map((dim, idx) => {
                const rawScoreA = dim.analysis?.optional_score_a;
                const rawScoreB = dim.analysis?.optional_score_b;
                const scoreA = normalizeComparisonScore(rawScoreA);
                const scoreB = normalizeComparisonScore(rawScoreB);
                const hasBothScores = scoreA !== null && scoreB !== null;
                const isAWinner = hasBothScores && scoreA > scoreB;
                const isBWinner = hasBothScores && scoreB > scoreA;
                const isTie = hasBothScores && scoreA === scoreB;

                return (
                  <tr key={dimensionKeys[idx]} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4 text-sm text-white font-medium">{dim.label}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-md text-sm font-mono ${
                        isAWinner ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 
                        isTie ? 'text-neutral-300' : 'text-neutral-500'
                      }`}>
                        {scoreA === null ? '—' : scoreA.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-md text-sm font-mono ${
                        isBWinner ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 
                        isTie ? 'text-neutral-300' : 'text-neutral-500'
                      }`}>
                        {scoreB === null ? '—' : scoreB.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
