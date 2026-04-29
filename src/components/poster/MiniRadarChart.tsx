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

const angleTick = (props: any) => {
  const { payload, x, y, textAnchor } = props;
  const lines = String(payload?.value || '')
    .split('\n')
    .filter(Boolean);
  const isIndexOnly = lines.length === 1 && /^\d+$/.test(lines[0]);
  const lineHeight = isIndexOnly ? 11 : 10;
  const startDy = lines.length > 1 ? -((lines.length - 1) * lineHeight) / 2 : 0;

  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fill="rgba(255,255,255,0.78)"
      fontSize={isIndexOnly ? 12.5 : 8.5}
      fontFamily="system-ui"
      fontWeight={isIndexOnly ? 700 : 500}
    >
      {lines.map((line, index) => (
        <tspan
          key={`${line}-${index}`}
          x={x}
          dy={index === 0 ? startDy : lineHeight}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
};

export const MiniRadarChart: React.FC<MiniRadarChartProps> = ({
  data,
  entityA,
  entityB,
  size = 200,
}) => {
  return (
    // 包裹容器確保導出圖片時能穩定捕獲 SVG
    <div
      style={{
        width: size,
        height: size,
        willChange: 'transform',
        transform: 'translateZ(0)',
      }}
    >
      <RechartsRadarChart
        cx={size / 2}
        cy={size / 2}
        outerRadius={size * 0.405}
        width={size}
        height={size}
        data={data}
        margin={{ top: 22, right: 22, bottom: 22, left: 22 }}
      >
        <PolarGrid
          stroke="rgba(255,255,255,0.12)"
          strokeDasharray="3 3"
        />
        <PolarAngleAxis
          dataKey="subject"
          tick={angleTick}
          tickLine={false}
        />
        <PolarRadiusAxis
          angle={30}
          domain={[0, 10]}
          tick={false}
          axisLine={false}
          tickCount={5}
        />
        <Radar
          name={entityA}
          dataKey={entityA}
          stroke="#818cf8"
          fill="#818cf8"
          fillOpacity={0.42}
          strokeWidth={2.25}
        />
        <Radar
          name={entityB}
          dataKey={entityB}
          stroke="#c084fc"
          fill="#c084fc"
          fillOpacity={0.42}
          strokeWidth={2.25}
        />
      </RechartsRadarChart>
    </div>
  );
};

export default MiniRadarChart;
