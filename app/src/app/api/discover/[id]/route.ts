import { NextRequest, NextResponse } from 'next/server';
import { getScout, getScoutUpdates } from '@/lib/yutori';

// Short display names for seeded agents (matched by query prefix)
const NAME_OVERRIDES: Record<string, string> = {
  'If new movies get a 90%+': 'Top Rated New Movies',
  'Send me a daily morning briefing': 'Daily Tech & Market Briefing',
  'Please provide a daily report at 8am': 'AI Tooling Daily Report',
  'Monitor venture capital and private equity': 'VC & PE Deal Tracker',
  'Summarize important-feeling or actionable': 'Dwarkesh Podcast Highlights',
  'The best sci fi news': 'Sci-Fi News Roundup',
  'Top Solana ecosystem news': 'Top Solana News',
};

function getDisplayName(scout: { display_name: string; query: string }): string {
  if (scout.display_name === scout.query || scout.display_name.length > 60) {
    for (const [prefix, name] of Object.entries(NAME_OVERRIDES)) {
      if (scout.query.startsWith(prefix)) return name;
    }
  }
  return scout.display_name || scout.query.slice(0, 60);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const [scout, updatesData] = await Promise.all([
      getScout(id),
      getScoutUpdates(id, { pageSize: 20 }),
    ]);

    const agent = {
      id: scout.id,
      name: getDisplayName(scout),
      query: scout.query,
      status: scout.status,
      createdAt: scout.created_at,
      lastRunAt: scout.last_update_timestamp || null,
      nextRunAt: scout.next_output_timestamp || scout.next_run_timestamp || null,
      outputInterval: scout.output_interval,
      isPublic: scout.is_public ?? true,
      updateCount: scout.update_count || 0,
      subscriberCount: 0,
    };

    const results = updatesData.updates.map((update) => ({
      id: update.id,
      runAt: new Date(update.timestamp).toISOString(),
      content: update.content,
      headerImage: update.header_image_url || null,
      citations: update.citations.map((c) => ({
        id: c.id,
        url: c.url,
        previewData: c.preview_data || null,
      })),
      stats: update.stats,
    }));

    return NextResponse.json({ agent, results });
  } catch (err) {
    console.error('Failed to fetch discover agent:', err);
    return NextResponse.json(
      { error: 'Failed to fetch agent details' },
      { status: 500 },
    );
  }
}
