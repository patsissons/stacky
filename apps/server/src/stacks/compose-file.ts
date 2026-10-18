import { parseDocument, type Tags } from 'yaml'

/** Compose-specific YAML tags; registered so they never trigger parse warnings. */
export const composeTags: Tags = [
  { tag: '!reset', resolve: (value: unknown) => value, identify: () => false },
  { tag: '!override', resolve: (value: unknown) => value, identify: () => false },
]

export interface ParsedCompose {
  services: { name: string; image?: string }[]
  urls: string[]
  /** Top-level `name:` (overrides the project name). */
  projectName?: string
  error?: { message: string; line?: number; column?: number }
}

/** Lightweight parse for discovery and display. `docker compose config` stays authoritative. */
export function parseCompose(text: string): ParsedCompose {
  const doc = parseDocument(text, { customTags: composeTags, uniqueKeys: true })
  if (doc.errors.length > 0) {
    const err = doc.errors[0]!
    return {
      services: [],
      urls: [],
      error: {
        message: err.message.split('\n')[0] ?? err.message,
        line: err.linePos?.[0]?.line,
        column: err.linePos?.[0]?.col,
      },
    }
  }

  const data: unknown = doc.toJS({ maxAliasCount: 1000 })
  const root = isRecord(data) ? data : {}
  const servicesNode = isRecord(root.services) ? root.services : {}
  const services = Object.entries(servicesNode).map(([name, def]) => ({
    name,
    image: isRecord(def) && typeof def.image === 'string' ? def.image : undefined,
  }))

  const urls = [...extensionUrls(root['x-stacky']), ...extensionUrls(root['x-dockge'])]
  const projectName = typeof root.name === 'string' ? root.name : undefined
  return { services, urls: [...new Set(urls)], projectName }
}

function extensionUrls(ext: unknown): string[] {
  if (!isRecord(ext) || !Array.isArray(ext.urls)) return []
  return ext.urls.filter((u): u is string => typeof u === 'string' && u.length > 0)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
