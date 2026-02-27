import { source } from '@/lib/source';

export const revalidate = false;

export async function GET() {
  const pages = source.getPages();

  const lines = [
    '# AI SDK Volcengine Adapter 文档',
    '',
    '> Volcengine (豆包) 的 Vercel AI SDK 适配器',
    '',
    '## 文档页面',
    '',
    ...pages.map(p => `- [${p.data.title}](${p.url})`),
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
