/**
 * Seed script: creates pre-built agents via Yutori Scouting API.
 * Run once with: bun scripts/seed-scouts.ts
 */

const YUTORI_API_KEY = 'yt_w3k5rO7O9lrf9ljkh9kRHU8nemKTtzVjzw_gc6c_u4Q';
const YUTORI_BASE_URL = 'https://api.yutori.com';

const AGENTS = [
  {
    query:
      'If new movies get a 90%+ on Rotten Tomatoes LMK which streaming service I can watch them on. Include a link to a preview and a link to where I can watch them.',
  },
  {
    query:
      "Send me a daily morning briefing with top tech news, S&P 500 performance, and today's weather forecast.",
  },
  {
    query:
      'Please provide a daily report at 8am on the latest trends in AI tooling and applying AI on real tasks. Avoid sensationalist or click-baity content. Prefer sources from YouTube, HackerNews, podcasts, newsletters, blogs, and research papers. Ignore sources from traditional news publications with a history of bias or shallow reporting like Fortune or Business Insider. I want to know what tools are being released, what people are building with AI, and what new techniques are being used.',
  },
  {
    query:
      'Monitor venture capital and private equity deals above $50M in North America and Europe, focusing on B2B software, industrial automation, and climate tech sectors. Include deal size, lead investors, company stage, and any strategic rationale mentioned in press releases or investor statements.',
  },
  {
    query:
      'Summarize important-feeling or actionable points from new episodes of the Dwarkesh podcast.',
  },
  {
    query: 'The best sci fi news from across the internet.',
  },
  {
    query:
      'Top Solana ecosystem news distilled from X (Twitter). Focus on protocol updates, DeFi developments, new project launches, governance proposals, and notable community discussions. Include links to the original tweets or threads.',
  },
];

async function createScout(query: string) {
  const res = await fetch(`${YUTORI_BASE_URL}/v1/scouting/tasks`, {
    method: 'POST',
    headers: {
      'X-API-Key': YUTORI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      is_public: true,
      output_interval: 86400,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function main() {
  console.log('Seeding agents via Yutori API...\n');

  for (const agent of AGENTS) {
    const shortQuery = agent.query.slice(0, 60);
    try {
      const result = await createScout(agent.query);
      console.log(`  [OK] ${result.display_name || shortQuery}`);
      console.log(`       ID: ${result.id}`);
    } catch (err) {
      console.error(`  [FAIL] ${shortQuery}`);
      console.error(`         ${err}`);
    }
  }

  console.log('\nDone.');
}

main();
