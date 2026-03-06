import { API_BASE } from './constants';
import type {
  HealthResponse,
  PointInput,
  SegmentResponse,
  UploadResponse,
} from '@/types';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const msg =
      body?.detail?.message ?? body?.detail ?? `请求失败: ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

/** 健康检查 */
export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`);
  return handleResponse<HealthResponse>(res);
}

/** 上传图片 */
export async function uploadImage(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse<UploadResponse>(res);
}

/** 点击分割 */
export async function segmentImage(
  imageId: string,
  points: PointInput[],
): Promise<SegmentResponse> {
  const res = await fetch(`${API_BASE}/segment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_id: imageId, points }),
  });
  return handleResponse<SegmentResponse>(res);
}
