'use client';

import { motion } from 'framer-motion';
import { Github, Scan } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

interface HeaderProps {
  connected: boolean;
}

export function Header({ connected }: HeaderProps) {
  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#0a0a0f]/80 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-purple-600 shadow-lg shadow-cyan-500/20">
            <Scan className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white font-mono">
              FastSAM
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/30">
              Interactive Segmentation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <StatusBadge connected={connected} />
          <a
            href="https://github.com/Eva-Dengyh/FastSAM-Demo"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08]
              bg-white/[0.03] text-white/40 transition-all hover:border-white/20 hover:text-white/80"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </div>
    </motion.header>
  );
}
