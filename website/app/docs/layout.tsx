import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { RootProvider } from 'fumadocs-ui/provider/next';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      <DocsLayout
        tree={source.pageTree}
        nav={{ title: 'AI SDK Volcengine Adapter' }}
        githubUrl="https://github.com/SweetRetry/ai-sdk-volcengine-adapter"
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
