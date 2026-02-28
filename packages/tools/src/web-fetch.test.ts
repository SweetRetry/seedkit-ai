import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import { extractContent, compressMarkdown } from './web-fetch.js';
import { webFetch } from './web-fetch.js';

// ---------------------------------------------------------------------------
// extractContent — pure function, no network
// ---------------------------------------------------------------------------

describe('extractContent', () => {
  test('extracts article title and body from well-structured HTML', () => {
    const html = `<!DOCTYPE html><html><head><title>My Article</title></head>
    <body>
      <article>
        <h1>My Article</h1>
        <p>This is the main content of the article with enough text to satisfy Readability's minimum length requirements. We need several sentences here.</p>
        <p>Another paragraph with more content to make sure Readability parses this correctly and does not fall back.</p>
      </article>
    </body></html>`;

    const result = extractContent(html, 'https://example.com/article');

    expect(result.title).toBe('My Article');
    expect(result.markdown).toContain('main content');
    expect(result.truncated).toBe(false);
  });

  test('strips script and style tags from output', () => {
    const html = `<!DOCTYPE html><html><head><title>Clean</title></head>
    <body>
      <script>alert('xss')</script>
      <style>.foo { color: red }</style>
      <p>Visible paragraph content that should appear in the output markdown.</p>
    </body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown).not.toContain("alert('xss')");
    expect(result.markdown).not.toContain('.foo { color: red }');
  });

  test('falls back to body content when Readability cannot extract article', () => {
    // Minimal HTML — no semantic article structure, too short for Readability
    const html = `<html><head><title>Fallback Page</title></head><body><p>Hi</p></body></html>`;

    const result = extractContent(html, 'https://example.com');

    // Should not throw; markdown must contain something
    expect(typeof result.markdown).toBe('string');
    expect(result.truncated).toBe(false);
  });

  test('truncates content exceeding 20000 chars and appends truncation marker', () => {
    const longParagraph = 'x'.repeat(25_000);
    const html = `<!DOCTYPE html><html><head><title>Long</title></head>
    <body><p>${longParagraph}</p></body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown.length).toBeLessThanOrEqual(20_000 + 100); // marker overhead
    expect(result.truncated).toBe(true);
    expect(result.markdown).toContain('[content truncated]');
  });

  test('uses document title when Readability falls back', () => {
    const html = `<html><head><title>Fallback Title</title></head><body><p>Short</p></body></html>`;

    const result = extractContent(html, 'https://example.com');

    // title should come from <title> tag
    expect(result.title).toBe('Fallback Title');
  });
});

// ---------------------------------------------------------------------------
// extractContent — token optimizations
// ---------------------------------------------------------------------------

