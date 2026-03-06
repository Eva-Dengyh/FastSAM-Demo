/** mask 渲染颜色 (RGB) — 霓虹科技感配色 */
export const MASK_COLORS: [number, number, number][] = [
  [0, 212, 255],    // 霓虹蓝
  [168, 85, 247],   // 紫色
  [52, 211, 153],   // 翡翠绿
  [251, 146, 60],   // 琥珀橙
  [244, 63, 94],    // 玫红
  [14, 165, 233],   // 天蓝
  [217, 70, 239],   // 品红
  [163, 230, 53],   // 柠檬绿
];

/** mask 默认透明度 */
export const MASK_OPACITY = 0.45;

/** API 基础路径（通过 Next.js rewrites 代理） */
export const API_BASE = '/api';

/** 支持的图片类型 */
export const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp';

/** 最大图片大小 (10MB) */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
