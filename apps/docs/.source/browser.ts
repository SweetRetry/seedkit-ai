// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"index.mdx": () => import("../content/docs/index.mdx?collection=docs"), "image-gen/index.mdx": () => import("../content/docs/image-gen/index.mdx?collection=docs"), "text-gen/index.mdx": () => import("../content/docs/text-gen/index.mdx?collection=docs"), "text-gen-responses/index.mdx": () => import("../content/docs/text-gen-responses/index.mdx?collection=docs"), "video-gen/index.mdx": () => import("../content/docs/video-gen/index.mdx?collection=docs"), }),
};
export default browserCollections;