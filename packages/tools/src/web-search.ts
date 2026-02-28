export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export interface WebSearchOutput {
  query: string;
  results: SearchResult[];
}

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';

interface ExaMcpResponse {
  jsonrpc: string;
  id: number;
  result?: {
    content: Array<{ type: string; text: string }>;
  };
}

/**
 * Parse the raw Exa MCP text blob into structured SearchResult[].
 * Each result block starts with "Title: " and contains URL + Text fields.
 */
function parseExaText(raw: string, limit: number): SearchResult[] {
  const blocks = raw.split(/\n(?=Title: )/);
  const results: SearchResult[] = [];

  for (const block of blocks) {
    if (results.length >= limit) break;

    const titleMatch = /^Title: (.+)/m.exec(block);
    const urlMatch = /^URL: (.+)/m.exec(block);
    const textMatch = /^Text: ([\s\S]+)/m.exec(block);

    if (!titleMatch || !urlMatch) continue;

    results.push({
      title: titleMatch[1].trim(),
      url: urlMatch[1].trim(),
      description: textMatch ? textMatch[1].replace(/\n/g, ' ').trim().slice(0, 300) : '',
    });
  }

  return results;
}

/**
 * Search the web via Exa MCP. No API key required.
 * Returns up to `limit` organic results.
 */
export async function webSearch(
  query: string,
  limit = 5
): Promise<WebSearchOutput> {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'web_search_exa',
      arguments: { query, numResults: limit },
    },
  });

  const response = await fetch(EXA_MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Exa search failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();

  // Response is SSE: find the "data: {...}" line
  let parsed: ExaMcpResponse | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      parsed = JSON.parse(line.slice(6));
      break;
    }
  }

  if (!parsed?.result?.content?.[0]?.text) {
    return { query, results: [] };
  }

  return {
    query,
    results: parseExaText(parsed.result.content[0].text, limit),
  };
}
