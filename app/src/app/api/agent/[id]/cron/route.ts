import { spawnSync } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';

type CronJob = {
  schedule: string;
  command: string;
  marker: string;
  jobName: string | null;
  raw: string;
};

const MARKER_PREFIX = 'agentshaus:';

function readCurrentCrontab():
  | { ok: true; content: string }
  | { ok: false; available: boolean; error: string } {
  const result = spawnSync('crontab', ['-l'], { encoding: 'utf8' });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        ok: false,
        available: false,
        error: 'crontab command is not available on this host',
      };
    }
    return {
      ok: false,
      available: false,
      error: result.error.message,
    };
  }

  if (result.status === 0) {
    return { ok: true, content: result.stdout || '' };
  }

  const combined = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase();
  if (combined.includes('no crontab for')) {
    return { ok: true, content: '' };
  }

  return {
    ok: false,
    available: true,
    error: result.stderr || 'Failed to read crontab',
  };
}

function parseJobsForAgent(crontab: string, soulMint: string): CronJob[] {
  const markerNeedle = `${MARKER_PREFIX}${soulMint}:`;

  return crontab
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.includes(markerNeedle))
    .map((line) => {
      const scheduleMatch = line.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/);
      const schedule = scheduleMatch ? scheduleMatch[1] : '';
      const rest = scheduleMatch ? scheduleMatch[2] : line;
      const markerMatch = rest.match(/#\s*(agentshaus:[^\s]+)/);
      const marker = markerMatch ? markerMatch[1] : '';
      const command = marker
        ? rest.replace(/\s*#\s*agentshaus:[^\s]+\s*$/, '').trim()
        : rest.trim();
      const markerParts = marker.split(':');
      const jobName =
        markerParts.length >= 3 ? markerParts.slice(2).join(':') : null;

      return {
        schedule,
        command,
        marker,
        jobName,
        raw: line,
      };
    });
}

/**
 * GET /api/agent/[id]/cron
 * Lists active local crontab jobs tagged for this agent.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: soulMint } = await params;
  const crontab = readCurrentCrontab();

  if (!crontab.ok) {
    return NextResponse.json({
      ok: false,
      available: crontab.available,
      jobs: [],
      error: crontab.error,
    });
  }

  const jobs = parseJobsForAgent(crontab.content, soulMint);
  return NextResponse.json({
    ok: true,
    available: true,
    jobs,
  });
}
