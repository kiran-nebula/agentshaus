export interface DiscoverAgent {
  id: string;
  name: string;
  query: string;
  isPublic: boolean;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  subscriberCount: number;
  viewUrl?: string;
  status?: string;
}

export interface AgentResult {
  runAt: string;
  title: string;
  content: string;
  sources: { name: string; url: string; favicon?: string }[];
  agentCount: number;
}
