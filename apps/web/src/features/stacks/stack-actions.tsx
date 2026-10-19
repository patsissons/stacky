import { useNavigate } from '@tanstack/react-router'
import {
  ArrowDownToLine,
  ArrowUpCircle,
  ChevronDown,
  CircleHelp,
  Loader2,
  Play,
  PowerOff,
  RefreshCw,
  RotateCw,
  Rocket,
  Square,
  Trash2,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ActionOptions, StackAction, StackSummary } from '@stacky/shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { buildRows, planUpdates } from '@/features/containers/rows'
import { useDirtyEditor } from '@/features/editor/store'
import { helpStore } from '@/features/help/help-dialog'
import { runStackAction } from '@/features/operations/actions'
import { operationStore } from '@/features/operations/store'
import { UpdateAllDialog, type UpdateAllMode } from '@/features/updates/update-all-dialog'
import { useUpdates } from '@/hooks/use-updates'
import { ApiError } from '@/lib/api'

function report(err: unknown) {
  if (err instanceof ApiError) toast.error(err.message, { description: err.hint })
  else toast.error(err instanceof Error ? err.message : String(err))
}

export function useRunAction(stack: string) {
  const [pending, setPending] = useState<string>()
  const run = async (action: StackAction, options: ActionOptions = {}) => {
    setPending(action)
    try {
      return await runStackAction(stack, action, options)
    } catch (err) {
      report(err)
    } finally {
      setPending(undefined)
    }
  }
  return { run, pending }
}

/**
 * The sticky action bar on a stack page. Destructive actions confirm first. While the editor
 * holds unsaved edits, Deploy goes through its review dialog instead of deploying the files on
 * disk. Update applies the newer versions found by the update check (after a confirmation that
 * lists them); when none are known it pulls the current tags again.
 */
