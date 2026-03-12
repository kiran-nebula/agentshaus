import { NextResponse } from 'next/server';
import { createScout } from '@/lib/yutori';

const SEED_AGENTS = [
  {
    query:
      'If new movies get a 90%+ on Rotten Tomatoes LMK which streaming service I can watch them on. Include a link to a preview and a link to where I can watch them.',
  },
  {
    query:
      'Send me a daily morning briefing with top tech news, S&P 500 performance, and today\'s weather forecast.',
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

export async function POST() {
  try {
    const results = [];

    for (const agent of SEED_AGENTS) {
      try {
        const scout = await createScout({
          query: agent.query,
          isPublic: true,
          outputInterval: 86400,
        });
        results.push({
          query: agent.query.slice(0, 60),
          id: scout.id,
          name: scout.display_name,
          status: 'created',
        });
      } catch (err) {
        results.push({
          query: agent.query.slice(0, 60),
          status: 'error',
          error: String(err),
        });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Failed to seed discover agents:', err);
    return NextResponse.json(
      { error: 'Failed to seed agents' },
      { status: 500 },
    );
  }
}
