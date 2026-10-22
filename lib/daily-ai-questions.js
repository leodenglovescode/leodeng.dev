// Public, fixed choices. Neither the browser nor the publisher supplies prompts.
export const DAILY_AI_QUESTIONS = Object.freeze([
  { id: 'homelab', en: 'How is the homelab doing?', zh: '家庭服务器最近怎么样？', paths: ['/homelab', '/tokens'], instruction: 'Summarize the supplied public homelab snapshot. Distinguish uptime from availability history. Do not infer private services or causes of load.' },
  { id: 'building', en: 'What has Leo been building?', zh: 'Leo 最近在做什么？', paths: ['/now', '/projects'], instruction: 'Describe current projects from the supplied Now and Projects pages. Distinguish active, paused and finished work. Do not invent recent progress.' },
  { id: 'archive', en: 'What is worth reading from the archive?', zh: '有什么值得重读的旧文章？', paths: ['/blog'], instruction: 'Introduce the selected published archive article. Explain its topic and what the author learned, using only its supplied text.' },
  { id: 'photography', en: 'What does Leo photograph?', zh: 'Leo 喜欢拍些什么？', paths: ['/gallery', '/spotting'], instruction: 'Introduce the published photography collections and shooting statistics. Do not infer aircraft types, locations or personal details not stated in the sources.' },
  { id: 'site', en: 'How is this site built?', zh: '这个网站是怎么搭建的？', paths: ['/stack', '/ai'], instruction: 'Explain the website stack and the author’s stated use of AI, using only the supplied public pages.' },
])

export const DAILY_AI_IDS = Object.freeze(DAILY_AI_QUESTIONS.map(question => question.id))
