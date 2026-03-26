/**
 * MiniRadarChart - 专为海报优化的紧凑雷达图
 * 使用 Recharts，确保与 html-to-image 完美兼容
 */
import React from 'react';
import {
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';

interface MiniRadarChartProps {
  data: Array<{
    subject: string;
    [key: string]: string | number;
  }>;
  entityA: string;
  entityB: string;
  size?: number;
}

export const MiniRadarChart: React.FC<MiniRadarChartProps> = ({
  data,
  entityA,
  entityB,
  size = 200,
}) => {
  return (
    <ResponsiveContainer width={size} height={size}>
      <RechartsRadarChart cx="50%" cy="50%" outerRadius="70%">
        <PolarGrid
          stroke="rgba(255,255,255,0.15)"
          strokeDasharray="3 3"
        />
        <PolarAngleAxis
          dataKey="subject"
          tick={{
            fill: 'rgba(255,255,255,0.7)',
            fontSize: 9,
            fontFamily: 'system-ui',
          }}
        />
        <PolarRadiusAxis
          angle={30}
          domain={[0, 10]}
          tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 8 }}
          axisLine={false}
        />
        <Radar
          name={entityA}
          dataKey={entityA}
          stroke="#818cf8"
          fill="#818cf8"
          fillOpacity={0.5}
          strokeWidth={2}
        />
        <Radar
          name={entityB}
          dataKey={entityB}
          stroke="#c084fc"
          fill="#c084fc"
          fillOpacity={0.5}
          strokeWidth={2}
        />
      </RechartsRadarChart>
    </ResponsiveContainer>
  );
};

export default MiniRadarChart;
