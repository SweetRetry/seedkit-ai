// @ts-nocheck
import * as __fd_glob_9 from "../content/docs/video-gen/index.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/text-gen-responses/index.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/text-gen/index.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/image-gen/index.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/index.mdx?collection=docs"
import { default as __fd_glob_4 } from "../content/docs/video-gen/meta.json?collection=docs"
import { default as __fd_glob_3 } from "../content/docs/text-gen-responses/meta.json?collection=docs"
import { default as __fd_glob_2 } from "../content/docs/text-gen/meta.json?collection=docs"
import { default as __fd_glob_1 } from "../content/docs/image-gen/meta.json?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, "image-gen/meta.json": __fd_glob_1, "text-gen/meta.json": __fd_glob_2, "text-gen-responses/meta.json": __fd_glob_3, "video-gen/meta.json": __fd_glob_4, }, {"index.mdx": __fd_glob_5, "image-gen/index.mdx": __fd_glob_6, "text-gen/index.mdx": __fd_glob_7, "text-gen-responses/index.mdx": __fd_glob_8, "video-gen/index.mdx": __fd_glob_9, });