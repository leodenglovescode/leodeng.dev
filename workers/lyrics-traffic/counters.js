export const LIMITS = Object.freeze({ perIp: 20, requests: 300, upstream: 30 })

export function initialize(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, minute INTEGER NOT NULL, used INTEGER NOT NULL)')
}

// Call inside storage.transactionSync: checking and charging every quota is atomic.
export function consume(sql, phase, identity, now = Date.now()) {
  const minute = Math.floor(now / 60000)
  sql.exec('DELETE FROM counters WHERE minute < ?', minute - 1)
  const quotas = phase === 'request'
    ? [['requests', LIMITS.requests], [`ip:${identity}`, LIMITS.perIp]]
    : [['upstream', LIMITS.upstream]]
  for (const [key, limit] of quotas) {
    const row = sql.exec('SELECT used FROM counters WHERE key = ? AND minute = ?', key, minute).toArray()[0]
    if ((row?.used || 0) >= limit) return false
  }
  for (const [key] of quotas) {
    sql.exec(`INSERT INTO counters VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET
      used = CASE WHEN minute = excluded.minute THEN used + 1 ELSE 1 END, minute = excluded.minute`, key, minute)
  }
  return true
}
