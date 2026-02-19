import { WorkspacePlaceholder } from '@/components/workspace-placeholder';

export default function FilesPage() {
  return (
    <WorkspacePlaceholder
      title="Files"
      description="Browse and manage workspace files used by your agents."
      primaryHref="/create"
      primaryLabel="Create New Agent"
    />
  );
}