describe('extractContent token optimizations', () => {
  test('strips anchor-only links, keeping link text', () => {
    const html = `<!DOCTYPE html><html><head><title>Docs</title></head>
    <body><article>
      <h2><a href="#installation">Installation</a></h2>
      <p>Run the command to get started. This paragraph has enough content for Readability.</p>
      <p>More details about the installation process and configuration options available.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    // anchor link [text](#hash) should become plain text
    expect(result.markdown).not.toMatch(/\[.*?\]\(#[^)]+\)/);
    expect(result.markdown).toContain('Installation');
  });

  test('collapses multiple blank lines into a single blank line', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <p>First paragraph with sufficient content for Readability to parse correctly.</p>
      <hr/><hr/><hr/>
      <p>Second paragraph after multiple horizontal rules and blank spacing.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    // no more than one consecutive blank line
    expect(result.markdown).not.toMatch(/\n{3,}/);
  });

  test('does not strip anchor-style links inside fenced code blocks', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <p>Example showing Markdown syntax. This needs enough text for Readability to parse it.</p>
      <pre><code class="language-markdown">[link text](#anchor-target)</code></pre>
      <p>The code block above should remain unchanged after processing.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown).toContain('[link text](#anchor-target)');
  });

  test('does not strip anchor-style links inside inline code spans', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <p>Use <code>[text](#id)</code> syntax to create anchor links in Markdown.</p>
      <p>This paragraph has enough content for Readability to extract the article correctly.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown).toContain('[text](#id)');
  });

  test('removes * * * horizontal rule noise', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <p>Content before the divider. This needs to be long enough for Readability.</p>
      <hr/>
      <p>Content after the divider. Adding more text to ensure parsing succeeds.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown).not.toContain('* * *');
  });
});

// ---------------------------------------------------------------------------
// webFetch — mocks global fetch
// ---------------------------------------------------------------------------

describe('webFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('throws on non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(null, { status: 404, statusText: 'Not Found' })
    );

    await expect(webFetch('https://example.com/missing')).rejects.toThrow('HTTP 404');
  });

  test('returns raw text for non-HTML content types', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response('{"key":"value"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const result = await webFetch('https://api.example.com/data');

    expect(result.markdown).toBe('{"key":"value"}');
    expect(result.truncated).toBe(false);
    expect(result.title).toBe('https://api.example.com/data');
  });

  test('truncates non-HTML content longer than 20000 chars', async () => {
    const big = 'a'.repeat(25_000);
    vi.stubGlobal('fetch', async () =>
      new Response(big, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    );

    const result = await webFetch('https://example.com/big.txt');

    expect(result.truncated).toBe(true);
    expect(result.markdown.length).toBeLessThanOrEqual(20_000);
  });

  test('extracts article from HTML response', async () => {
    const html = `<!DOCTYPE html><html><head><title>SDK Docs</title></head>
    <body>
      <article>
        <h1>SDK Docs</h1>
        <p>Install with npm install my-sdk — this is the documentation page with enough text.</p>
        <p>Additional content paragraph to ensure Readability processes this page correctly.</p>
      </article>
    </body></html>`;

    vi.stubGlobal('fetch', async () =>
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    );

    const result = await webFetch('https://docs.example.com');

    expect(result.title).toBeTruthy();
    expect(result.markdown).toContain('npm install my-sdk');
    expect(result.truncated).toBe(false);
    expect(result.url).toBe('https://docs.example.com');
  });

  test('treats application/xhtml+xml as HTML and extracts content', async () => {
    const html = `<?xml version="1.0"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "">
    <html xmlns="http://www.w3.org/1999/xhtml"><head><title>XHTML Page</title></head>
    <body>
      <article>
        <h1>XHTML Page</h1>
        <p>This is XHTML content with enough text for Readability to parse correctly.</p>
        <p>Additional paragraph to confirm extraction works on XHTML content types.</p>
      </article>
    </body></html>`;

    vi.stubGlobal('fetch', async () =>
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'application/xhtml+xml; charset=utf-8' },
      })
    );

    const result = await webFetch('https://example.com/page.xhtml');

    expect(result.title).toBe('XHTML Page');
    expect(result.markdown).toContain('XHTML content');
    expect(result.url).toBe('https://example.com/page.xhtml');
  });

  test('treats missing content-type header as non-HTML and returns raw text', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response('raw content without a content-type', {
        status: 200,
        // no content-type header
      })
    );

    const result = await webFetch('https://example.com/no-type');

    expect(result.markdown).toBe('raw content without a content-type');
    expect(result.title).toBe('https://example.com/no-type');
    expect(result.truncated).toBe(false);
  });

  test('re-throws network errors (e.g. timeout, DNS failure)', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });

    await expect(webFetch('https://unreachable.example.com')).rejects.toThrow('fetch failed');
  });

  test('throws on HTTP 500 with the status in the message', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(null, { status: 500, statusText: 'Internal Server Error' })
    );

    await expect(webFetch('https://example.com')).rejects.toThrow('HTTP 500');
  });

  test('throws on HTTP 403 with the status in the message', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(null, { status: 403, statusText: 'Forbidden' })
    );

    await expect(webFetch('https://example.com/private')).rejects.toThrow('HTTP 403');
  });

  test('returned url field always matches the input url exactly', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const inputUrl = 'https://api.example.com/v1/items?filter=active&page=2';
    const result = await webFetch(inputUrl);

    expect(result.url).toBe(inputUrl);
  });
});

// ---------------------------------------------------------------------------
// extractContent — edge cases
// ---------------------------------------------------------------------------

describe('extractContent edge cases', () => {
  test('handles empty HTML string without throwing', () => {
    expect(() => extractContent('', 'https://example.com')).not.toThrow();
    const result = extractContent('', 'https://example.com');
    expect(typeof result.markdown).toBe('string');
    expect(typeof result.title).toBe('string');
  });

  test('handles HTML with no <body> tag without throwing', () => {
    const html = `<html><head><title>No Body</title></head></html>`;
    expect(() => extractContent(html, 'https://example.com')).not.toThrow();
    const result = extractContent(html, 'https://example.com');
    expect(result.title).toBe('No Body');
  });

  test('uses url as title when both Readability and <title> produce empty string', () => {
    // No <title> tag, no article content — Readability will fail, document.title will be ''
    const html = `<html><head></head><body><p>x</p></body></html>`;
    const result = extractContent(html, 'https://fallback.example.com');
    // title must be non-empty — falls back to url when document.title is ''
    expect(result.title).toBeTruthy();
  });

  test('strips noscript tags from output', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <noscript>Please enable JavaScript</noscript>
      <p>Main content with enough text for Readability to extract the article correctly here.</p>
      <p>Second paragraph with more content to satisfy Readability minimum length requirements.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown).not.toContain('Please enable JavaScript');
  });

  test('strips iframe tags from output', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <iframe src="https://ads.example.com/banner" title="ad"></iframe>
      <p>Main article content with enough text for Readability minimum length requirements.</p>
      <p>More article text to ensure Readability extracts this as the primary article content.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown).not.toContain('ads.example.com');
  });

  test('preserves external links (non-anchor hrefs) unchanged', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <p>See the <a href="https://example.com/docs">documentation</a> for more information.</p>
      <p>Also check <a href="#section">this section</a> below for additional context.</p>
      <p>Third paragraph to ensure Readability processes this page as a full article content.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    // External link must survive; anchor link must be stripped to plain text
    expect(result.markdown).toContain('[documentation](https://example.com/docs)');
    expect(result.markdown).not.toMatch(/\[this section\]\(#[^)]+\)/);
    expect(result.markdown).toContain('this section');
  });

  test('does not crash on malformed CSS in <style> tags (real-world regression)', () => {
    // Mirrors the exact broken CSS pattern from the 80aj.com error report
    const html = `<!DOCTYPE html><html><head><title>Blog Post</title>
    <style>.article p img,.article img{max-width:100%}.article .video-js{margin:0 auto}{width:}</style>
    </head><body><article>
      <p>This post content should be extracted successfully despite the broken CSS above.</p>
      <p>Additional paragraph to ensure Readability processes this article without crashing.</p>
    </article></body></html>`;

    expect(() => extractContent(html, 'https://www.80aj.com/post')).not.toThrow();
    const result = extractContent(html, 'https://www.80aj.com/post');
    expect(result.markdown).toContain('extracted successfully');
  });

  test('SVG elements are stripped from output', () => {
    const html = `<!DOCTYPE html><html><head><title>T</title></head>
    <body><article>
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <circle cx="50" cy="50" r="40" fill="red"/>
      </svg>
      <p>Article text that should appear in the output after SVG is removed.</p>
      <p>More article content to give Readability enough text to extract the article.</p>
    </article></body></html>`;

    const result = extractContent(html, 'https://example.com');

    expect(result.markdown).not.toContain('<svg');
    expect(result.markdown).not.toContain('<circle');
  });
});

// ---------------------------------------------------------------------------
// compressMarkdown — unit tests
// ---------------------------------------------------------------------------

describe('compressMarkdown', () => {
  test('empty string returns empty string', () => {
    expect(compressMarkdown('')).toBe('');
  });

  test('strips anchor-only links but preserves external links', () => {
    const md = 'See [Installation](#install) and [docs](https://example.com/docs) for details.';
    const result = compressMarkdown(md);
    expect(result).not.toMatch(/\[.*?\]\(#[^)]+\)/);
    expect(result).toContain('Installation');
    expect(result).toContain('[docs](https://example.com/docs)');
  });

  test('collapses 3+ blank lines to exactly 2 blank lines (one empty line)', () => {
    const md = 'First\n\n\n\n\nSecond';
    const result = compressMarkdown(md);
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('First');
    expect(result).toContain('Second');
  });

  test('removes * * * HR noise lines', () => {
    const md = 'Before\n\n* * *\n\nAfter';
    expect(compressMarkdown(md)).not.toContain('* * *');
  });

  test('anchor links inside fenced code blocks are not touched', () => {
    const md = 'Text\n\n```markdown\n[link](#anchor)\n```\n\nMore text';
    const result = compressMarkdown(md);
    expect(result).toContain('[link](#anchor)');
  });

  test('anchor links inside inline code are not touched', () => {
    const md = 'Use `[text](#id)` syntax here.';
    const result = compressMarkdown(md);
    expect(result).toContain('[text](#id)');
  });

  test('does not corrupt fenced code blocks containing placeholders', () => {
    // A code block whose content looks like our internal placeholder \x00CODE0\x00
    const md = '```\n\x00CODE0\x00\n```';
    // Should not throw and should round-trip the content intact
    const result = compressMarkdown(md);
    expect(result).toContain('\x00CODE0\x00');
  });

  test('trims leading and trailing whitespace from output', () => {
    const md = '\n\n  hello world  \n\n';
    expect(compressMarkdown(md)).toBe('hello world');
  });
});
