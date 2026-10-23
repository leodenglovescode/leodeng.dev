import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { STACK_PATH, validateStack } from '../../lib/stack-validation.js'
import { stackText } from '../../src/utils/stack.js'
import { onRequest } from '../api/gh/[[path]].js'

const stack = JSON.parse(await readFile(new URL('../../src/content/stack.json', import.meta.url), 'utf8'))

test('stack migration preserves devices and translations, and invalid edits are rejected', () => {
  assert.equal(validateStack(stack), stack)
  assert.equal(stack.hardware.length, 9)
  assert.equal(stack.software.length, 6)
  assert.equal(stack.hardware.find(item => item.model === 'Custom Built PC').rows.length, 5)
  assert.equal(stackText({ en: 'Camera', zh: '相机' }, 'zh'), '相机')
  assert.equal(stackText({ en: 'Camera', zh: '' }, 'zh'), 'Camera')
  for (const change of [
    data => { data.hardware[0].name.en = '' },
    data => { data.hardware[0].icon = 'unknown' },
    data => { data.hardware[0].model = '' },
    data => { data.hardware[0].rows = [{ label: { en: 'CPU', zh: '' }, value: { en: '', zh: '' } }] },
    data => { data.software[0].tags = [''] },
    data => { delete data.software },
  ]) {
    const data = structuredClone(stack)
    change(data)
    assert.throws(() => validateStack(data))
  }
})

function context({ target = STACK_PATH, method = 'PUT', data = stack, headers = {} } = {}) {
  return {
    request: new Request('https://leodeng.dev/api/gh/test', {
      method, headers: { Cookie: 'gh_session=test-token', 'X-Admin': '1', ...headers },
      ...(method === 'GET' ? {} : { body: JSON.stringify({ content: Buffer.from(JSON.stringify(data)).toString('base64') }) }),
    }),
    env: {},
    params: { path: ['repos', 'leodenglovescode', 'leodeng.dev', 'contents', ...target.split('/')] },
  }
}

test('production stack saves validate content and preserve exact-file, authentication and CSRF restrictions', async t => {
  const writes = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === 'https://api.github.com/user') return Response.json({ login: 'leodenglovescode' })
    writes.push({ url: String(url), options })
    return Response.json({ content: { sha: 'saved-sha' } })
  })
  assert.equal((await onRequest(context())).status, 200)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].options.headers.authorization, 'Bearer test-token')
  assert.deepEqual(JSON.parse(Buffer.from(JSON.parse(writes[0].options.body).content, 'base64')), stack)
  assert.equal((await onRequest(context({ data: {} }))).status, 400)
  assert.equal((await onRequest(context({ method: 'DELETE' }))).status, 405)
  assert.equal((await onRequest(context({ headers: { 'X-Admin': '' } }))).status, 403)
  assert.equal((await onRequest(context({ headers: { Cookie: '' } }))).status, 401)
  for (const target of ['src/content/secret.json', `${STACK_PATH}/other`, 'src/content/../stack.json']) {
    assert.ok([400, 403].includes((await onRequest(context({ target }))).status))
  }
  assert.equal(writes.length, 1)
})
