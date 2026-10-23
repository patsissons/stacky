import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { ActionOptions, DeployPreview, PreviewAction } from '@stacky/shared'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const GROUPS: { action: PreviewAction; label: string; tone: string }[] = [
  { action: 'recreate', label: 'Recreate', tone: 'text-status-warning' },
  { action: 'remove', label: 'Remove', tone: 'text-destructive' },
  { action: 'create', label: 'Create', tone: 'text-status-running' },
  { action: 'start', label: 'Start', tone: 'text-status-running' },
  { action: 'unchanged', label: 'Unchanged', tone: 'text-muted-foreground' },
]

/** What the deploy will do to each container, from a compose dry run of the unsaved files. */
export function DeployPreviewSummary({
  stack,
  compose,
  env,
  options,
}: {
  stack: string
  compose?: string
  env?: string
  options: ActionOptions
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['deploy-preview', stack, compose, env, options],
    queryFn: () =>
      api.post<DeployPreview>(`/api/stacks/${stack}/preview`, { compose, env, options }),
    // containers change under us: always ask again when the dialog opens
    gcTime: 0,
    retry: false,
  })

  if (isLoading) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <Loader2 className="size-3.5 animate-spin" /> Checking what Compose will change…
      </p>
    )
  }
  if (isError || !data?.ok) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="deploy-preview">
        Couldn&apos;t preview this deploy{data?.message ? `: ${data.message}` : ''}.
      </p>
    )
  }

  const groups = GROUPS.map((g) => ({
    ...g,
    names: data.containers.filter((c) => c.action === g.action).map((c) => c.name),
  })).filter((g) => g.names.length)
  const recreates = groups.find((g) => g.action === 'recreate')?.names.length ?? 0

  return (
    <div className="space-y-2 text-sm" data-testid="deploy-preview">
      {groups.length ? (
        <ul className="space-y-1">
          {groups.map((g) => (
            <li key={g.action} className="break-words">
              <span className={cn('mr-1 font-medium', g.tone)}>{g.label}</span>{' '}
              {g.action === 'unchanged' ? (
                <span className="text-muted-foreground">
                  {g.names.length} container{g.names.length > 1 ? 's' : ''}
                </span>
              ) : (
                <span className="font-mono text-xs">{g.names.join(', ')}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No containers change.</p>
      )}
      {data.composeMismatch && recreates > 0 && (
        <p className="text-status-warning flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            These containers were created by Docker Compose{' '}
            {data.composeMismatch.deployedWith.join(', ')}, and Stacky uses{' '}
            {data.composeMismatch.current}. Compose can&apos;t match them to the file, so this
            deploy recreates them even where nothing changed. Later deploys only touch what changes.
          </span>
        </p>
      )}
    </div>
  )
}
