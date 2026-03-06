'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import type { ImageSize, MaskResult } from '@/types';
import { MASK_COLORS } from '@/lib/constants';
import { getTransform, renderMask } from '@/lib/mask';

interface SegmentCanvasProps {
  imageUrl: string;
  imageSize: ImageSize;
  masks: MaskResult[];
  onPointClick: (x: number, y: number) => void;
  loading: boolean;
}

export function SegmentCanvas({
  imageUrl,
  imageSize,
  masks,
  onPointClick,
  loading,
}: SegmentCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasReady, setCanvasReady] = useState(false);

  const setupCanvas = useCallback(() => {
    if (!containerRef.current || !imageSize) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const containerWidth = containerRef.current.clientWidth;
    canvas.width = containerWidth;
    canvas.height = containerWidth * (imageSize.height / imageSize.width);
    setCanvasReady(true);
  }, [imageSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete || !imageSize || !canvasReady) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const transform = getTransform(canvas.width, canvas.height, imageSize);
    const drawW = imageSize.width * transform.scale;
    const drawH = imageSize.height * transform.scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, transform.ox, transform.oy, drawW, drawH);

    masks.forEach((mask, i) => {
      renderMask(
        ctx,
        mask.rle,
        transform,
        MASK_COLORS[i % MASK_COLORS.length],
      );
    });
  }, [imageUrl, masks, imageSize, canvasReady]);

  // 窗口 resize 时重新绘制
  useEffect(() => {
    const handleResize = () => setupCanvas();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setupCanvas]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (loading || !imageSize) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height);
    const transform = getTransform(canvas.width, canvas.height, imageSize);
    const origX = Math.round((cx - transform.ox) / transform.scale);
    const origY = Math.round((cy - transform.oy) / transform.scale);

    if (
      origX >= 0 &&
      origX < imageSize.width &&
      origY >= 0 &&
      origY < imageSize.height
    ) {
      onPointClick(origX, origY);
    }
  };

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className="relative w-full"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt="uploaded"
        className="hidden"
        onLoad={setupCanvas}
      />
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className={`w-full rounded-xl border border-white/[0.08] shadow-2xl shadow-black/40
          ${loading ? 'cursor-wait' : 'cursor-crosshair'}`}
      />
      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30 backdrop-blur-sm"
        >
          <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/60 px-5 py-2.5">
            <Loader2 className="h-4 w-4 text-cyan-400 animate-spin" />
            <span className="text-sm text-white/70">分割中...</span>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
