// `progress` is position in the vortex, not a score. Lower values sit nearer
// the center because these are the interests Leo returns to most often lately.
// Moving an interest is deliberately just changing one number here.
export const interests = [
  {
    id: 'computers-hardware',
    label: 'Computers, especially old ones',
    vortexLabel: 'Old computers',
    progress: 0.04,
    description: 'I tinker with computers constantly, especially older machines that can still be made useful.',
    link: '/stack',
    linkLabel: 'Inspect the current pile of hardware',
  },
  {
    id: 'badminton',
    label: 'Badminton',
    progress: 0.10,
    description: 'I play three or four times most weeks, so this has become less of a side interest and more of a routine.',
  },
  {
    id: 'coding-side-projects',
    label: 'Coding side projects',
    vortexLabel: 'Side projects',
    progress: 0.16,
    description: 'Most of my coding starts with something annoying me enough to build a small tool for it.',
    link: '/projects',
    linkLabel: 'See what I have built',
  },
  {
    id: 'llms',
    label: 'LLMs',
    progress: 0.22,
    description: 'Using them, measuring them, and occasionally making several of them argue with each other.',
    link: '/tokens',
    linkLabel: 'See the token damage',
  },
  {
    id: 'homelab',
    label: 'Homelab & self-hosting',
    vortexLabel: 'Homelab',
    progress: 0.29,
    description: 'Running services at home because maintaining them myself is somehow the fun option.',
    link: '/homelab',
    linkLabel: 'Check on the server',
  },
  {
    id: 'planespotting',
    label: 'Planespotting',
    progress: 0.36,
    description: 'Waiting around for one interesting arrival, usually while the weather changes its mind.',
    link: '/gallery/planespotting',
    linkLabel: 'Open the planespotting gallery',
  },
  {
    id: 'raspberry-pi',
    label: 'Raspberry Pi contraptions',
    vortexLabel: 'Raspberry Pi',
    progress: 0.43,
    description: 'If a Pi can become a server, watchdog, or pocket computer, I will probably try it.',
    link: '/blog/raspberry-pi-pda',
    linkLabel: 'See one of the contraptions',
  },
  {
    id: 'aviation-photography',
    label: 'Aviation photography',
    vortexLabel: 'Aviation photos',
    progress: 0.50,
    description: 'Big lenses, moving subjects, too many photos, and the occasional frame worth keeping.',
    link: '/spotting',
    linkLabel: 'See the numbers behind the photos',
  },
  {
    id: 'home-networking',
    label: 'Home networking',
    vortexLabel: 'Networking',
    progress: 0.57,
    description: 'Headscale, DNS, tunnels, and diagrams explaining why any of it works.',
    link: '/blog/explaining-my-weird-home-network-services-setup',
    linkLabel: 'Enter the networking rabbit hole',
  },
  {
    id: 'electronics-iot',
    label: 'Electronics & IoT',
    vortexLabel: 'ESP & IoT',
    progress: 0.64,
    description: 'ESP boards, sensors, and wires that were definitely working five minutes ago.',
  },
  {
    id: 'home-automation',
    label: 'Home automation',
    progress: 0.71,
    description: 'Home Assistant and the slow process of giving ordinary switches unnecessary opinions.',
  },
  {
    id: 'f1',
    label: 'F1',
    progress: 0.87,
    description: 'Watching races and judging strategy calls from the safety of the sofa.',
  },
  {
    id: 'cycling',
    label: 'Cycling around Beijing',
    vortexLabel: 'Cycling',
    progress: 0.97,
    description: 'Riding around the city when the weather and air cooperate.',
  },
]

export function orbitFor(progress) {
  if (progress < 0.38) return { key: 'often', label: 'Often in my head' }
  if (progress < 0.80) return { key: 'waves', label: 'Comes in waves' }
  return { key: 'parked', label: 'Parked for now' }
}
