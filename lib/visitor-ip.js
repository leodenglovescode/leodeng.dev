export function visitorIp(request) {
  // Preserve the original IPv6 address when Cloudflare Pseudo IPv4 is enabled.
  const address = request.headers.get('CF-Connecting-IPv6') || request.headers.get('CF-Connecting-IP')
  return address && address.length <= 64 && /^[a-f\d:.]+$/i.test(address) ? address : null
}

export function ipTextResponse(request) {
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  }
  const respond = (body, status = 200, extra = {}) => new Response(request.method === 'HEAD' ? null : body, {
    status, headers: { ...headers, ...extra },
  })
  if (!['GET', 'HEAD'].includes(request.method)) return respond('Method not allowed.\n', 405, { Allow: 'GET, HEAD' })
  const url = new URL(request.url)
  if (url.pathname !== '/') return respond('Not found.\n', 404)
  if (url.search) return respond('Invalid request.\n', 400)
  const ip = visitorIp(request)
  return ip ? respond(`${ip}\n`) : respond('IP address unavailable.\n', 503)
}
