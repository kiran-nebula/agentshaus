import { WorkspacePlaceholder } from '@/components/workspace-placeholder';

export default function SystemPage() {
  return (
    <WorkspacePlaceholder
      title="System"
      description="System-level controls and environment status for this workspace."
      primaryHref="/settings"
      primaryLabel="Open Settings"
    />
  );
}
