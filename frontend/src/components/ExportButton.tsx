'use client';

import { useState, useRef } from 'react';
import type { MaskResult } from '@/types';

interface ExportButtonProps {
  imageUrl: string;
  imageSize: { width: number; height: number };
  masks: MaskResult[];
  currentImageName: string;
}

const COLORS = [
  [239, 68, 68],    // red
  [249, 115, 22],   // orange
  [234, 179, 8],    // yellow
  [34, 197, 94],    // green
  [6, 182, 212],    // cyan
  [59, 130, 246],   // blue
  [168, 85, 247],   // purple
  [236, 72, 153],   // pink
];

export function ExportButton({ imageUrl, imageSize, masks, currentImageName }: ExportButtonProps) {
  const [showMenu, setShowMenu] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const exportImage = (mode: 'original' | 'overlay' | 'masks-only') => {
    setShowMenu(false);
    
    if (masks.length === 0 && mode !== 'original') {
      alert('没有分割结果可导出');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = imageSize.width;
    canvas.height = imageSize.height;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      // Draw original image first
      ctx.drawImage(img, 0, 0);

      if (mode !== 'original' && masks.length > 0) {
        // For overlay mode: draw all masks with transparency over original
        if (mode === 'overlay') {
          masks.forEach((mask, index) => {
            const [r, g, b] = COLORS[index % COLORS.length];
            const { counts, size } = mask.rle;
            const [h, w] = size;
            
            // Create mask image data
            const imgData = ctx.createImageData(w, h);
            let idx = 0;
            let val = 0;
            
            for (const count of counts) {
              for (let i = 0; i < count && idx < w * h; i++, idx++) {
                if (val === 1) {
                  const p = idx * 4;
                  // Draw with 50% opacity
                  imgData.data[p] = r;
                  imgData.data[p + 1] = g;
                  imgData.data[p + 2] = b;
                  imgData.data[p + 3] = 128; // 50% opacity
                }
              }
              val = 1 - val;
            }
            
            // Put mask data on a temp canvas then draw to main
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            const tempCtx = tempCanvas.getContext('2d');
            if (tempCtx) {
              tempCtx.putImageData(imgData, 0, 0);
              ctx.drawImage(tempCanvas, 0, 0);
            }
          });
        }
        
        // For masks-only mode: show all masks on black background
        if (mode === 'masks-only') {
          // Fill black background
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Draw each mask
          masks.forEach((mask, index) => {
            const [r, g, b] = COLORS[index % COLORS.length];
            const { counts, size } = mask.rle;
            const [h, w] = size;
            
            const imgData = ctx.createImageData(w, h);
            let idx = 0;
            let val = 0;
            
            for (const count of counts) {
              for (let i = 0; i < count && idx < w * h; i++, idx++) {
                if (val === 1) {
                  const p = idx * 4;
                  imgData.data[p] = r;
                  imgData.data[p + 1] = g;
                  imgData.data[p + 2] = b;
                  imgData.data[p + 3] = 255;
                }
              }
              val = 1 - val;
            }
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            const tempCtx = tempCanvas.getContext('2d');
            if (tempCtx) {
              tempCtx.putImageData(imgData, 0, 0);
              ctx.drawImage(tempCanvas, 0, 0);
            }
          });
        }
      }

      // Download
      const suffix = mode === 'original' ? 'original' : mode === 'overlay' ? 'overlay' : 'masks';
      const baseName = currentImageName.replace(/\.[^/.]+$/, '');
      const link = document.createElement('a');
      link.download = `${baseName}_${suffix}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    
    img.src = imageUrl;
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.08)',
          backgroundColor: 'rgba(255,255,255,0.04)',
          padding: '8px 12px',
          color: 'rgba(255,255,255,0.6)',
          fontSize: '14px',
          cursor: 'pointer',
          zIndex: 1000,
        }}
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        导出 ({masks.length}个掩码)
      </button>

      {showMenu && (
        <div 
          style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: '8px',
            width: '160px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.1)',
            backgroundColor: '#1a1a1a',
            padding: '6px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            zIndex: 1001,
          }}
        >
          {['original', 'overlay', 'masks-only'].map((mode) => (
            <button
              key={mode}
              onClick={() => exportImage(mode as any)}
              style={{
                display: 'block',
                width: '100%',
                borderRadius: '6px',
                padding: '10px 12px',
                textAlign: 'left',
                fontSize: '14px',
                color: 'rgba(255,255,255,0.8)',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              {mode === 'original' ? '原图' : mode === 'overlay' ? '叠加效果' : '仅掩码'}
            </button>
          ))}
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}