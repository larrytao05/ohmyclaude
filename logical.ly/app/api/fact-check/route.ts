import { NextRequest, NextResponse } from 'next/server';

type ClaimSpan = {
  id: string;
  claimText: string;
  startChar: number;
  endChar: number;
  searchQuery: string;
};

type EvidenceSnippet = {
  title: string;
  url: string;
  snippet: string;
};

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return `${value}`;
};

async function duckDuckGoSearch(
  query: string,
  maxResults = 4,
): Promise<EvidenceSnippet[]> {
  if (!query.trim()) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
    });
    const response = await fetch(
      `https://api.duckduckgo.com/?${params.toString()}`,
    );

    if (!response.ok) {
      throw new Error(`DuckDuckGo request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const results: EvidenceSnippet[] = [];

    if (data.Abstract && data.AbstractURL) {
      results.push({
        title: data.Heading || 'Summary',
        url: data.AbstractURL,
        snippet: data.Abstract,
      });
    }

    const flattenTopics = (topics: any[]): any[] =>
      topics.flatMap((topic: any) =>
        topic?.Topics ? flattenTopics(topic.Topics) : topic,
      );

    const topicItems = flattenTopics(data.RelatedTopics ?? []);
    for (const topic of topicItems) {
      if (topic?.Text && topic?.FirstURL) {
        results.push({
          title: topic.Text.split(' - ')[0] ?? topic.Text,
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
      if (results.length >= maxResults) break;
    }

    if (Array.isArray(data.Results)) {
      for (const item of data.Results) {
        if (item?.Text && item?.FirstURL) {
          results.push({
            title: item.Text.split(' - ')[0] ?? item.Text,
            url: item.FirstURL,
            snippet: item.Text,
          });
        }
        if (results.length >= maxResults) break;
      }
    }

    return results.slice(0, maxResults);
  } catch (error) {
    console.error('DuckDuckGo search error:', error);
    return [];
  }
}

function extractJsonPayload(text: string) {
  if (!text) return '';
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }
  return trimmed;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const claims: ClaimSpan[] = Array.isArray(body?.claims) ? body.claims : [];

    if (claims.length === 0) {
      return NextResponse.json(
        { error: 'No claims provided. Run extraction first.' },
        { status: 400 },
      );
    }

    const claudeKey = process.env.CLAUDE_API_KEY;
    if (!claudeKey) {
      return NextResponse.json(
        { error: 'CLAUDE_API_KEY is not set in environment.' },
        { status: 500 },
      );
    }

    const searchResults: Record<string, EvidenceSnippet[]> = {};

    await Promise.all(
      claims.map(async (claim) => {
        let evidence = await duckDuckGoSearch(claim.searchQuery, 4);
        if (evidence.length === 0) {
          const fallbackQuery = claim.claimText
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .slice(0, 10)
            .join(' ');
          if (fallbackQuery.length > 0) {
            evidence = await duckDuckGoSearch(fallbackQuery, 4);
          }
        }
        searchResults[claim.id] = evidence;
      }),
    );

    const factCheckPrompt = `
You are a meticulous fact-checking assistant.

You will receive an array of claims. Each claim includes:
- id
- claim_text
- search_query
- evidence_snippets: an array of { title, url, snippet } retrieved from the web.

For each claim, decide whether the evidence contradicts it or if the status remains uncertain. Use ONLY the provided snippets. Do not invent new facts.

If evidence snippets are available, the "suggestion" must describe a concrete remedial action or clarification grounded in the snippet(s) (and cite at least one \`sourceUrl\`). When evidence snippets are empty, still provide the most useful next step you can (e.g., what data to gather, who to consult, what baseline stats to reference) and explicitly note that no supporting evidence was found for "<search_query>" (replace "<search_query>" with the provided search_query string). These zero-evidence suggestions do not need a \`sourceUrl\`.

When the claim is contradicted or uncertain AND evidence snippets exist, derive the best available correction (the accurate fact) using those snippets, and set \`correction_source\` to the most relevant snippet URL. If no evidence snippets are available, set both \`correction\` and \`correction_source\` to empty strings.

Return ONLY valid JSON with this schema:
{
  "results": [
    {
      "id": string,
      "verdict": "contradicted" | "uncertain",
      "suggestion": string,
      "correction": string,
      "correction_source": string,
      "evidence": [
        { "snippet": string, "sourceUrl": string }
      ]
    }
  ]
}
`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1200,
        system: factCheckPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  claims: claims.map((claim) => ({
                    id: claim.id,
                    claim_text: claim.claimText,
                    search_query: claim.searchQuery,
                    evidence_snippets: searchResults[claim.id] ?? [],
                  })),
                }),
              },
            ],
          },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const text = await claudeResponse.text();
      console.error('Claude fact-check API error:', text);
      return NextResponse.json(
        { error: 'Claude API call failed', details: text },
        { status: 502 },
      );
    }

    const claudeJson = await claudeResponse.json();
    const rawText: string =
      claudeJson?.content?.[0]?.text ??
      claudeJson?.content?.[0]?.content ??
      '';

    let parsed: any;
    try {
      parsed = JSON.parse(extractJsonPayload(rawText));
    } catch (err) {
      console.error('Failed to parse JSON from Claude fact-check:', rawText);
      return NextResponse.json(
        { error: 'Failed to parse JSON from Claude response.' },
        { status: 500 },
      );
    }

    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    const sanitizedResults = results.map((result: any) => {
      const verdict =
        result?.verdict === 'contradicted' ? 'contradicted' : 'uncertain';
      return {
        id: toText(result?.id),
        verdict,
        suggestion: toText(result?.suggestion),
        correction: toText(result?.correction),
        correctionSource: toText(result?.correction_source),
        evidence: Array.isArray(result?.evidence)
          ? result.evidence.map((evi: any) => ({
            snippet: toText(evi?.snippet),
            sourceUrl: toText(evi?.sourceUrl),
          }))
          : [],
      };
    });

    return NextResponse.json({ results: sanitizedResults, searchResults });
  } catch (error) {
    console.error('Error in /api/fact-check:', error);
    return NextResponse.json(
      { error: 'Unexpected server error.' },
      { status: 500 },
    );
  }
}


