import { NextRequest, NextResponse } from 'next/server';
import { listScouts, getScoutUpdates } from '@/lib/yutori';

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

async function getHeaderImage(scoutId: string): Promise<string | null> {
  try {
    const updates = await getScoutUpdates(scoutId, { pageSize: 1 });
    return updates.updates[0]?.header_image_url || null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status') as 'active' | 'paused' | 'done' | null;

    const data = await listScouts({
      status: status || 'active',
      includeAllSources: true,
    });

    // Fetch header images in parallel for all scouts
    const headerImages = await Promise.all(
      data.scouts.map((scout) => getHeaderImage(scout.id)),
    );

    const agents = data.scouts.map((scout, i) => ({
      id: scout.id,
      name: getDisplayName(scout),
      query: scout.query,
      status: scout.status,
      createdAt: scout.created_at,
      lastRunAt: scout.last_update_timestamp || null,
      nextRunAt: scout.next_output_timestamp || scout.next_run_timestamp || null,
      outputInterval: scout.output_interval,
      isPublic: scout.is_public ?? true,
      subscriberCount: 0,
      headerImage: headerImages[i],
    }));

    return NextResponse.json({ agents, total: data.total });
  } catch (err) {
    console.error('Failed to list discover agents:', err);
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 },
    );
  }
}
