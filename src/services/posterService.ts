/**
 * 海报生成服务
 * 支持生成封面海报和多张维度卡片
 */
import { toBlob, toPng } from 'html-to-image';
import { ComparisonResult } from './geminiService';

export interface PosterImage {
  name: string;
  blob: Blob;
  dataUrl: string;
}

/**
 * 生成单张海报图片
 */
async function generateSingleImage(
  elementId: string,
  pixelRatio: number = 2
): Promise<Blob> {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error(`Element ${elementId} not found`);
  }

  const blob = await toBlob(element, {
    quality: 1.0,
    pixelRatio,
    // html-to-image 选项
  });

  if (!blob) {
    throw new Error('Failed to generate image');
  }

  return blob;
}

/**
 * 生成封面海报
 */
export async function generateCoverPoster(result: ComparisonResult): Promise<PosterImage> {
  const blob = await generateSingleImage('poster-cover', 2);
  const filename = `${result.entityA.name}-vs-${result.entityB.name}-封面.png`;

  return {
    name: filename,
    blob,
    dataUrl: URL.createObjectURL(blob),
  };
}

/**
 * 生成维度卡片
 */
export async function generateDimensionCards(
  result: ComparisonResult
): Promise<PosterImage[]> {
  const images: PosterImage[] = [];

  for (let i = 0; i < result.dimensions.length; i++) {
    const elementId = `dimension-card-${i}`;
    try {
      const blob = await generateSingleImage(elementId, 2);
      const filename = `${result.entityA.name}-vs-${result.entityB.name}-${result.dimensions[i].label}.png`;
      images.push({
        name: filename,
        blob,
        dataUrl: URL.createObjectURL(blob),
      });
    } catch (error) {
      console.error(`Failed to generate card ${i}:`, error);
    }
  }

  return images;
}

/**
 * 下载单张图片
 */
export function downloadImage(image: PosterImage): void {
  const link = document.createElement('a');
  link.href = image.dataUrl;
  link.download = image.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * 下载多张图片 (按顺序触发下载)
 */
export async function downloadMultipleImages(images: PosterImage[]): Promise<void> {
  for (const image of images) {
    downloadImage(image);
    // 等待一小段时间确保下载开始
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * 清理图片 URL
 */
export function revokeImageUrls(images: PosterImage[]): void {
  images.forEach((image) => {
    URL.revokeObjectURL(image.dataUrl);
  });
}
