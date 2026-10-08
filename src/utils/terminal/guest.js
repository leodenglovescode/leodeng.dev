export const HOME = '/home/leo'
const quote = value => `'${value.replaceAll("'", "'\\''")}'`

// Real guest commands use a local 9p file and an OSC message to ask the browser
// to play bytes. They never accept or fetch an external URL.
export function audioScript(missingMessage) {
  return `#!/bin/sh
if [ "$(basename "$0")" = stop ]; then
  printf '\\033]777;leo-audio;stop\\007'
  exit 0
fi
if [ "$#" -ne 1 ]; then
  printf 'Usage: %s FILE\\n' "$(basename "$0")" >&2
  exit 1
fi
file="$1"
if [ ! -f "$file" ]; then
  printf '%s\\n' ${quote(missingMessage)} >&2
  exit 1
fi
size=$(wc -c < "$file")
if [ "$size" -gt 10485760 ]; then
  printf '%s\\n' 'Audio must be 10 MB or smaller.' >&2
  exit 1
fi
cp "$file" /mnt/.leo-audio || exit 1
name=$(basename "$file" | base64 | tr -d '\\n')
printf '\\033]777;leo-audio;play;%s\\007' "$name"
`
}

export async function prepareGuest(machine, files, { welcome, missingAudio, fastfetch, voiceRecordings = {} }) {
  const encoder = new TextEncoder()
  const script = ['hostname linux', `mkdir -p ${HOME} /usr/local/bin`]
  let index = 0
  for (const [path, file] of Object.entries(files)) {
    if (!path.startsWith(HOME + '/') || path.split('/').includes('..')) continue
    if (file.type === 'directory') { script.push(`mkdir -p ${quote(path)}`); continue }
    if (file.type !== 'text') continue
    const source = `site-${index++}.txt`
    await machine.create_file(source, encoder.encode(file.content + '\n'))
    script.push(`mkdir -p ${quote(path.slice(0, path.lastIndexOf('/')))}`)
    script.push(`cp ${quote('/mnt/' + source)} ${quote(path)}`)
  }
  for (const [language, bytes] of Object.entries(voiceRecordings)) {
    if (!['en', 'zh'].includes(language)) continue
    const name = language === 'zh' ? 'welcome-chinese.mp3' : 'welcome.mp3'
    await machine.create_file(name, new Uint8Array(bytes))
    script.push(`mkdir -p ${HOME}/voice`, `cp /mnt/${name} ${HOME}/voice/${name}`)
  }
  await machine.create_file('welcome.txt', encoder.encode(welcome))
  await machine.create_file('audio.sh', encoder.encode(audioScript(missingAudio)))
  if (fastfetch) {
    await machine.create_file('fastfetch.bin', new Uint8Array(fastfetch))
    script.push('cp /mnt/fastfetch.bin /usr/local/bin/fastfetch; chmod +x /usr/local/bin/fastfetch')
  }
  await machine.create_file('profile.sh', encoder.encode("export HOME=/home/leo\nexport PATH=/usr/local/bin:$PATH\nexport PS1='leo@linux:\\w$ '\ncd /home/leo\nclear\ncat LEO.txt\n"))
  // Replace the image's startup shell with a supervisor. Leaving a Leo shell
  // restarts that session rather than exposing the parent root shell.
  await machine.create_file('session.sh', encoder.encode("#!/bin/sh\nwhile :; do\n  su -s /bin/sh -c '. /home/leo/.profile; exec /bin/sh -i' leo\ndone\n"))
  script.push(`cp /mnt/welcome.txt ${HOME}/LEO.txt`)
  script.push('for command in play afplay stop; do cp /mnt/audio.sh /usr/local/bin/$command; chmod +x /usr/local/bin/$command; done')
  script.push(`cp /mnt/profile.sh ${HOME}/.profile`, `adduser -D -H -h ${HOME} -s /bin/sh leo`, `chown -R leo:leo ${HOME}`, 'chmod 1777 /mnt', 'cp /mnt/session.sh /usr/local/bin/leo-session', 'chmod 755 /usr/local/bin/leo-session', 'exec /bin/sh /usr/local/bin/leo-session')
  await machine.create_file('init-site.sh', encoder.encode(script.join('\n') + '\n'))
}
