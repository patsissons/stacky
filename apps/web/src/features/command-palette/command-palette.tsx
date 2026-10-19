import { useNavigate } from '@tanstack/react-router'
import {
  Boxes,
  CircleHelp,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCw,
  Settings,
  Square,
  FolderTree,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { stackStatusMeta, StatusDot } from '@/components/status'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { useStacks } from '@/hooks/use-stacks'
import { helpStore } from '@/features/help/help-dialog'
import { runStackAction } from '@/features/operations/actions'

export function useCommandPaletteShortcut() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return [open, setOpen] as const
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { data: stacks = [] } = useStacks()
  const managed = stacks.filter((s) => s.managed)

  const go = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }

  const action = (name: string, act: 'deploy' | 'start' | 'restart' | 'stop' | 'update') =>
    go(() => {
      runStackAction(name, act).catch((err: Error) => toast.error(err.message))
    })

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette">
      <CommandInput placeholder="Jump to a stack or run a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go(() => void navigate({ to: '/' }))}>
            <Boxes /> Containers
          </CommandItem>
          <CommandItem onSelect={() => go(() => void navigate({ to: '/new' }))}>
            <Plus /> New stack
          </CommandItem>
          <CommandItem onSelect={() => go(() => void navigate({ to: '/files' }))}>
            <FolderTree /> Files
          </CommandItem>
          <CommandItem onSelect={() => go(() => void navigate({ to: '/settings' }))}>
            <Settings /> Settings
          </CommandItem>
          <CommandItem onSelect={() => go(helpStore.open)}>
            <CircleHelp /> Help: what the operations do
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Stacks">
          {managed.map((s) => {
            const meta = stackStatusMeta(s.status)
            return (
              <CommandItem
                key={s.name}
                value={`stack ${s.name}`}
                onSelect={() =>
                  go(() => void navigate({ to: '/stacks/$name', params: { name: s.name } }))
                }
              >
                <StatusDot tone={meta.tone} className="mx-0.5" />
                {s.name}
                <span className="text-muted-foreground ml-auto text-xs">{meta.label}</span>
              </CommandItem>
            )
          })}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {managed.flatMap((s) => [
            <CommandItem
              key={`d-${s.name}`}
              value={`deploy ${s.name}`}
              onSelect={() => action(s.name, 'deploy')}
            >
              <Rocket /> Deploy {s.name}
            </CommandItem>,
            <CommandItem
              key={`u-${s.name}`}
              value={`update ${s.name}`}
              onSelect={() => action(s.name, 'update')}
            >
              <RefreshCw /> Update {s.name}
            </CommandItem>,
            <CommandItem
              key={`r-${s.name}`}
              value={`restart ${s.name}`}
              onSelect={() => action(s.name, 'restart')}
            >
              <RotateCw /> Restart {s.name}
            </CommandItem>,
            s.status === 'inactive' || s.status === 'stopped' ? (
              <CommandItem
                key={`s-${s.name}`}
                value={`start ${s.name}`}
                onSelect={() => action(s.name, 'start')}
              >
                <Play /> Start {s.name}
              </CommandItem>
            ) : (
              <CommandItem
                key={`s-${s.name}`}
                value={`stop ${s.name}`}
                onSelect={() => action(s.name, 'stop')}
              >
                <Square /> Stop {s.name}
              </CommandItem>
            ),
          ])}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
