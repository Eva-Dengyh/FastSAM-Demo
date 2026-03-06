import type { CanvasTransform, ImageSize, RLEMask } from '@/types';
import { MASK_OPACITY } from './constants';

/** 计算图片在 canvas 上的变换参数 */
export function getTransform(
  canvasWidth: number,
  canvasHeight: number,
  imageSize: ImageSize,
): CanvasTransform {
  const scale = Math.min(
    canvasWidth / imageSize.width,
    canvasHeight / imageSize.height,
  );
  const drawW = imageSize.width * scale;
  const drawH = imageSize.height * scale;
  return {
    ox: (canvasWidth - drawW) / 2,
    oy: (canvasHeight - drawH) / 2,
    scale,
  };
}

/** 将 RLE mask 渲染到 canvas 上 */
export function renderMask(
  ctx: CanvasRenderingContext2D,
  rle: RLEMask,
  transform: CanvasTransform,
  color: [number, number, number],
  opacity = MASK_OPACITY,
): void {
  const { counts, size } = rle;
  const [h, w] = size;
  const { ox, oy, scale } = transform;

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = w;
  tmpCanvas.height = h;
  const tmpCtx = tmpCanvas.getContext('2d')!;
  const imgData = tmpCtx.createImageData(w, h);

  let idx = 0;
  let val = 0;
  for (const count of counts) {
    for (let i = 0; i < count && idx < w * h; i++, idx++) {
      if (val === 1) {
        const p = idx * 4;
        imgData.data[p] = color[0];
        imgData.data[p + 1] = color[1];
        imgData.data[p + 2] = color[2];
        imgData.data[p + 3] = Math.round(opacity * 255);
      }
    }
    val = 1 - val;
  }

  tmpCtx.putImageData(imgData, 0, 0);
  ctx.drawImage(tmpCanvas, ox, oy, w * scale, h * scale);
}
