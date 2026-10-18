import composeSpec from '@stacky/shared/compose-spec.json'

/**
 * yaml-language-server understands draft-07 `definitions` better than
 * draft 2020-12 `$defs`, so rewrite the vendored compose schema.
 */
export function toDraft7(schema: unknown): unknown {
  const text = JSON.stringify(schema).replaceAll('"#/$defs/', '"#/definitions/')
  const out = JSON.parse(text) as Record<string, unknown>
  if (out.$defs) {
    out.definitions = out.$defs
    delete out.$defs
  }
  out.$schema = 'http://json-schema.org/draft-07/schema#'
  return out
}

export const composeSchema = toDraft7(composeSpec)
