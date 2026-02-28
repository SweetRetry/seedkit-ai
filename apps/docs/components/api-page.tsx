import { createOpenAPI } from 'fumadocs-openapi/server';
import { createAPIPage } from 'fumadocs-openapi/ui';
import path from 'node:path';

const openapi = createOpenAPI({
  input: [path.resolve('./openapi/volcengine.yaml')],
});

export const APIPage = createAPIPage(openapi);
