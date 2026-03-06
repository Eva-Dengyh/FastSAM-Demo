'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/Header';
import { ImageUploader } from '@/components/ImageUploader';
import { SegmentCanvas } from '@/components/SegmentCanvas';
import { ControlPanel } from '@/components/ControlPanel';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { useSegmentation } from '@/hooks/useSegmentation';

export default function Home() {
  const connected = useHealthCheck();
  const {
    imageUrl,
    imageSize,
    masks,
    loading,
    error,
    upload,
    segment,
    clearMasks,
    removeMask,
    reset,
    clearError,
  } = useSegmentation();

  const hasImage = !!imageUrl && !!imageSize;

  return (
    <div className="flex min-h-screen flex-col">
      <Header connected={connected} />

      <main className="flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          {/* 错误提示 */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mx-auto mb-6 max-w-2xl"
              >
                <div
                  className="flex items-center justify-between rounded-lg border border-red-500/20
                    bg-red-500/[0.08] px-4 py-3 text-sm text-red-400"
                >
                  <span>{error}</span>
                  <button
                    onClick={clearError}
                    className="ml-4 text-red-400/60 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {!hasImage ? (
              <ImageUploader
                key="uploader"
                onUpload={upload}
                loading={loading}
              />
            ) : (
              <motion.div
                key="workspace"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]"
              >
                <SegmentCanvas
                  imageUrl={imageUrl}
                  imageSize={imageSize}
                  masks={masks}
                  onPointClick={segment}
                  loading={loading}
                />
                <ControlPanel
                  masks={masks}
                  onClear={clearMasks}
                  onReset={reset}
                  onRemoveMask={removeMask}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] px-6 py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-3">
          {['Next.js', 'TypeScript', 'Tailwind CSS', 'FastAPI', 'SAM 2.1'].map(
            (tech) => (
              <span
                key={tech}
                className="rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1
                  text-[10px] font-medium tracking-wide text-white/25"
              >
                {tech}
              </span>
            ),
          )}
        </div>
      </footer>
    </div>
  );
}
