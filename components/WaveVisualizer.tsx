import React from 'react';

export const WaveVisualizer: React.FC<{ isRecording: boolean }> = ({ isRecording }) => {
  if (!isRecording) return null;

  return (
    <div className="flex items-center justify-center space-x-1 h-12">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="w-1 bg-rose-500 rounded-full animate-pulse"
          style={{
            height: `${Math.random() * 100}%`,
            animationDuration: `${0.5 + Math.random() * 0.5}s`
          }}
        />
      ))}
    </div>
  );
};