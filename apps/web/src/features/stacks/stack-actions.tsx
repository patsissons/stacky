import { useNavigate } from '@tanstack/react-router'
import {
  ArrowDownToLine,
  ChevronDown,
  Loader2,
  Play,
  PowerOff,
  RefreshCw,
  RotateCw,
  Rocket,
  Square,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
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
import { runStackAction } from '@/features/operations/actions'
import { operationStore } from '@/features/operations/store'
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

/** The sticky action bar on a stack page. Destructive actions confirm first. */
export function StackActions({ stack }: { stack: StackSummary }) {
  const navigate = useNavigate()
  const { run, pending } = useRunAction(stack.name)
  const [confirm, setConfirm] = useState<'down' | 'delete'>()
  const [removeVolumes, setRemoveVolumes] = useState(false)
  const [typed, setTyped] = useState('')
  const busy = !!stack.activeOperationId || !!pending
  const up = stack.status !== 'inactive' && stack.status !== 'stopped' && stack.status !== 'error'

  const spinner = (action: string) =>
    pending === action ? <Loader2 className="animate-spin" /> : undefined

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
        <Button size="sm" className="rounded-r-none" disabled={busy} onClick={() => run('deploy')}>
          {spinner('deploy') ?? <Rocket />} Deploy
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
            <DropdownMenuItem onSelect={() => run('deploy', { pull: 'always' })}>
              <ArrowDownToLine className="size-4" /> Pull images, then deploy
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run('deploy', { build: true })}>
              <RefreshCw className="size-4" /> Rebuild images, then deploy
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run('deploy', { forceRecreate: true })}>
              <RotateCw className="size-4" /> Recreate all containers
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => run('update', { prune: true })}
      >
        {spinner('update') ?? <RefreshCw />} Update
      </Button>
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
        <AlertDialogContent>
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
                  autoComplete="off"
                />
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              disabled={confirm === 'delete' && typed !== stack.name}
              onClick={async () => {
                const action = confirm!
                const op = await run(action, { removeVolumes })
                if (op && action === 'delete') void navigate({ to: '/' })
              }}
            >
              {confirm === 'delete' ? 'Delete stack' : 'Take down'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
