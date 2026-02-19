import { WorkspacePlaceholder } from '@/components/workspace-placeholder';

export default function HostingPage() {
  return (
    <WorkspacePlaceholder
      title="Hosting"
      description="Deployment and runtime controls for agent infrastructure."
      primaryHref="/dashboard"
      primaryLabel="Open Agents"
    />
  );
}
