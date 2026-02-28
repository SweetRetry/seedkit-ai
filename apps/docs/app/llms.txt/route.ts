import { source } from '@/lib/source';

export const revalidate = false;

export async function GET() {
  const pages = source.getPages();

  const lines = [
    '# Seed 大模型 API 文档',
    '',
    '> Seed 大模型 API 参考文档，涵盖对话生成、图像生成和视频生成。',
    '',
    '## 文档页面',
    '',
    ...pages.map(p => `- [${p.data.title}](${p.url})`),
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
