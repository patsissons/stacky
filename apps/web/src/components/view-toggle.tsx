import { LayoutGrid, Rows3 } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { isViewMode, type ViewMode } from '@/hooks/use-view-mode'
import { cn } from '@/lib/utils'

/** Switches a page between cards and a table. Phones always get cards, so it hides there. */
export function ViewToggle({
  value,
  onChange,
  className,
}: {
  value: ViewMode
  onChange: (view: ViewMode) => void
  className?: string
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(v) => isViewMode(v) && onChange(v)}
      aria-label="View"
      className={cn('hidden md:flex', className)}
    >
      <ToggleGroupItem value="cards" aria-label="Card view" title="Card view">
        <LayoutGrid className="size-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="table" aria-label="Table view" title="Table view">
        <Rows3 className="size-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
