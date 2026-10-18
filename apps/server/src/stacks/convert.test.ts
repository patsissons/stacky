import { describe, expect, it } from 'vitest'
import { parseCompose } from './compose-file'
import { dockerRunToCompose } from './convert'

describe('dockerRunToCompose', () => {
  it('converts a docker run command, including line continuations', () => {
    const compose = dockerRunToCompose(
      'docker run -d --name web \\\n  -p 8080:80 -e TZ=UTC \\\n  --restart unless-stopped nginx:1.27',
    )
    expect(compose).not.toContain('<your project name>')
    const parsed = parseCompose(compose)
    expect(parsed.services).toEqual([{ name: 'nginx', image: 'nginx:1.27' }])
    expect(compose).toContain('8080:80')
  })

  it('rejects anything that is not docker run', () => {
    expect(() => dockerRunToCompose('rm -rf /')).toThrow(/docker run/)
  })
})
