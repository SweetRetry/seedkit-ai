import defaultComponents from 'fumadocs-ui/mdx';
import { APIPage } from '@/components/api-page';

export function getMDXComponents(components?: object) {
  return {
    ...defaultComponents,
    APIPage,
    ...components,
  };
}
