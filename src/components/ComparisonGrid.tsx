import React from 'react';

interface ComparisonGridProps {
  children: React.ReactNode;
}

export const ComparisonGrid: React.FC<ComparisonGridProps> = ({ children }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {children}
    </div>
  );
};
