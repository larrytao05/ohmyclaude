import { NextRequest, NextResponse } from 'next/server';

type ClaimSpan = {
  id: string;
  claimText: string;
  startChar: number;
  endChar: number;
  searchQuery: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const content: string | undefined = body?.content;

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "content" in request body.' },
        { status: 400 },
      );
    }

    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'CLAUDE_API_KEY is not set in environment.' },
        { status: 500 },
      );
    }

    const prompt = `
You are given a document. Extract a list of DISTINCT, FACT-CHECKABLE claims.

For each claim, you MUST:
- Provide the exact substring from the document as "claim_text" (word-for-word, no edits).
- Provide "start_char" and "end_char" character offsets into the ORIGINAL document string (0-based, end_char exclusive).
- Provide a concise "search_query" that a web search engine could use to verify this claim.

Focus on concrete, factual statements (dates, numbers, named entities, causal claims, statistics, etc.).
Avoid vague opinions or purely subjective statements.

Return ONLY valid JSON with this exact shape:
{
  "claims": [
    {
      "claim_text": string,
      "start_char": number,
      "end_char": number,
      "search_query": string
    }
  ]
}
`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: prompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `DOCUMENT:\n\n${content}`,
              },
            ],
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      console.error('Claude API error:', text);
      return NextResponse.json(
        { error: 'Claude API call failed', details: text },
        { status: 502 },
      );
    }

    const claudeJson = await claudeRes.json();
    const rawText: string =
      claudeJson?.content?.[0]?.text ??
      claudeJson?.content?.[0]?.content ??
      '';

    const extractJsonPayload = (text: string) => {
      if (!text) return '';
      const trimmed = text.trim();
      const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fencedMatch?.[1]) {
        return fencedMatch[1].trim();
      }
      return trimmed;
    };

    let parsed: any;
    try {
      parsed = JSON.parse(extractJsonPayload(rawText));
    } catch (err) {
      console.error('Failed to parse JSON from Claude:', rawText);
      return NextResponse.json(
        { error: 'Failed to parse JSON from Claude response.' },
        { status: 500 },
      );
    }

    const claims: ClaimSpan[] = Array.isArray(parsed?.claims)
      ? parsed.claims.map((c: any, index: number) => ({
        id: `claim-${index}`,
        claimText: String(c.claim_text ?? ''),
        startChar: Number(c.start_char ?? 0),
        endChar: Number(c.end_char ?? 0),
        searchQuery: String(c.search_query ?? ''),
      }))
      : [];

    return NextResponse.json({ claims });
  } catch (error) {
    console.error('Error in /api/fact-claims:', error);
    return NextResponse.json(
      { error: 'Unexpected server error.' },
      { status: 500 },
    );
  }
}


