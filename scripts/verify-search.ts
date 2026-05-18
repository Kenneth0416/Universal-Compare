import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const apiKey = process.env.MINIMAX_API_KEY!;
  const baseUrl = (process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1').replace('/v1', '');

  const queries = ['Tesla electric vehicle 2025', 'BYD vs Tesla comparison', 'Python programming'];

  for (const q of queries) {
    const res = await fetch(`${baseUrl}/v1/coding_plan/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json()) as any;
    const results = data.organic || data.results || [];
    console.log(`\n"${q}" → ${results.length} results`);
    results.slice(0, 2).forEach((r: any, i: number) =>
      console.log(`  [${i + 1}] ${r.title}\n      ${r.link || r.url}\n      ${(r.snippet || '').slice(0, 100)}`),
    );
  }
}

main().catch(console.error);
