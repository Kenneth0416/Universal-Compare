import React from 'react';

type MinimalGridProps = {
  className?: string;
};

export default function MinimalGrid({ className = '' }: MinimalGridProps) {
  return (
    <div className={`fixed inset-0 -z-10 pointer-events-none ${className}`}>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            'radial-gradient(70% 55% at 50% 18%, rgba(122, 110, 198, 0.22) 0%, rgba(66, 70, 112, 0.22) 45%, rgba(8, 10, 16, 0.92) 100%)',
            'linear-gradient(180deg, rgba(10, 11, 18, 0.96) 0%, rgba(7, 8, 12, 0.98) 100%)',
          ].join(', '),
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage: [
            'repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.04) 0px, rgba(255, 255, 255, 0.04) 1px, transparent 1px, transparent 56px)',
            'repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.035) 0px, rgba(255, 255, 255, 0.035) 1px, transparent 1px, transparent 56px)',
          ].join(', '),
        }}
      />
    </div>
  );
}
