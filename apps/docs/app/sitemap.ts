import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';

const BASE_URL = 'https://seed-kit-docs.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages();

  return pages.map(page => ({
    url: `${BASE_URL}${page.url}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: page.url === '/docs' ? 1 : 0.8,
  }));
}
