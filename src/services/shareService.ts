import { toBlob, toPng } from 'html-to-image';

export const MAX_POSTER_PIXELS = 16_000_000;
export const MAX_POSTER_MEMORY_BYTES = 64 * 1024 * 1024;
export const MAX_POSTER_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_POSTER_ARCHIVE_FILES = 7;

export function normalizeHttpUrl(value: unknown, base?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = base ? new URL(value, base) : new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function assertPosterExportBudget(width: number, height: number, pixelRatio: number): void {
  if (![width, height, pixelRatio].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('INVALID_POSTER_SIZE');
  }
  const pixels = width * height * pixelRatio * pixelRatio;
  if (pixels > MAX_POSTER_PIXELS || pixels * 4 > MAX_POSTER_MEMORY_BYTES) {
    throw new Error('POSTER_BUDGET_EXCEEDED');
  }
}

export function assertPosterArchiveBudget(images: ReadonlyArray<{ blob: Blob }>): void {
  const totalBytes = images.reduce((sum, image) => sum + image.blob.size, 0);
  if (images.length > MAX_POSTER_ARCHIVE_FILES || totalBytes > MAX_POSTER_ARCHIVE_BYTES) {
    throw new Error('POSTER_ARCHIVE_BUDGET_EXCEEDED');
  }
}

export interface ShareOptions {
  /** 海报容器元素 */
  containerElement: HTMLElement;
  /** 输出宽度 (px) */
  width?: number;
  /** 输出高度 (px) */
  height?: number;
  /** 像素比，默认 2 以获得高清图片 */
  pixelRatio?: number;
  /** 质量 0-1 */
  quality?: number;
  /** Allows callers to cancel multi-poster export between expensive steps. */
  signal?: AbortSignal;
}

/**
 * 生成海报 PNG 图片
 * 使用 html-to-image，对现代 CSS 颜色函数兼容性更好
 */
export async function generatePosterBlob(options: ShareOptions): Promise<Blob> {
  const {
    containerElement,
    width,
    height,
    pixelRatio = 2,
    quality = 1,
    signal,
  } = options;
  const exportWidth = width ?? containerElement.offsetWidth;
  const exportHeight = height ?? containerElement.offsetHeight;
  assertPosterExportBudget(exportWidth, exportHeight, pixelRatio);
  signal?.throwIfAborted();

  try {
    const blob = await toBlob(containerElement, {
      cacheBust: true,
      pixelRatio,
      quality,
      width,
      height,
    });

    signal?.throwIfAborted();
    if (!blob) {
      throw new Error('Failed to generate poster blob');
    }

    return blob;
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    console.error('Poster generation failed:', error);
    throw new Error('POSTER_GENERATION_FAILED', { cause: error });
  }
}

/**
 * 生成海报 DataURL (base64)
 */
export async function generatePosterDataURL(options: ShareOptions): Promise<string> {
  const {
    containerElement,
    width,
    height,
    pixelRatio = 2,
    quality = 1,
    signal,
  } = options;
  assertPosterExportBudget(width ?? containerElement.offsetWidth, height ?? containerElement.offsetHeight, pixelRatio);
  signal?.throwIfAborted();
  const dataUrl = await toPng(containerElement, {
    cacheBust: true,
    pixelRatio,
    quality,
    width,
    height,
  });
  signal?.throwIfAborted();
  return dataUrl;
}

/**
 * 下载海报图片
 */
export function downloadPoster(blob: Blob, filename = 'compare-poster.png'): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Safari may not start reading the object URL until a later task.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * 分享到系统分享面板 (Web Share API)
 */
export type NativeShareResult = 'shared' | 'cancelled' | 'unavailable' | 'failed';

export async function nativeShare(data: {
  title: string;
  text: string;
  url?: string;
  files?: File[];
}): Promise<NativeShareResult> {
  if (!navigator.share) return 'unavailable';

  const files = data.files?.length && navigator.canShare?.({ files: data.files })
    ? data.files
    : undefined;
  const url = normalizeHttpUrl(data.url);
  if (!files && !url) return 'unavailable';

  try {
    await navigator.share({
      title: data.title,
      text: data.text,
      url: files ? undefined : url ?? undefined,
      files,
    });
    return 'shared';
  } catch (error) {
    if ((error as Error).name === 'AbortError') return 'cancelled';
    console.error('Native share failed:', error);
    return 'failed';
  }
}

/**
 * 保存图片到本地 (移动端长按保存)
 */
export async function saveImageToGallery(
  dataUrl: string,
  filename = 'compare-poster.png'
): Promise<void> {
  // 转换为 blob
  const response = await fetch(dataUrl);
  const blob = await response.blob();

  // 创建下载链接
  downloadPoster(blob, filename);
}
