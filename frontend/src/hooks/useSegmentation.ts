'use client';

import { useCallback, useState } from 'react';
import { segmentImage, uploadImage } from '@/lib/api';
import type { ImageSize, MaskResult } from '@/types';

export function useSegmentation() {
  const [imageId, setImageId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [masks, setMasks] = useState<MaskResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const data = await uploadImage(file);
      setImageId(data.image_id);
      setImageSize({ width: data.width, height: data.height });
      setImageUrl(URL.createObjectURL(file));
      setMasks([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const segment = useCallback(
    async (x: number, y: number) => {
      if (!imageId || loading) return;
      setLoading(true);
      setError(null);
      try {
        const data = await segmentImage(imageId, [{ x, y, label: 1 }]);
        if (data.masks.length > 0) {
          setMasks((prev) => [...prev, data.masks[0]]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '分割失败');
      } finally {
        setLoading(false);
      }
    },
    [imageId, loading],
  );

  const clearMasks = useCallback(() => setMasks([]), []);

  const removeMask = useCallback((index: number) => {
    setMasks((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const reset = useCallback(() => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    setImageId(null);
    setImageSize(null);
    setMasks([]);
    setError(null);
  }, [imageUrl]);

  return {
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
    clearError: () => setError(null),
  };
}
