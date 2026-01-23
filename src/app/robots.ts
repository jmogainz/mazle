import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://mazle.io';
  
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/_next/', '/archive', '/play/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
