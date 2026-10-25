import { ExternalLink, Search } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { OPERATIONS } from './operations'
import { filterReference, type RefEntry } from './reference'

export const DOCS_URL = 'https://stacky.lgtm.page'

export type HelpTab = 'operations' | 'reference'

let state: { open: boolean; tab: HelpTab } = { open: false, tab: 'operations' }
const listeners = new Set<() => void>()
function setState(next: Partial<typeof state>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

/** Opens the help from anywhere (header, action bars, command palette), on the given tab. */
export const helpStore = {
  open: (tab: HelpTab = 'operations') => setState({ open: true, tab }),
  close: () => setState({ open: false }),
  setTab: (tab: HelpTab) => setState({ tab }),
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

const SCROLL = '-mx-6 min-h-0 space-y-5 overflow-y-auto px-6'

/** What each operation does, and every label and environment variable stacky understands. */
export function HelpDialog() {
  const { open, tab } = useSyncExternalStore(helpStore.subscribe, helpStore.get)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && helpStore.close()}>
      <DialogContent className="max-h-[85svh] grid-rows-[auto_1fr_auto] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Help</DialogTitle>
          <DialogDescription>
            {tab === 'operations' ? (
              <>
                Every action runs the real <code>docker compose</code> CLI in the stack&apos;s
                directory and streams its output.
              </>
            ) : (
              <>
                Set labels under a service&apos;s <code>labels:</code>, and environment variables on
                stacky&apos;s own container.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => helpStore.setTab(v as HelpTab)}
          className="flex min-h-0 min-w-0 flex-col gap-3"
        >
          <TabsList className="shrink-0">
            <TabsTrigger value="operations">Operations</TabsTrigger>
            <TabsTrigger value="reference">Labels &amp; environment</TabsTrigger>
          </TabsList>
          <TabsContent value="operations" className={SCROLL}>
            <Operations />
          </TabsContent>
          <TabsContent value="reference" className="flex min-h-0 flex-col gap-3">
            <Reference />
          </TabsContent>
        </Tabs>
        <DialogFooter className="flex-row flex-wrap gap-x-3 gap-y-1 sm:justify-start">
          {tab === 'operations' ? (
            <>
              <DocsLink href={`${DOCS_URL}/guides/using-stacky/`}>Using stacky</DocsLink>
              <DocsLink href={`${DOCS_URL}/guides/image-updates/`}>Image updates</DocsLink>
              <DocsLink href={`${DOCS_URL}/how-it-works/errors/`}>Errors</DocsLink>
            </>
          ) : (
            <>
              <DocsLink href={`${DOCS_URL}/reference/labels/`}>Labels</DocsLink>
              <DocsLink href={`${DOCS_URL}/reference/configuration/`}>Configuration</DocsLink>
              <DocsLink href={`${DOCS_URL}/guides/notifications/`}>Notifications</DocsLink>
            </>
          )}
          <DocsLink href={DOCS_URL}>Full documentation</DocsLink>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Operations() {
  return OPERATIONS.map((section) => (
    <section key={section.title} aria-label={section.title}>
      <SectionTitle>{section.title}</SectionTitle>
      <dl className="space-y-2.5">
        {section.entries.map((e) => (
          <div key={e.name} className="text-sm">
            <dt className="font-medium">{e.name}</dt>
            <dd className="text-muted-foreground">{e.what}</dd>
            {e.command && <Code>{e.command}</Code>}
          </div>
        ))}
      </dl>
    </section>
  ))
}

function Reference() {
  const [query, setQuery] = useState('')
  const sections = filterReference(query)
  return (
    <>
      <div className="relative shrink-0">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter labels and variables"
          aria-label="Filter labels and variables"
          className="h-8 pl-8 text-sm"
        />
      </div>
      <div className={SCROLL}>
        {sections.length === 0 && (
          <p className="text-muted-foreground py-6 text-center text-sm">Nothing matches.</p>
        )}
        {sections.map((section) => (
          <section key={section.title} aria-label={section.title}>
            <SectionTitle>{section.title}</SectionTitle>
            {section.intro && (
              <p className="text-muted-foreground mb-2.5 text-sm">{section.intro}</p>
            )}
            <dl className="space-y-2.5">
              {section.entries.map((e) => (
                <ReferenceEntry key={e.name} entry={e} />
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  )
}

function ReferenceEntry({ entry: e }: { entry: RefEntry }) {
  return (
    <div className="text-sm">
      <dt className="font-mono text-[13px] font-medium [overflow-wrap:anywhere]">
        {e.name}
        {e.aliases && (
          <span className="text-muted-foreground ml-2 font-sans text-xs font-normal">
            also {e.aliases.join(', ')}
          </span>
        )}
      </dt>
      <dd className="text-muted-foreground">{e.what}</dd>
      {e.default && (
        <dd className="text-muted-foreground mt-0.5 text-xs">
          Default: <span className="text-foreground">{e.default}</span>
        </dd>
      )}
      {e.example && <Code>{e.example}</Code>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
      {children}
    </h3>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <dd className="mt-0.5 font-mono text-xs">
      <code className="bg-muted inline-block rounded px-1.5 py-0.5 break-all whitespace-pre-wrap">
        {children}
      </code>
    </dd>
  )
}

function DocsLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
    >
      {children} <ExternalLink className="size-3.5" />
    </a>
  )
}
