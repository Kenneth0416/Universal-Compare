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

interface DimensionChartProps {
  dimensions: ComparisonResult['dimensions'];
  entityA: string;
  entityB: string;
}

export const DimensionChart: React.FC<DimensionChartProps> = ({ dimensions, entityA, entityB }) => {
  const data = dimensions.map(dim => ({
    subject: dim.label,
    [entityA]: dim.analysis.optional_score_a || 0,
    [entityB]: dim.analysis.optional_score_b || 0,
    fullMark: 10,
  }));

  return (
    <div className="w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/50">
      <h3 className="text-xl font-bold text-white mb-8">Multidimensional Analysis</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        {/* Radar Chart */}
        <div className="h-[350px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
              <PolarGrid stroke="rgba(255,255,255,0.1)" />
              <PolarAngleAxis 
                dataKey="subject" 
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: 'JetBrains Mono' }} 
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
                dataKey={entityA}
                stroke="#818cf8"
                fill="#818cf8"
                fillOpacity={0.4}
              />
              <Radar
                name={entityB}
                dataKey={entityB}
                stroke="#c084fc"
                fill="#c084fc"
                fillOpacity={0.4}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Score Table */}
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="py-3 px-4 text-xs font-medium text-neutral-400 uppercase tracking-wider font-mono">Dimension</th>
                <th className="py-3 px-4 text-xs font-medium text-indigo-300 uppercase tracking-wider font-mono text-center">{entityA}</th>
                <th className="py-3 px-4 text-xs font-medium text-purple-300 uppercase tracking-wider font-mono text-center">{entityB}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {dimensions.map((dim, idx) => {
                const scoreA = dim.analysis.optional_score_a || 0;
                const scoreB = dim.analysis.optional_score_b || 0;
                const isAWinner = scoreA > scoreB;
                const isBWinner = scoreB > scoreA;
                const isTie = scoreA === scoreB;

                return (
                  <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4 text-sm text-white font-medium">{dim.label}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-md text-sm font-mono ${
                        isAWinner ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 
                        isTie ? 'text-neutral-300' : 'text-neutral-500'
                      }`}>
                        {scoreA.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-md text-sm font-mono ${
                        isBWinner ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 
                        isTie ? 'text-neutral-300' : 'text-neutral-500'
                      }`}>
                        {scoreB.toFixed(1)}
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
