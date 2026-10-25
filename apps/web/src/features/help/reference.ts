export interface RefEntry {
  name: string
  /** Other names stacky reads for the same setting; `name` wins when both are set. */
  aliases?: string[]
  what: string
  default?: string
  example?: string
}

export interface RefSection {
  title: string
  intro?: string
  entries: RefEntry[]
}

/** Every label and environment variable a user can set to change what stacky does. */
export const REFERENCE: RefSection[] = [
  {
    title: 'Labels on a service',
    intro:
      'Set these under a service’s labels: in its compose file. They apply once the container is recreated (deploy the stack).',
    entries: [
      {
        name: 'stacky.display.icon',
        aliases: ['dev.stacky.icon', 'wud.display.icon'],
        what: 'The icon shown for the container. A selfh.st icon name (sh: or selfhst:), another set (hl:, si:, mdi:, fa:, fas:, far:, fab:), stacky for stacky’s logo, or an http(s) image URL. Stacky downloads it once and serves it from its cache.',
        default: 'matched by image name from selfh.st',
        example: 'stacky.display.icon: mdi:docker',
      },
      {
        name: 'stacky.update.schedule',
        what: 'How often this container’s image is checked for updates: hourly, daily (nightly), weekly, monthly, an interval such as 30m, 6h, 2d or 1w (at least 5m), a cron pattern in stacky’s time zone, or never (off, 0). An invalid value falls back to the global schedule.',
        default: 'the global schedule in Settings',
        example: "stacky.update.schedule: '0 4 * * 1-5'",
      },
      {
        name: 'stacky.tag.include',
        aliases: ['wud.tag.include'],
        what: 'A regular expression a newer tag must match to count as an update. It narrows the same-shape rule rather than replacing it. Write a trailing $ as $$ in compose files.',
        example: "stacky.tag.include: '^1\\.26\\.'",
      },
      {
        name: 'stacky.tag.exclude',
        aliases: ['wud.tag.exclude'],
        what: 'A regular expression that rules tags out as updates, for example to skip the next major version.',
        example: "stacky.tag.exclude: '^18\\.'",
      },
      {
        name: 'stacky.link.template',
        aliases: ['wud.link.template'],
        what: 'Turns each version into a link to its release notes. Placeholders: ${original} or ${raw}, ${transformed}, ${major}, ${minor}, ${patch}, ${prerelease}; write them as $${major} in compose files. Must give an http(s) URL.',
        example:
          'stacky.link.template: https://example.com/releases/v$${major}.$${minor}.$${patch}',
      },
      {
        name: 'stacky.notify',
        what: 'Turns all of this container’s notifications (image updates and unhealthy alerts) on or off: true or false (on/off, yes/no, 1/0).',
        default: 'Send by default in Settings → Notifications',
        example: 'stacky.notify: false',
      },
      {
        name: 'stacky.notify.updates · stacky.notify.unhealthy',
        what: 'Turns one event on or off for this container, ahead of stacky.notify.',
        example: 'stacky.notify.updates: true',
      },
    ],
  },
  {
    title: 'Labels on stacky’s own container',
    intro:
      'Set these on the stacky service in stacky’s own compose file; they apply once stacky is redeployed. For each event the most specific setting wins: the container’s event label, its stacky.notify, the stack’s event label here, the stack’s label here, then Send by default. Failures skip the container labels.',
    entries: [
      {
        name: 'stacky.notify.stack.<stack>',
        what: 'Turns every notification from one stack on or off.',
        example: 'stacky.notify.stack.sandbox: false',
      },
      {
        name: 'stacky.notify.stack.<stack>.<event>',
        what: 'Turns one event on or off for one stack. The event is failures, updates or unhealthy.',
        example: 'stacky.notify.stack.sandbox.failures: true',
      },
    ],
  },
  {
    title: 'Compose file',
    entries: [
      {
        name: 'x-stacky.urls',
        aliases: ['x-dockge.urls'],
        what: 'A top-level list of URLs shown as links on the stack page and in the stack list.',
        example: 'x-stacky:\n  urls:\n    - https://app.example.com',
      },
    ],
  },
  {
    title: 'Environment: server',
    intro: 'Set these on stacky’s own container.',
    entries: [
      { name: 'STACKY_PORT', what: 'HTTP port to listen on.', default: '5005' },
      { name: 'STACKY_HOSTNAME', what: 'Address to bind to.', default: 'all addresses' },
      {
        name: 'STACKY_BASE_URL',
        what: 'Public URL of stacky, used for links (including in notifications) and OIDC callbacks.',
      },
      {
        name: 'STACKY_DISPLAY_NAME',
        what: 'Name of this stacky in notifications, to tell instances apart. Set it on Docker Desktop or OrbStack, where the Docker host’s name is the VM’s (docker-desktop, orbstack).',
        default: 'the Docker host’s name, then the container’s hostname',
      },
      {
        name: 'STACKY_STACKS_DIR',
        what: 'Directory with one sub-directory per stack. Mount it at the same path as on the host.',
        default: '/opt/stacks',
      },
      {
        name: 'STACKY_DATA_DIR',
        what: 'Stacky’s database, history, icon cache and auth secret.',
        default: '/app/data',
      },
      {
        name: 'STACKY_WEB_DIR',
        what: 'Directory of the built web UI. The image sets it; leave it alone unless you build stacky yourself.',
        default: '/app/web in the image',
      },
      {
        name: 'STACKY_LOG_LEVEL',
        what: 'How much stacky logs: debug, info, warn or error.',
        default: 'info',
      },
      {
        name: 'TZ',
        what: 'Time zone for update schedules and cron patterns.',
        default: 'UTC',
        example: 'TZ: Europe/Berlin',
      },
    ],
  },
  {
    title: 'Environment: sign-in',
    entries: [
      {
        name: 'STACKY_AUTH_DISABLED',
        what: 'Turns off built-in sign-in. Only use it behind a reverse proxy that authenticates for you.',
        default: 'false',
      },
      {
        name: 'STACKY_TRUSTED_PROXIES',
        what: 'Comma-separated proxy addresses or CIDRs whose X-Forwarded-* headers are trusted.',
      },
      {
        name: 'STACKY_ADMIN_USER · STACKY_ADMIN_PASSWORD',
        what: 'Seed the admin account instead of using the setup page. Set both or neither.',
      },
      {
        name: 'STACKY_AUTH_SECRET',
        what: 'Secret that signs sessions.',
        default: 'generated once and kept in the data directory',
      },
      {
        name: 'STACKY_OIDC_ISSUER · STACKY_OIDC_CLIENT_ID · STACKY_OIDC_CLIENT_SECRET',
        what: 'Turn on single sign-on with an OIDC provider. Set all three or none.',
      },
      { name: 'STACKY_OIDC_NAME', what: 'Label of the sign-in button.', default: 'SSO' },
      {
        name: 'STACKY_OIDC_SCOPES',
        what: 'Scopes to request, separated by spaces or commas. Add groups for group checks.',
        default: 'openid profile email',
      },
      {
        name: 'STACKY_OIDC_ALLOWED_GROUPS',
        what: 'Comma-separated groups (from the groups claim) allowed to sign in.',
      },
      {
        name: 'STACKY_OIDC_AUTO_REDIRECT',
        what: 'Sends visitors straight to the provider; /login?local=1 still shows the form.',
        default: 'false',
      },
    ],
  },
  {
    title: 'Environment: updates and registries',
    entries: [
      {
        name: 'STACKY_UPDATE_SCHEDULE',
        what: 'Default image update schedule, in the same format as stacky.update.schedule. Settings can change it later.',
        default: '6h',
      },
      {
        name: 'STACKY_UPDATE_INTERVAL',
        what: 'Legacy: hours between image checks, used when STACKY_UPDATE_SCHEDULE is not set. 0 turns scheduled checks off.',
        default: '6',
      },
      {
        name: 'STACKY_UPDATE_CHECK',
        what: 'Checks GitHub for newer stacky releases and shows an update banner. 0, false, no or off turns it off.',
        default: 'true',
      },
      {
        name: 'STACKY_ICON_CDN',
        what: 'Where selfh.st icons are fetched from. Empty turns icon sets off (URL icons still work).',
        default: 'https://cdn.jsdelivr.net/gh/selfhst/icons',
      },
      {
        name: 'STACKY_REGISTRY_<PROVIDER>_<NAME>_<KEY>',
        aliases: ['WUD_REGISTRY_<PROVIDER>_<NAME>_<KEY>'],
        what: 'Registry credentials for update checks. PROVIDER is HUB, GHCR, LSCR, QUAY, GITLAB, CUSTOM, GITEA or FORGEJO; NAME is optional; KEY is URL, USERNAME (LOGIN), TOKEN (PASSWORD) or AUTH, plus NAMESPACE and ACCOUNT for Quay. They win over a mounted config.json.',
        example: 'STACKY_REGISTRY_LSCR_PRIVATE_TOKEN: ghp_…',
      },
      {
        name: 'DOCKER_CONFIG',
        what: 'Directory of the Docker config.json whose auths entries are used for private registries. Credential helpers are not supported.',
        default: '~/.docker',
      },
    ],
  },
  {
    title: 'Environment: Docker and tools',
    entries: [
      {
        name: 'DOCKER_HOST',
        what: 'Address of the Docker engine. When unset, stacky uses the first socket it finds: /var/run/docker.sock, $XDG_RUNTIME_DIR/docker.sock, then Docker Desktop and OrbStack locations.',
        default: 'unix:///var/run/docker.sock',
      },
      {
        name: 'STACKY_DOCKER_HOST',
        what: 'Hostname or IP that published container ports are reachable on, for port links. A bare host, not a socket address.',
        default: 'the host the UI is served from',
        example: 'STACKY_DOCKER_HOST: docker.lan',
      },
      {
        name: 'STACKY_CONTAINER_ID',
        what: 'Overrides detection of stacky’s own container, which self-update relies on.',
        default: 'autodetected',
      },
      { name: 'STACKY_DOCKER_BIN', what: 'The docker CLI stacky runs.', default: 'docker' },
      { name: 'STACKY_GIT_BIN', what: 'The git CLI stacky runs.', default: 'git' },
    ],
  },
]

/** The sections, keeping only entries that mention the query (case-insensitive). */
export function filterReference(query: string, sections: RefSection[] = REFERENCE) {
  const q = query.trim().toLowerCase()
  if (!q) return sections
  return sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((e) =>
        [e.name, ...(e.aliases ?? []), e.what, e.default ?? '', e.example ?? ''].some((text) =>
          text.toLowerCase().includes(q),
        ),
      ),
    }))
    .filter((section) => section.entries.length > 0)
}
