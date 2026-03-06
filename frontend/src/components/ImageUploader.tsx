'use client';

import { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, ImagePlus, Loader2 } from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_SIZE } from '@/lib/constants';

interface ImageUploaderProps {
  onUpload: (file: File) => void;
  loading: boolean;
}

export function ImageUploader({ onUpload, loading }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      if (file.size > MAX_IMAGE_SIZE) return;
      onUpload(file);
    },
    [onUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="mx-auto max-w-2xl"
    >
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
        className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed
          p-20 text-center transition-all duration-300
          ${
            dragOver
              ? 'border-cyan-400/60 bg-cyan-500/[0.05]'
              : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]'
          }`}
      >
        {/* 网格背景 */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />

        {/* 角落发光装饰 */}
        <div className="pointer-events-none absolute -top-20 -right-20 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl transition-opacity group-hover:opacity-100 opacity-0" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-40 w-40 rounded-full bg-purple-500/10 blur-3xl transition-opacity group-hover:opacity-100 opacity-0" />

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex flex-col items-center gap-4"
            >
              <Loader2 className="h-12 w-12 text-cyan-400 animate-spin" />
              <p className="text-sm font-medium text-cyan-400">
                正在上传并计算 embedding...
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-5"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
                {dragOver ? (
                  <ImagePlus className="h-8 w-8 text-cyan-400" />
                ) : (
                  <Upload className="h-8 w-8 text-white/30 transition-colors group-hover:text-white/50" />
                )}
              </div>
              <div>
                <p className="text-base font-medium text-white/60 group-hover:text-white/80 transition-colors">
                  拖拽图片到此处，或点击上传
                </p>
                <p className="mt-2 text-xs text-white/25">
                  支持 JPG / PNG / WebP · 最大 10MB
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
