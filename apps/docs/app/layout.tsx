import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import '../global.css';

export const metadata: Metadata = {
  title: {
    default: 'Seed API 文档',
    template: '%s | Seed API 文档',
  },
  description: 'Seed 大模型 API 参考文档，涵盖对话生成、图像生成和视频生成。',
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    siteName: 'Seed API 文档',
    locale: 'zh_CN',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
