'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import type { MaskResult } from '@/types';
import { MASK_COLORS } from '@/lib/constants';

interface MaskListProps {
  masks: MaskResult[];
  onRemove: (index: number) => void;
}

function formatArea(area: number): string {
  if (area >= 1_000_000) return `${(area / 1_000_000).toFixed(1)}M px`;
  if (area >= 1_000) return `${(area / 1_000).toFixed(1)}K px`;
  return `${area} px`;
}

export function MaskList({ masks, onRemove }: MaskListProps) {
  return (
    <div className="space-y-2">
      <AnimatePresence>
        {masks.map((mask, i) => {
          const color = MASK_COLORS[i % MASK_COLORS.length];
          const rgbStr = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;

          return (
            <motion.div
              key={`${i}-${mask.score}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="group flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.03]
                px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
            >
              <div
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: rgbStr, boxShadow: `0 0 8px ${rgbStr}` }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/70">
                  区域 {i + 1}
                </p>
                <p className="text-[10px] text-white/30 mt-0.5">
                  置信度 {(mask.score * 100).toFixed(1)}% · {formatArea(mask.area)}
                </p>
              </div>
              <button
                onClick={() => onRemove(i)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md
                  text-white/20 opacity-0 transition-all group-hover:opacity-100
                  hover:bg-white/[0.08] hover:text-white/50"
              >
                <X className="h-3 w-3" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
