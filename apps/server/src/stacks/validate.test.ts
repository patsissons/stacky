import { describe, expect, it } from 'vitest'
import { composeIssue, locateKey, validateCompose } from './validate'

const compose = `services:
  web:
    image: nginx
    imagee: typo
  db:
    image: postgres
`

describe('locateKey', () => {
  it('finds the line of a nested key from a compose error path', () => {
    expect(locateKey("services.web additional properties 'imagee' not allowed", compose)).toBe(4)
    expect(locateKey('services.db.image must be a string', compose)).toBe(6)
    expect(locateKey('something unrelated', compose)).toBeUndefined()
  })
})

describe('composeIssue', () => {
  it('strips the file prefix and locates the key', () => {
    const issue = composeIssue(
      "validating /dev/stdin: services.web additional properties 'imagee' not allowed",
      compose,
    )
    expect(issue).toMatchObject({
      message: "services.web additional properties 'imagee' not allowed",
      line: 4,
      severity: 'error',
    })
  })
})

describe('validateCompose', () => {
  it('reports YAML syntax errors without calling docker', async () => {
    const result = await validateCompose({
      dir: '/nonexistent',
      compose: 'services:\n  web: [\n',
      dockerBin: '/bin/false',
    })
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toMatchObject({ source: 'yaml', severity: 'error' })
  })

  it('surfaces docker compose failures', async () => {
    const result = await validateCompose({
      dir: '/nonexistent',
      compose: 'services: {}\n',
      dockerBin: '/bin/false',
    })
    expect(result.ok).toBe(false)
    expect(result.issues[0]?.source).toBe('compose')
  })
})
