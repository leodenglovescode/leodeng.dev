// Minimal SigV4-signed PUT against R2's S3-compatible API.
//
// Why not `wrangler r2 object put`: it costs ~20 seconds per object, almost
// all of it spawning node and re-authenticating. That's fine for one file and
// hopeless for a photo collection — 146 derivatives took over ten minutes.
// A signed PUT is one HTTPS request, so the same set finishes in well under a
// minute and scales with bandwidth instead of process startup.
//
// No SDK: @aws-sdk/client-s3 is a large dependency for one verb, and the
// signing algorithm is short enough to read.
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
      'Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to .dev.vars ' +
      '(Cloudflare dashboard > R2 > Manage API tokens > Object Read & Write).',
    )
  }
  return creds
}

function signingKey(secret, dateStamp) {
  let key = hmac(`AWS4${secret}`, dateStamp)
  for (const part of [REGION, SERVICE, 'aws4_request']) key = hmac(key, part)
  return key
}

/**
 * PUTs one object. `key` may contain slashes — they're path separators in the
 * URL and must stay unencoded in the canonical URI, unlike the rest.
 */
export async function putObject({ accountId, accessKeyId, secretAccessKey }, bucket, key, body, {
  contentType = 'application/octet-stream',
  cacheControl = 'public, max-age=31536000, immutable',
} = {}) {
  const host = `${accountId}.r2.cloudflarestorage.com`
  const canonicalUri = `/${bucket}/${key}`.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/')

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex(body)

  // Must be sorted by header name, and the signed set has to match exactly.
  const headers = {
    'cache-control': cacheControl,
    'content-type': contentType,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join('')

  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signature = crypto.createHmac('sha256', signingKey(secretAccessKey, dateStamp))
    .update(stringToSign).digest('hex')

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  })

  if (!res.ok) {
    // R2 returns an XML error body; the code is the useful part.
    const text = await res.text().catch(() => '')
    const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? `HTTP ${res.status}`
    throw new Error(`${code} uploading ${key}`)
  }
}
