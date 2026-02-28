import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import TurndownService from 'turndown';

const MAX_MARKDOWN_CHARS = 20_000;

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Strip elements that pollute LLM context
turndown.remove(['script', 'style', 'noscript', 'iframe'] as (keyof HTMLElementTagNameMap)[]);
// svg is not in HTMLElementTagNameMap — filter via rule
turndown.addRule('remove-svg', {
  filter: (node) => node.nodeName === 'SVG',
  replacement: () => '',
});

export interface WebFetchOutput {
  url: string;
  title: string;
  markdown: string;
  truncated: boolean;
}

export interface ExtractResult {
  title: string;
  markdown: string;
  truncated: boolean;
}

/**
 * Post-process turndown output to reduce token count without losing meaning.
 *   1. Collapse anchor-only links [text](#hash) → plain text
 *      (skips fenced code blocks and inline code spans)
 *   2. Remove HR noise lines (* * *)
 *   3. Collapse 3+ consecutive blank lines → 2
 */
export function compressMarkdown(md: string): string {
  // Protect code blocks and inline code from substitution by replacing them
  // with stable placeholders, then restoring after all transforms complete.
  const protected_: string[] = [];
  const placeholder = (i: number) => `\x00CODE${i}\x00`;

  let out = md
    // fenced code blocks (``` ... ```)
    .replace(/```[\s\S]*?```/g, (match) => {
      protected_.push(match);
      return placeholder(protected_.length - 1);
    })
    // inline code spans (` ... `)
    .replace(/`[^`\n]+`/g, (match) => {
      protected_.push(match);
      return placeholder(protected_.length - 1);
    });

  out = out
    // [text](#anchor) → text  (internal anchor links carry no value for LLMs)
    .replace(/\[(.+?)\]\(#[^)]+\)/g, '$1')
    // * * * HR lines → remove entirely
    .replace(/^\* \* \*\s*$/gm, '')
    // 3+ consecutive blank lines → max 2
    .replace(/\n{3,}/g, '\n\n');

  // Restore protected blocks
  for (let i = 0; i < protected_.length; i++) {
    out = out.replace(placeholder(i), protected_[i]!);
  }

  return out.trim();
}

/**
 * Pure function: parse an HTML string and convert the main article content to
 * Markdown. Does not perform any network I/O — safe to call in unit tests.
 */
// Silence jsdom CSS parse errors — malformed stylesheets on third-party pages
// produce noisy stack traces that are irrelevant to content extraction.
const silentConsole = new VirtualConsole();
silentConsole.sendTo(console, { omitJSDOMErrors: true });

export function extractContent(html: string, url: string): ExtractResult {
  const dom = new JSDOM(html, { url, virtualConsole: silentConsole });
  const document = dom.window.document;

  const reader = new Readability(document);
  const article = reader.parse();

  let markdown: string;
  let title: string;

  if (article) {
    title = article.title || url;
    markdown = turndown.turndown(article.content ?? '');
  } else {
    title = document.title || url;
    const body = document.body?.innerHTML ?? html;
    markdown = turndown.turndown(body);
  }

  markdown = compressMarkdown(markdown);

  const truncated = markdown.length > MAX_MARKDOWN_CHARS;
  if (truncated) {
    markdown = markdown.slice(0, MAX_MARKDOWN_CHARS) + '\n\n_[content truncated]_';
  }

  return { title, markdown, truncated };
}

/**
 * Fetch a URL and extract its main content as Markdown.
 * Uses @mozilla/readability for article extraction, falls back to full body.
 */
export async function webFetch(url: string): Promise<WebFetchOutput> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; SeedcodeBot/1.0; +https://github.com/SweetRetry/seedkit-ai)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    // Non-HTML: return raw text (truncated)
    const text = await response.text();
    const truncated = text.length > MAX_MARKDOWN_CHARS;
    return {
      url,
      title: url,
      markdown: text.slice(0, MAX_MARKDOWN_CHARS),
      truncated,
    };
  }

  const html = await response.text();
  const { title, markdown, truncated } = extractContent(html, url);
  return { url, title, markdown, truncated };
}
