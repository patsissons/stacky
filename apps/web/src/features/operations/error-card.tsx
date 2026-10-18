import { AlertOctagon, Lightbulb } from 'lucide-react'
import type { OperationError } from '@stacky/shared'
import { cn } from '@/lib/utils'

/** A classified failure: what went wrong, and what to do about it. */
export function ErrorCard({
  error,
  className,
  children,
}: {
  error: Pick<OperationError, 'message' | 'hint'> & { code?: string }
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className={cn(
        'border-destructive/30 bg-destructive/8 rounded-lg border p-3 text-sm',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertOctagon className="text-destructive mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-medium break-words">{error.message}</p>
          {error.hint && (
            <p className="text-muted-foreground flex items-start gap-1.5 text-[13px]">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
              <span>{error.hint}</span>
            </p>
          )}
          {children}
        </div>
        {error.code && (
          <code className="text-muted-foreground bg-muted shrink-0 rounded px-1.5 py-0.5 text-[10px]">
            {error.code}
          </code>
        )}
      </div>
    </div>
  )
}
