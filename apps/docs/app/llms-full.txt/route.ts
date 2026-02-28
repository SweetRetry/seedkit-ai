import { source } from '@/lib/source';

export const revalidate = false;

export async function GET() {
  const pages = source.getPages();

  const sections = await Promise.all(
    pages.map(async page => {
      const content = page.data.structuredData?.contents
        ?.map((c: { content: string }) => c.content)
        .join('\n') ?? '';
      return `# ${page.data.title}\n\nURL: ${page.url}\n\n${content}`;
    }),
  );

  return new Response(sections.join('\n\n---\n\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
