// `progress` is position in the vortex, not a score. Lower values sit nearer
// the center because these are the interests Leo returns to most often lately.
// Visitor-facing copy lives in the page-scoped locale catalogs.
export const interests = [
  { id: 'computers-hardware', progress: 0.04, link: '/stack' },
  { id: 'badminton', progress: 0.10 },
  { id: 'coding-side-projects', progress: 0.16, link: '/projects' },
  { id: 'llms', progress: 0.22, link: '/tokens' },
  { id: 'homelab', progress: 0.29, link: '/homelab' },
  { id: 'planespotting', progress: 0.36, link: '/gallery/planespotting' },
  { id: 'raspberry-pi', progress: 0.43, link: '/blog/raspberry-pi-pda' },
  { id: 'aviation-photography', progress: 0.50, link: '/spotting' },
  { id: 'home-networking', progress: 0.57, link: '/blog/explaining-my-weird-home-network-services-setup' },
  { id: 'electronics-iot', progress: 0.64 },
  { id: 'home-automation', progress: 0.71 },
  { id: 'f1', progress: 0.87 },
  { id: 'cycling', progress: 0.97 },
]

export function orbitFor(progress) {
  if (progress < 0.38) return { key: 'often' }
  if (progress < 0.80) return { key: 'waves' }
  return { key: 'parked' }
}
