import assert from 'node:assert/strict'
import { loadConfig } from '../server/config.ts'
import { redactSecrets } from '../server/command.ts'

const config = loadConfig()
const ids = new Set(config.projects.map((project) => project.id))
const paths = new Set(config.projects.map((project) => project.path))

assert.equal(ids.size, config.projects.length, 'project ids must be unique')
assert.equal(paths.size, config.projects.length, 'project paths must be unique')
assert.ok(config.projects.some((project) => project.id === 'local-suite'), 'local-suite project must be registered')
assert.ok(config.devctlPath.endsWith('/devctl'), 'devctl path must point to devctl')

const redacted = redactSecrets('OPENAI_API_KEY=sk-testsecretvalue12345')
assert.equal(redacted.redacted, true)
assert.equal(redacted.value.includes('sk-testsecretvalue12345'), false)

console.log('smoke tests passed')
