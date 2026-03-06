/** 点击坐标输入 */
export interface PointInput {
  x: number;
  y: number;
  /** 1=前景 0=背景 */
  label: 0 | 1;
}

/** RLE 编码的 binary mask */
export interface RLEMask {
  counts: number[];
  /** [height, width] */
  size: [number, number];
}

/** 单个分割结果 */
export interface MaskResult {
  rle: RLEMask;
  /** [x_min, y_min, x_max, y_max] */
  bbox: [number, number, number, number];
  score: number;
  area: number;
}

/** 分割响应 */
export interface SegmentResponse {
  masks: MaskResult[];
  image_id: string;
}

/** 上传响应 */
export interface UploadResponse {
  image_id: string;
  width: number;
  height: number;
}

/** 健康检查响应 */
export interface HealthResponse {
  status: string;
  model_loaded: boolean;
}

/** 图片尺寸 */
export interface ImageSize {
  width: number;
  height: number;
}

/** Canvas 坐标变换 */
export interface CanvasTransform {
  ox: number;
  oy: number;
  scale: number;
}
