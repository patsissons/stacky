import { ArrowUpCircle, Loader2, RefreshCw, RotateCw, Rocket } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { SelfInfo } from '@stacky/shared'
import { Button } from '@/components/ui/button'
import { runSelfAction } from '@/features/operations/actions'
import { useSelf } from '@/hooks/use-self'
import { ApiError } from '@/lib/api'

/** The release to move to: pinned tags move to the new version, moving tags just pull. */
export function updateTarget(info: SelfInfo | undefined): string | undefined {
  if (!info?.latestRelease || info.movingTag) return undefined
  return info.latestRelease.version
}

function useSelfAction() {
  const [pending, setPending] = useState<string>()
  const run = async (action: 'update' | 'deploy' | 'restart', targetVersion?: string) => {
    setPending(action)
    try {
      await runSelfAction(action, targetVersion)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        description: err instanceof ApiError ? err.hint : undefined,
      })
    } finally {
      setPending(undefined)
    }
  }
  return { run, pending }
}

/** Action bar for the stack that runs stacky itself: no stop/down/delete. */
export function SelfActions() {
  const { data: info } = useSelf()
  const { run, pending } = useSelfAction()
  if (!info) return null
  if (!info.available) {
    return <p className="text-muted-foreground max-w-sm text-right text-xs">{info.reason}</p>
  }
  const spin = (a: string, icon: React.ReactNode) =>
    pending === a ? <Loader2 className="animate-spin" /> : icon
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={!!pending} onClick={() => run('update', updateTarget(info))}>
        {spin('update', <RefreshCw />)}
        {info.latestRelease ? `Update to ${info.latestRelease.version}` : 'Update stacky'}
      </Button>
      <Button size="sm" variant="outline" disabled={!!pending} onClick={() => run('deploy')}>
        {spin('deploy', <Rocket />)} Redeploy
      </Button>
      <Button size="sm" variant="outline" disabled={!!pending} onClick={() => run('restart')}>
        {spin('restart', <RotateCw />)} Restart
      </Button>
    </div>
  )
}

/** Top-of-page notice when a newer stacky release exists. */
export function UpdateBanner() {
  const { data: info } = useSelf()
  const { run, pending } = useSelfAction()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('stacky:update-dismissed') ?? ''
    } catch {
      return ''
    }
  })
  const release = info?.latestRelease
  if (!release || dismissed === release.version) return null
  const dismiss = () => {
    setDismissed(release.version)
    try {
      sessionStorage.setItem('stacky:update-dismissed', release.version)
    } catch {
      // storage unavailable
    }
  }
  return (
    <div className="bg-primary/8 flex flex-wrap items-center gap-2 border-b px-4 py-1.5 text-sm">
      <ArrowUpCircle className="text-primary size-4" />
      <span>
        stacky <span className="font-semibold">{release.version}</span> is available (you have{' '}
        {info.version}).
      </span>
      <a
        href={release.url}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline-offset-2 hover:underline"
      >
        Release notes
      </a>
      <div className="ml-auto flex gap-1">
        {info.available && (
          <Button
            size="sm"
            className="h-7"
            disabled={!!pending}
            onClick={() => run('update', updateTarget(info))}
          >
            {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Update now
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7" onClick={dismiss}>
          Later
        </Button>
      </div>
    </div>
  )
}
