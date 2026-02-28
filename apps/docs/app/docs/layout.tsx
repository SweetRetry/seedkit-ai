import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { RootProvider } from 'fumadocs-ui/provider/next';
import Link from 'next/link';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      <DocsLayout
        tree={source.pageTree}
        nav={{ title: 'AI SDK Volcengine Adapter' }}
        githubUrl="https://github.com/SweetRetry/ai-sdk-volcengine-adapter"
        sidebar={{
          footer: (
            <Link
              href="/docs/api"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
            >
              <span>🔌</span>
              <span>API Playground</span>
            </Link>
          ),
        }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
