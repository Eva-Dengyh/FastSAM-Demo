'use client';

import { useEffect, useState } from 'react';
import { checkHealth } from '@/lib/api';

/** 轮询后端健康状态 */
export function useHealthCheck(intervalMs = 10000) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let mounted = true;

    const check = () => {
      checkHealth()
        .then(() => mounted && setConnected(true))
        .catch(() => mounted && setConnected(false));
    };

    check();
    const timer = setInterval(check, intervalMs);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return connected;
}
