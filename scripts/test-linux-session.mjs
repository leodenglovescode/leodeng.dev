import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { V86 } from 'v86'
import { HOME, prepareGuest } from '../src/utils/terminal/guest.js'

const root = new URL('../', import.meta.url)
const buffer = path => {
  const bytes = readFileSync(new URL(path, root))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

test('exit and Ctrl+D restart the Leo session without losing guest files', { timeout: 90000 }, async () => {
  const machine = new V86({
    wasm_path: fileURLToPath(new URL('node_modules/v86/build/v86.wasm', root)),
    memory_size: 64 * 1024 * 1024,
    bios: { buffer: buffer('public/linux/seabios.bin') },
    vga_bios: { buffer: buffer('public/linux/vgabios.bin') },
    bzimage: { buffer: buffer('public/linux/buildroot-bzimage.bin') },
    filesystem: {},
    cmdline: 'console=ttyS0 tsc=reliable random.trust_cpu=on',
    disable_speaker: true,
    disable_keyboard: true,
    autostart: false,
  })
  let output = ''
  let stage = 0
  let timer
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Guest session timed out:\n${output.slice(-3000)}`)), 85000)
      machine.add_listener('emulator-ready', async () => {
        try {
          await prepareGuest(machine, {
            [`${HOME}/projects`]: { type: 'directory' },
            [`${HOME}/projects/README.txt`]: { type: 'text', content: 'Project files' },
          }, { welcome: 'Session test', missingAudio: 'No recording', voiceRecordings: { en: new Uint8Array([1, 2]).buffer, zh: new Uint8Array([3, 4]).buffer } })
          machine.run()
        } catch (error) { reject(error) }
      })
      machine.add_listener('serial0-output-byte', byte => {
        output += String.fromCharCode(byte)
        if (stage === 0 && output.endsWith('~% ')) {
          stage = 1
          output = ''
          machine.serial0_send('. /mnt/init-site.sh\n')
        } else if (output.endsWith('leo@linux:~$ ')) {
          if (stage === 1) {
            stage = 2
            machine.serial0_send('echo kept > session.txt; cd /tmp; exit\n')
          } else if (stage === 2) {
            stage = 3
            machine.serial0_send('whoami; pwd; cat session.txt; cat projects/README.txt; exit 7\n')
          } else if (stage === 3) {
            stage = 4
            machine.serial0_send('\x04')
          } else if (stage === 4) {
            stage = 5
            machine.serial0_send('whoami; pwd; cat session.txt\nplay; play en; afplay zh\nplay voice/welcome.mp3; afplay voice/welcome-chinese.mp3\ncd voice; play welcome.mp3; stop; echo; echo SESSION_DONE\n')
          }
        }
        if (stage === 5 && output.includes('\r\nSESSION_DONE\r\n')) resolve()
      })
    })
    assert.equal((output.match(/\r\nleo\r\n/g) || []).length, 2)
    assert.equal((output.match(/\r\n\/home\/leo\r\n/g) || []).length, 2)
    assert.equal((output.match(/\r\nkept\r\n/g) || []).length, 2)
    assert.match(output, /\r\nProject files\r\n/)
    const playedFiles = [...output.matchAll(/\x1b\]777;leo-audio;play;([^\x07]+)\x07/g)]
      .map(match => Buffer.from(match[1], 'base64').toString().trim())
    assert.deepEqual(playedFiles, ['welcome.mp3', 'welcome-chinese.mp3', 'welcome.mp3'])
    assert.match(output, /Usage: play FILE/); assert.equal((output.match(/No recording/g) || []).length, 2)
    assert.match(output, /\x1b\]777;leo-audio;stop\x07/)
    assert.doesNotMatch(output, /~% |Password:|login:/)
    console.log('Verified exit, exit 7, and Ctrl+D return to Leo with guest files preserved.')
  } finally {
    clearTimeout(timer)
    await machine.destroy()
  }
})
