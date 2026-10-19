import { ExternalLink } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export const DOCS_URL = 'https://stacky.lgtm.page'

let open = false
const listeners = new Set<() => void>()
function setOpen(next: boolean) {
  open = next
  for (const l of listeners) l()
}

/** Opens the operations help from anywhere (header, action bars, command palette). */
export const helpStore = {
  open: () => setOpen(true),
  close: () => setOpen(false),
  get: () => open,
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

interface Entry {
  name: string
  what: string
  command?: string
}

const SECTIONS: { title: string; entries: Entry[] }[] = [
  {
    title: 'Stack actions',
    entries: [
      {
        name: 'Deploy',
        what: 'Checks the compose file, then creates or updates the containers so they match it. Removes containers for services you deleted.',
        command: 'docker compose up -d --remove-orphans',
      },
      {
        name: 'Deploy → Pull images, then deploy',
        what: 'Pulls every image before deploying, so tags like latest move to the newest build.',
        command: 'docker compose up -d --pull always',
      },
      {
        name: 'Deploy → Rebuild images, then deploy',
        what: 'Rebuilds services that have a build: section (Dockerfile) before deploying.',
        command: 'docker compose up -d --build',
      },
      {
        name: 'Deploy → Recreate all containers',
        what: 'Replaces every container even if nothing changed. Useful after changing files a container reads only at start.',
        command: 'docker compose up -d --force-recreate',
      },
      {
        name: 'Update',
        what: 'Pulls the tags already in the compose file again, which only helps for tags like latest. If the stack is running, recreates the containers whose image changed and removes dangling images. A stopped stack stays stopped.',
        command: 'docker compose pull → up -d → docker image prune',
      },
      {
        name: 'Update → Pull updates',
        what: 'Downloads the newer versions found by Check for updates, ahead of time. The compose file and the running containers are left alone.',
        command: 'docker pull <image>:<new tag> · docker compose pull <rebuilt services>',
      },
      {
        name: 'Update → Pull updates & deploy',
        what: 'Writes the newer version tags into the compose file (only the image: lines), then pulls and recreates the services that have an update. Works for pinned versions like nginx:1.27.3.',
        command: 'docker compose pull <services> → up -d <services> → docker image prune',
      },
      {
        name: 'Restart',
        what: 'Restarts the existing containers without recreating them. Compose file changes are not applied; use Deploy for that.',
        command: 'docker compose restart',
      },
      {
        name: 'Stop / Start',
        what: 'Stop halts the containers but keeps them. Start brings the stack up again from its compose file.',
        command: 'docker compose stop · docker compose up -d',
      },
      {
        name: 'More → Pull images only',
        what: 'Pulls the tags already in the compose file again, without touching the running containers. They switch over on the next deploy. For pinned versions use Update → Pull updates.',
        command: 'docker compose pull',
      },
      {
        name: 'More → Down',
        what: 'Stops and removes the containers and networks. Files and named volumes stay, unless you tick the option to remove volumes, which deletes their data.',
        command: 'docker compose down --remove-orphans [--volumes]',
      },
      {
        name: 'More → Delete stack',
        what: 'Takes the stack down, then deletes its directory and every file in it. This cannot be undone.',
      },
    ],
  },
  {
    title: 'Containers and updates',
    entries: [
      {
        name: 'Start / Stop / Restart (one service)',
        what: 'The same as the stack actions, for a single service only.',
        command: 'docker compose up -d --no-deps <service> · stop · restart',
      },
      {
        name: 'Check for updates',
        what: 'Asks each image’s registry whether a newer version or a new build of the same tag exists. Nothing is changed.',
      },
      {
        name: 'Update to <version>',
        what: 'Changes only the service’s image: line in the compose file to the newer tag, then pulls and recreates that service.',
      },
      {
        name: 'Pull <tag>',
        what: 'Pulls the rebuilt image behind the same tag and recreates that service.',
        command: 'docker compose pull <service> → up -d --no-deps <service>',
      },
      {
        name: 'Update all',
        what: 'Applies every available update above after you confirm the list: one Pull updates & deploy per stack.',
      },
      {
        name: 'Update all → Pull all updates',
        what: 'Downloads every available update without applying it: one Pull updates per stack.',
      },
      {
        name: 'Ignore this update',
        what: 'Hides that specific version or digest. The next newer one shows up again.',
      },
    ],
  },
  {
    title: 'stacky itself',
    entries: [
      {
        name: 'Update stacky',
        what: 'Pulls the new stacky image, then a short-lived updater container swaps stacky over and rolls back automatically if the new version does not start.',
      },
      {
        name: 'Redeploy / Restart',
        what: 'Applies edits to stacky’s compose file, or recreates its container, through the same updater.',
      },
    ],
  },
]

/** Plain explanations of what each operation does, with links to the full docs. */
export function HelpDialog() {
  const isOpen = useSyncExternalStore(helpStore.subscribe, helpStore.get)
  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && helpStore.close()}>
      <DialogContent className="max-h-[85svh] grid-rows-[auto_1fr_auto] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>What the operations do</DialogTitle>
          <DialogDescription>
            Every action runs the real <code>docker compose</code> CLI in the stack&apos;s directory
            and streams its output.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 min-h-0 space-y-5 overflow-y-auto px-6">
          {SECTIONS.map((section) => (
            <section key={section.title} aria-label={section.title}>
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                {section.title}
              </h3>
              <dl className="space-y-2.5">
                {section.entries.map((e) => (
                  <div key={e.name} className="text-sm">
                    <dt className="font-medium">{e.name}</dt>
                    <dd className="text-muted-foreground">{e.what}</dd>
                    {e.command && (
                      <dd className="mt-0.5 font-mono text-xs">
                        <code className="bg-muted rounded px-1.5 py-0.5">{e.command}</code>
                      </dd>
                    )}
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <DialogFooter className="gap-3 sm:justify-start">
          <DocsLink href={`${DOCS_URL}/guides/using-stacky/`}>Using stacky</DocsLink>
          <DocsLink href={`${DOCS_URL}/guides/image-updates/`}>Image updates</DocsLink>
          <DocsLink href={`${DOCS_URL}/how-it-works/errors/`}>Errors</DocsLink>
          <DocsLink href={DOCS_URL}>Full documentation</DocsLink>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
