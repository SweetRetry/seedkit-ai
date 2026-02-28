import { APIPage } from '@/components/api-page';
import { DocsPage, DocsBody } from 'fumadocs-ui/page';
import path from 'node:path';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API Playground',
  description: '在线调试 Volcengine Ark API 接口',
};

export default function Page() {
  const schemaPath = path.resolve('./openapi/volcengine.yaml');

  return (
    <DocsPage toc={[]} full>
      <DocsBody>
        <APIPage document={schemaPath} />
      </DocsBody>
    </DocsPage>
  );
}
