import { API_BASE } from './constants';
import type {
  HealthResponse,
  PointInput,
  SegmentResponse,
  UploadResponse,
} from '@/types';

// 区分前端可以差异化处理的错误：
// - SessionExpiredError (410)：image_id 失效，需要重新上传
// - RateLimitedError (429)：网关繁忙，退避后自动重试
// - ApiError：其他业务错误
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class SessionExpiredError extends ApiError {
  constructor(message: string = '会话已过期，请重新上传图片') {
    super(410, message);
    this.name = 'SessionExpiredError';
  }
}

export class RateLimitedError extends ApiError {
  constructor(
    message: string,
    public retryAfterMs: number,
  ) {
    super(429, message);
    this.name = 'RateLimitedError';
  }
}

const MAX_RETRY = 3;
const BASE_BACKOFF_MS = 500;

function parseRetryAfter(value: string | null): number {
  if (!value) return BASE_BACKOFF_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return BASE_BACKOFF_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) return res.json();

  const body = await res.json().catch(() => null);
  const msg =
    body?.detail?.message ?? body?.detail ?? `请求失败: ${res.status}`;

  if (res.status === 410) throw new SessionExpiredError(msg);
  if (res.status === 429) {
    throw new RateLimitedError(msg, parseRetryAfter(res.headers.get('Retry-After')));
  }
  throw new ApiError(res.status, msg);
}

// 包装 fetch + 429 指数退避自动重试。
// 410 / 其他 4xx / 5xx 一次性抛出，由调用方决定。
async function fetchWithRetry<T>(
  doFetch: () => Promise<Response>,
  routeLabel: string,
): Promise<T> {
  let attempt = 0;
  while (true) {
    let res: Response;
    try {
      res = await doFetch();
    } catch (e) {
      // 网络层失败（连接重置等），按 RateLimited 同样退避一下
      if (attempt >= MAX_RETRY) throw e;
      const wait = BASE_BACKOFF_MS * 2 ** attempt;
      console.warn(`[api] ${routeLabel} 网络错误，${wait}ms 后重试 (#${attempt + 1})`, e);
      await sleep(wait);
      attempt++;
      continue;
    }

    try {
      return await handleResponse<T>(res);
    } catch (e) {
      if (e instanceof RateLimitedError && attempt < MAX_RETRY) {
        const wait = Math.max(e.retryAfterMs, BASE_BACKOFF_MS * 2 ** attempt);
        console.warn(`[api] ${routeLabel} 被限流，${wait}ms 后重试 (#${attempt + 1})`);
        await sleep(wait);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

/** 健康检查（不做自动重试，调用方一次性判定） */
export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`);
  return handleResponse<HealthResponse>(res);
}

/** 上传图片：429 自动退避；网关无可用 worker 直接上抛 */
export async function uploadImage(file: File): Promise<UploadResponse> {
  return fetchWithRetry<UploadResponse>(() => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
  }, 'upload');
}

/** 点击分割：429 自动退避；410 抛 SessionExpiredError 由 hook 触发重传 */
export async function segmentImage(
  imageId: string,
  points: PointInput[],
): Promise<SegmentResponse> {
  return fetchWithRetry<SegmentResponse>(
    () =>
      fetch(`${API_BASE}/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_id: imageId, points }),
      }),
    'segment',
  );
}
