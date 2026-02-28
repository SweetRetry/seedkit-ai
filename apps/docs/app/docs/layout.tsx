import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { RootProvider } from 'fumadocs-ui/provider/next';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      <DocsLayout
        tree={source.pageTree}
        nav={{ title: 'Seed API 文档' }}
        githubUrl="https://github.com/SweetRetry/seed-kit"
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
