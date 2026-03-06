'use client';

import { motion } from 'framer-motion';
import { Trash2, RotateCcw, MousePointerClick, Layers } from 'lucide-react';
import type { MaskResult } from '@/types';
import { MaskList } from './MaskList';

interface ControlPanelProps {
  masks: MaskResult[];
  onClear: () => void;
  onReset: () => void;
  onRemoveMask: (index: number) => void;
}

export function ControlPanel({
  masks,
  onClear,
  onReset,
  onRemoveMask,
}: ControlPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="flex flex-col gap-4"
    >
      {/* 操作提示 */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 text-white/50 mb-3">
          <MousePointerClick className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wider">操作指南</span>
        </div>
        <p className="text-xs text-white/30 leading-relaxed">
          点击图片上的目标物体，模型会自动分割并高亮选中区域。支持多次点击选择不同物体。
        </p>
      </div>

      {/* mask 列表 */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-white/50">
            <Layers className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              分割结果
            </span>
          </div>
          {masks.length > 0 && (
            <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-mono text-cyan-400">
              {masks.length}
            </span>
          )}
        </div>

        {masks.length === 0 ? (
          <p className="text-xs text-white/20 text-center py-6">
            尚未选择任何区域
          </p>
        ) : (
          <MaskList masks={masks} onRemove={onRemoveMask} />
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        <button
          onClick={onClear}
          disabled={masks.length === 0}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.08]
            bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-white/50
            transition-all hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white/70
            disabled:pointer-events-none disabled:opacity-30"
        >
          <Trash2 className="h-3.5 w-3.5" />
          清除选择
        </button>
        <button
          onClick={onReset}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.08]
            bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-white/50
            transition-all hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white/70"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重新上传
        </button>
      </div>
    </motion.div>
  );
}