export function StackActions({ stack }: { stack: StackSummary }) {
  const navigate = useNavigate()
  const { run, pending } = useRunAction(stack.name)
  const [confirm, setConfirm] = useState<'down' | 'delete'>()
  const [removeVolumes, setRemoveVolumes] = useState(false)
  const [typed, setTyped] = useState('')
  const [updateMode, setUpdateMode] = useState<UpdateAllMode>()
  const confirmInput = useRef<HTMLInputElement>(null)
  const editor = useDirtyEditor(stack.name)
  const busy = !!stack.activeOperationId || !!pending
  const up = stack.status !== 'inactive' && stack.status !== 'stopped' && stack.status !== 'error'
  const { byRef } = useUpdates()
  const plan = useMemo(() => planUpdates(buildRows([stack]), byRef), [stack, byRef])
  const updates = plan.steps.length
  const updating =
    pending === 'update' || pending === 'pull-updates' || pending === 'deploy-updates'
  const updatesLabel = updates === 0 ? 'none found' : `${updates} found`

  const deploy = (options: ActionOptions = {}) =>
    editor ? editor.deploy(options) : void run('deploy', options)

  const spinner = (action: string) =>
    pending === action ? <Loader2 className="animate-spin" /> : undefined
  const confirmReady = confirm === 'down' || typed === stack.name
  const runConfirmed = async () => {
    const action = confirm!
    const op = await run(action, { removeVolumes })
    if (op && action === 'delete') void navigate({ to: '/' })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {stack.activeOperationId && (
        <Button
          variant="ghost"
          size="sm"
          className="text-primary"
          onClick={() => operationStore.open(stack.activeOperationId!)}
        >
          <Loader2 className="animate-spin" /> Working…
        </Button>
      )}
      <div className="flex">
        <Button size="sm" className="rounded-r-none" disabled={busy} onClick={() => deploy()}>
          {spinner('deploy') ?? <Rocket />} {editor ? 'Review & deploy' : 'Deploy'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              className="rounded-l-none border-l px-2"
              disabled={busy}
              aria-label="Deploy options"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Deploy with options</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => deploy({ pull: 'always' })}>
              <ArrowDownToLine className="size-4" /> Pull images, then deploy
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => deploy({ build: true })}>
              <RefreshCw className="size-4" /> Rebuild images, then deploy
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => deploy({ forceRecreate: true })}>
              <RotateCw className="size-4" /> Recreate all containers
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex">
        <Button
          size="sm"
          variant="outline"
          className="rounded-r-none"
          disabled={busy}
          onClick={() =>
            updates > 0 ? setUpdateMode('deploy') : void run('update', { prune: true })
          }
        >
          {updating ? <Loader2 className="animate-spin" /> : <RefreshCw />} Update
          {updates > 0 && (
            <span className="bg-primary/15 text-primary rounded px-1 text-xs tabular-nums">
              {updates}
            </span>
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="rounded-l-none border-l-0 px-2"
              disabled={busy}
              aria-label="Update options"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              Newer versions{' '}
              <span className="text-muted-foreground font-normal">({updatesLabel})</span>
            </DropdownMenuLabel>
            <DropdownMenuItem disabled={updates === 0} onSelect={() => setUpdateMode('deploy')}>
              <ArrowUpCircle className="size-4" /> Apply updates
            </DropdownMenuItem>
            <DropdownMenuItem disabled={updates === 0} onSelect={() => run('pull-updates')}>
              <ArrowDownToLine className="size-4" /> Pull updates only
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => run('update', { prune: true })}>
              <RefreshCw className="size-4" /> Re-pull current tags
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {up ? (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run('restart')}>
            {spinner('restart') ?? <RotateCw />} Restart
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run('stop')}>
            {spinner('stop') ?? <Square />} Stop
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run('start')}>
          {spinner('start') ?? <Play />} Start
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy} aria-label="More actions">
            More <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => run('pull')}>
            <ArrowDownToLine className="size-4" /> Pull images only
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirm('down')}>
            <PowerOff className="size-4" /> Down (remove containers)
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm('delete')}>
            <Trash2 className="size-4" /> Delete stack
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={helpStore.open}
        aria-label="What these actions do"
        title="What these actions do"
      >
        <CircleHelp />
      </Button>

      <UpdateAllDialog
        plan={plan}
        mode={updateMode}
        stack={stack.name}
        onClose={() => setUpdateMode(undefined)}
      />

      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(undefined)
            setRemoveVolumes(false)
            setTyped('')
          }
        }}
      >
        <AlertDialogContent
          // Radix focuses the Cancel button; typing the name is the next step, so focus that
          onOpenAutoFocus={(e) => {
            if (confirm !== 'delete') return
            e.preventDefault()
            confirmInput.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'delete' ? `Delete ${stack.name}?` : `Take ${stack.name} down?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'delete'
                ? 'Stops and removes the containers, then deletes the stack directory and every file in it. This cannot be undone.'
                : 'Stops and removes the containers and networks. The compose file and data stay on disk; deploy brings it back.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="remove-volumes"
                checked={removeVolumes}
                onCheckedChange={(v) => setRemoveVolumes(v === true)}
              />
              <Label htmlFor="remove-volumes" className="font-normal">
                Also remove named volumes (deletes their data)
              </Label>
            </div>
            {confirm === 'delete' && (
              <div className="space-y-1.5">
                <Label htmlFor="confirm-name" className="text-sm font-normal">
                  Type <span className="font-mono font-semibold">{stack.name}</span> to confirm
                </Label>
                <Input
                  id="confirm-name"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && confirmReady) {
                      e.preventDefault()
                      setConfirm(undefined)
                      void runConfirmed()
                    }
                  }}
                  autoComplete="off"
                  ref={confirmInput}
                />
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              disabled={!confirmReady}
              onClick={() => void runConfirmed()}
            >
              {confirm === 'delete' ? 'Delete stack' : 'Take down'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
