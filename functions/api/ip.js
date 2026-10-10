const text = (value, limit = 200) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) || null : null

export function onRequest({ request }) {
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  }
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, {
    status: 405, headers: { ...headers, Allow: 'GET' },
  })
  if (new URL(request.url).search) return Response.json({ error: 'Invalid request' }, { status: 400, headers })

  const cf = request.cf || {}
  // Preserve the original IPv6 address if Cloudflare Pseudo IPv4 is enabled.
  const address = text(request.headers.get('CF-Connecting-IPv6') || request.headers.get('CF-Connecting-IP'), 64)
  const ip = address && /^[a-f\d:.]+$/i.test(address) ? address : null
  const countryCode = typeof cf.country === 'string' && /^[A-Z]{2}$/.test(cf.country) ? cf.country : null
  // No upstream calls, cookies, logging, storage, or visitor-selected targets.
  return Response.json({
    ip,
    ipVersion: ip ? (ip.includes(':') ? 6 : 4) : null,
    countryCode,
    region: text(cf.region),
    city: text(cf.city),
    network: {
      asn: Number.isInteger(cf.asn) && cf.asn > 0 && cf.asn <= 4294967295 ? cf.asn : null,
      organization: text(cf.asOrganization),
    },
    connection: {
      tlsVersion: text(cf.tlsVersion, 32),
      cipher: text(cf.tlsCipher, 100),
      httpProtocol: text(cf.httpProtocol, 32),
      colo: text(cf.colo, 8),
    },
  }, { headers })
}
