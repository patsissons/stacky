import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import type { ValidationIssue } from '@stacky/shared'
import { cn } from '@/lib/utils'

export function ValidationStatus({
  validating,
  issues,
}: {
  validating: boolean
  issues: ValidationIssue[]
}) {
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  if (validating && issues.length === 0)
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> Validating
      </span>
    )
  if (errors)
    return (
      <span className="text-destructive flex items-center gap-1 text-xs font-medium">
        <AlertTriangle className="size-3.5" /> {errors} error{errors > 1 ? 's' : ''}
      </span>
    )
  return (
    <span
      className="text-status-running flex items-center gap-1 text-xs font-medium"
      data-testid="validation-ok"
    >
      <CheckCircle2 className="size-3.5" /> Valid
      {warnings ? ` · ${warnings} warning${warnings > 1 ? 's' : ''}` : ''}
    </span>
  )
}

export function IssueList({ issues }: { issues: ValidationIssue[] }) {
  return (
    <ul
      className="max-h-36 space-y-1 overflow-y-auto rounded-lg border p-2 text-sm"
      aria-label="Validation issues"
    >
      {issues.map((issue, i) => (
        <li key={i} className="flex items-start gap-2">
          <AlertTriangle
            className={cn(
              'mt-0.5 size-3.5 shrink-0',
              issue.severity === 'error' ? 'text-destructive' : 'text-status-warning',
            )}
          />
          <span className="min-w-0 break-words">
            {issue.line && (
              <span className="text-muted-foreground mr-1.5 font-mono text-xs">
                line {issue.line}
              </span>
            )}
            {issue.message}
          </span>
        </li>
      ))}
    </ul>
  )
}
