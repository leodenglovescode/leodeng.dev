import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nowPayload, nowResponse } from '../../lib/now-api.js'
const data = JSON.parse(readFileSync(new URL('../../src/content/now.json', import.meta.url), 'utf8'))
const request = (query = '', method = 'GET') => new Request(`https://leodeng.dev/api/now${query}`, { method })

test('public now API returns every activity from the page with stable IDs and Markdown', async () => {
  const response = nowResponse(request(), data), body = await response.json()
  assert.equal(response.status, 200)
  assert.match(response.headers.get('Content-Type'), /application\/json/)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60')
  assert.equal(body.language, 'en'); assert.equal(body.schemaVersion, 1)
  assert.equal(body.updatedAt, data.updatedAt)
  assert.equal(body.detailsFormat, 'markdown')
  assert.deepEqual(body.events.map(e => e.id), data.events.map(e => e.id))
  for (const [i, event] of body.events.entries()) {
    assert.equal(event.title, data.events[i].title.en)
    assert.equal(event.details, data.events[i].details.en)
    for (const key of ['startedAt', 'updatedAt', 'finishedAt']) assert.equal(event[key], data.events[i][key] || null)
  }
})
test('Chinese localization retains IDs, status, and timestamps', async () => {
  const english = nowPayload(data), chinese = await nowResponse(request('?lang=zh'), data).json()
  assert.equal(chinese.language, 'zh'); assert.equal(chinese.url, 'https://leodeng.dev/zh/now')
  chinese.events.forEach((event, i) => {
    assert.equal(event.title, data.events[i].title.zh || data.events[i].title.en)
    assert.equal(event.details, data.events[i].details.zh || data.events[i].details.en)
    for (const key of ['id', 'status', 'startedAt', 'updatedAt', 'finishedAt']) assert.equal(event[key], english.events[i][key])
  })
})
test('invalid parameters and writes produce JSON errors without cacheable responses', async () => {
  for (const query of ['?lang=fr', '?lang=', '?lang=en&lang=zh', '?token=private']) {
    const response = nowResponse(request(query), data)
    assert.equal(response.status, 400); assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(typeof (await response.json()).error, 'string')
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = nowResponse(request('', method), data)
    assert.equal(response.status, 405); assert.equal(response.headers.get('Allow'), 'GET, HEAD, OPTIONS')
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
  }
})
test('HEAD has no body and OPTIONS allows public browser reads', async () => {
  const head = nowResponse(request('', 'HEAD'), data), get = nowResponse(request(), data)
  assert.equal(head.status, 200); assert.equal(await head.text(), '')
  assert.deepEqual([...head.headers], [...get.headers])
  const options = nowResponse(request('', 'OPTIONS'), data)
  assert.equal(options.status, 204); assert.equal(await options.text(), '')
  assert.equal(options.headers.get('Access-Control-Allow-Methods'), 'GET, HEAD, OPTIONS')
})
