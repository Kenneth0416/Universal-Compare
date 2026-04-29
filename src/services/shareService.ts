import { toBlob, toPng } from 'html-to-image';

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
  } = options;

  try {
    const blob = await toBlob(containerElement, {
      cacheBust: true,
      pixelRatio,
      quality,
      width,
      height,
    });

    if (!blob) {
      throw new Error('Failed to generate poster blob');
    }

    return blob;
  } catch (error) {
    console.error('Poster generation failed:', error);
    throw new Error('海报生成失败，请重试');
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
  } = options;

  return toPng(containerElement, {
    cacheBust: true,
    pixelRatio,
    quality,
    width,
    height,
  });
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
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 分享到系统分享面板 (Web Share API)
 */
export async function nativeShare(data: {
  title: string;
  text: string;
  url?: string;
}): Promise<boolean> {
  if (navigator.share) {
    try {
      await navigator.share({
        title: data.title,
        text: data.text,
        url: data.url || window.location.href,
      });
      return true;
    } catch (error) {
      // 用户取消分享不算错误
      if ((error as Error).name !== 'AbortError') {
        console.error('Native share failed:', error);
      }
      return false;
    }
  }
  return false;
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
