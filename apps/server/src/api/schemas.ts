import { z } from 'zod'
import { actionOptionsSchema, stackNameSchema } from '@stacky/shared'

// Request bodies of the public API. Routes validate with these and the OpenAPI
// document is generated from them, so the two cannot drift apart.

const MAX_TEXT = 1024 * 1024
export const text = z.string().max(MAX_TEXT)

export const createStackBody = z.object({
  name: stackNameSchema.describe('Stack directory name: lowercase letters, digits, - and _'),
  compose: text.describe('compose.yaml contents, saved exactly as given'),
  env: text.optional().describe('.env contents'),
  deploy: z.boolean().optional().describe('Deploy right after creating'),
})

export const saveStackBody = z.object({
  compose: text.optional().describe('New compose.yaml contents'),
  env: text.optional().describe('New .env contents; an empty string removes .env'),
})

export const validateBody = z.object({
  compose: text,
  env: text.optional(),
})

export const previewBody = z.object({
  compose: text.optional().describe('Unsaved compose.yaml contents; the saved file when omitted'),
  env: text.optional().describe('Unsaved .env contents; the saved file when omitted'),
  options: actionOptionsSchema.optional(),
})

export const stackActionBody = z.object({
  options: actionOptionsSchema.optional(),
  compose: text.optional().describe('deploy only: save these contents first (validated)'),
  env: text.optional().describe('deploy only: save these contents first (validated)'),
})

export const stackFileBody = z.object({
  path: z.string().min(1).describe('Path relative to the stack directory'),
  content: text,
})

export const checkUpdatesBody = z.object({
  refs: z.array(z.string()).optional().describe('Image references to check; all when omitted'),
})

export const ignoreUpdateBody = z.object({
  ref: z.string().min(1),
  value: z.string().optional().describe('The version to skip; clears the ignore when omitted'),
})

export const bumpImageBody = z.object({ tag: z.string().min(1).max(128) })
