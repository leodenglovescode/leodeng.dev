// Minimal SigV4-signed requests against R2's S3-compatible API.
//
// Why not `wrangler r2 object put`: it costs ~20 seconds per object, almost
// all of it spawning node and re-authenticating. That's fine for one file and
// hopeless for a photo collection — 146 derivatives took over ten minutes.
// A signed PUT is one HTTPS request, so the same set finishes in well under a
// minute and scales with bandwidth instead of process startup.
//
// No SDK: share the small signer between photo uploads and local admin media.
// The signing algorithm is short enough to read.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REGION = 'auto' // R2 ignores region, but SigV4 requires one in the scope
const SERVICE = 's3'

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()

/**
 * Credentials come from the environment, falling back to .dev.vars — which is
 * already gitignored for the dev OAuth app, so there's one local secrets file
 * rather than two.
 */
export function loadCredentials(env = process.env) {
  const creds = {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  }

  if (!creds.accessKeyId || !creds.secretAccessKey || !creds.accountId) {
    const devVars = path.join(__dirname, '../../.dev.vars')
    if (fs.existsSync(devVars)) {
      for (const line of fs.readFileSync(devVars, 'utf8').split('\n')) {
        const m = line.match(/^\s*(R2_ACCOUNT_ID|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY)\s*=\s*"?([^"\n]*)"?\s*$/)
        if (!m) continue
        const key = { R2_ACCOUNT_ID: 'accountId', R2_ACCESS_KEY_ID: 'accessKeyId', R2_SECRET_ACCESS_KEY: 'secretAccessKey' }[m[1]]
        creds[key] ||= m[2].trim()
      }
    }
  }

  const missing = Object.entries(creds).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) {
    throw new Error(
      `Missing R2 credentials: ${missing.join(', ')}.\n` +
      'Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to .dev.vars.\n' +
      'Dashboard > R2 > Account Details panel > API Tokens > Manage, then ' +
      '"Object Read & Write" scoped to the bucket. Note this is not the generic ' +
      'Account API Tokens page — that one issues a Bearer token, not an S3 key pair.',
    )
  }
  return creds
}

function signingKey(secret, dateStamp) {
  let key = hmac(`AWS4${secret}`, dateStamp)
  for (const part of [REGION, SERVICE, 'aws4_request']) key = hmac(key, part)
  return key
}

const awsEncode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

async function r2Request({ accountId, accessKeyId, secretAccessKey }, bucket, {
  method, key = '', body, query = {}, headers: extraHeaders = {},
}) {
  const host = `${accountId}.r2.cloudflarestorage.com`
  const canonicalUri = `/${bucket}/${key}`.split('/').map(awsEncode).join('/')
  const canonicalQuery = Object.entries(query).map(([key, value]) => [awsEncode(key), awsEncode(value)])
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('&')
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex(body || '')
  const headers = { ...extraHeaders, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers).sort().map(h => `${h}:${headers[h]}\n`).join('')
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signature = crypto.createHmac('sha256', signingKey(secretAccessKey, dateStamp)).update(stringToSign).digest('hex')
  const res = await fetch(`https://${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`, {
    method,
    headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
    body,
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Never expose the full S3 response, signed headers, or credentials.
    const code = text.match(/<Code>([A-Za-z0-9]+)<\/Code>/)?.[1] || `HTTP ${res.status}`
    throw Object.assign(new Error(`${code} during R2 ${method}.`), { status: res.status === 412 ? 409 : 502 })
  }
  return res
}

/** Existing photo uploads overwrite derivatives; admin uploads can opt out. */
export async function putObject(creds, bucket, key, body, {
  contentType = 'application/octet-stream',
  cacheControl = 'public, max-age=31536000, immutable',
  preventOverwrite = false,
} = {}) {
  const response = await r2Request(creds, bucket, { method: 'PUT', key, body, headers: {
    'cache-control': cacheControl,
    'content-type': contentType,
    ...(preventOverwrite ? { 'if-none-match': '*' } : {}),
  } })
  await response.arrayBuffer()
}

export async function deleteObject(creds, bucket, key) {
  const response = await r2Request(creds, bucket, { method: 'DELETE', key })
  await response.arrayBuffer()
}

const xmlValue = (xml, tag) => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] || ''
const unescapeXml = text => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, value) => {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  if (value[0] !== '#') return named[value] || entity
  const code = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1))
  return code <= 0x10ffff ? String.fromCodePoint(code) : entity
})

/** List the flat media namespace; gallery collections are nested separately. */
export async function listObjects(creds, bucket) {
  const response = await r2Request(creds, bucket, { method: 'GET', query: { 'list-type': '2', 'max-keys': '500', delimiter: '/' } })
  const xml = await response.text()
  if (!xml.includes('<ListBucketResult')) throw new Error('Invalid R2 listing response.')
  return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, entry]) => ({
    key: unescapeXml(xmlValue(entry, 'Key')),
    size: Number(xmlValue(entry, 'Size')),
    uploaded: xmlValue(entry, 'LastModified'),
  }))
}
