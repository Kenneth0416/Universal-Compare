export interface PopularComparison {
  id: number;
  itemA: string;
  itemB: string;
  description: string;
  reportId: string | null;
  slug: string;
  viewCount: number;
}

export async function getPopularComparisons(language = 'en', limit?: number): Promise<PopularComparison[]> {
  const limitQuery = limit ? `&limit=${encodeURIComponent(limit)}` : '';
  const response = await fetch(`/api/popular-comparisons?lang=${encodeURIComponent(language)}${limitQuery}`);

  if (!response.ok) {
    throw new Error(`Failed to load popular comparisons: ${response.status}`);
  }

  const data = (await response.json()) as { items?: PopularComparison[] };
  return data.items || [];
}
