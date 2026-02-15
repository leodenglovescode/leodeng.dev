const terminalInput = document.getElementById('terminal-input');
const terminalSuggestion = document.getElementById('terminal-suggestion');
const outputContainer = document.getElementById('output');
const terminalScreen = document.getElementById('terminal-screen');

const COMMANDS = {
    help: 'Available commands: help, whoami, echo, clear, about, projects, contact, tux, sudo, coffee, date, exit',
    whoami: 'Leo Deng (a.k.a @leodenglovescode) - Full-stack dev and open-source lover.',
    echo: (args) => args.join(' '),
    clear: () => {
        outputContainer.innerHTML = '';
        return null;
    },
    about: 'Hi, I\'m Leo Deng (a.k.a @leodenglovescode). A passionate full-stack developer with a love for fun & open-source projects, and all things tech-related. When I\'m not coding, you\'ll find me tinkering with hardware (Arduino/Raspberry Pi/PC Building) or diving into the latest stuff about AI and web dev.',
    projects: 'Check out my work at leodeng.dev/projects.html',
    contact: 'Email: leodeng.hack@gmail.com | GitHub: @leodenglovescode',
    tux: () => {
        return `
<span style="color: white">                 .88888888:. </span>
<span style="color: white">                88888888.88888.</span>
<span style="color: white">              .8888888888888888.</span>
<span style="color: white">              888888888888888888</span>
<span style="color: white">              88' </span><span style="color: #00ffff">_</span><span style="color: white">\`88</span><span style="color: #00ffff">_</span><span style="color: white">  \`88888</span>
<span style="color: white">              88 </span><span style="color: #00ffff">88</span><span style="color: white"> 88 </span><span style="color: #00ffff">88</span><span style="color: white">  88888</span>
<span style="color: white">              88_88_::_88_:88888</span>
<span style="color: white">              88:::,::,:::::8888</span>
<span style="color: white">              88</span><span style="color: #ffa500">\`:::::::::'\`</span><span style="color: white">8888</span>
<span style="color: white">             .88  </span><span style="color: #ffa500">\`::::'</span><span style="color: white">    8:88.</span>
<span style="color: white">            8888            \`8:888.</span>
<span style="color: white">          .8888'             \`888888.</span>
<span style="color: white">         .8888:..  .::.  ...:'8888888:.</span>
<span style="color: white">        .8888.'     :'     \`'::\`88:88888</span>
<span style="color: white">       .8888        '         \`.888:8888.</span>
<span style="color: white">      888:8         .           888:88888</span>
<span style="color: white">    .888:88        .:           888:88888:</span>
<span style="color: white">    8888888.       ::           88:888888</span>
<span style="color: white">    \`.::.888.      ::          .88888888</span>
<span style="color: white">   .::::::.888.    ::         :::\`8888'.:.</span>
<span style="color: white">  ::::::::::.888   '         .::::::::::::</span>
<span style="color: white">  ::::::::::::.8    '      .:8::::::::::::.</span>
<span style="color: white"> .::::::::::::::.        .:888:::::::::::::</span>
<span style="color: :::::::::::::::88:.__..:88888:::::::::::'</span>
<span style="color: #ffa500">  \`'.:::::::::::88888888888.88:::::::::'</span>
<span style="color: #ffa500">        \`':::_:' -- '' -'-' \`:_::::'\`</span>`;
    },
    linux: () => COMMANDS.tux(),
    sudo: (args) => {
        if (args.length === 0) return "usage: sudo <command>";
        return `[sudo] password for leo: 
Nice try! You don't have enough permissions to ${args[0]}.`;
    },
    coffee: () => "☕ Coming right up! [Heating...] [Brewing...] [Done!]",
    date: () => new Date().toString(),
    exit: () => {
        window.location.href = 'index.html';
        return 'Exiting...';
    }
};

const SUGGESTIONS = Object.keys(COMMANDS);

terminalInput.addEventListener('input', () => {
    updateSuggestion();
});

terminalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const input = terminalInput.value.trim();
        handleCommand(input);
        terminalInput.value = '';
        terminalSuggestion.textContent = '';
    } else if (e.key === 'Tab') {
        e.preventDefault();
        const suggestion = terminalSuggestion.textContent;
        if (suggestion) {
            terminalInput.value = suggestion;
            terminalSuggestion.textContent = '';
        }
    }
});

function updateSuggestion() {
    const value = terminalInput.value;
    if (!value) {
        terminalSuggestion.textContent = '';
        return;
    }

    const match = SUGGESTIONS.find(cmd => cmd.startsWith(value));
    if (match) {
        terminalSuggestion.textContent = match;
    } else {
        terminalSuggestion.textContent = '';
    }
}

function handleCommand(input) {
    if (!input) {
        addPromptLine('');
        return;
    }

    const [cmd, ...args] = input.split(' ');
    printLine(`leo@leodeng:~$ ${input}`);

    if (COMMANDS[cmd]) {
        const response = typeof COMMANDS[cmd] === 'function' ? COMMANDS[cmd](args) : COMMANDS[cmd];
        if (response !== null) {
            // Check if response contains HTML (like Tux)
            if (cmd === 'tux' || cmd === 'linux' || typeof response === 'string' && response.includes('<span')) {
                printHTML(response);
            } else {
                printLine(response);
            }
        }
    } else {
        printLine(`Command not found: ${cmd}. Type 'help' for available commands.`);
    }

    terminalScreen.scrollTop = terminalScreen.scrollHeight;
}

function printLine(text) {
    const line = document.createElement('div');
    line.className = 'output-line';
    line.style.whiteSpace = 'pre-wrap'; // Ensure text wraps to the next line
    line.style.wordWrap = 'break-word'; // Break long words if necessary
    line.textContent = text;
    outputContainer.appendChild(line);
}

function printHTML(html) {
    const line = document.createElement('div');
    line.className = 'output-line';
    line.style.whiteSpace = 'pre-wrap'; // Ensure text wraps to the next line
    line.style.wordWrap = 'break-word'; // Break long words if necessary
    line.innerHTML = html;
    outputContainer.appendChild(line);
}

function focusInput() {
    terminalInput.focus();
}

window.addEventListener('load', () => {
    terminalInput.focus();
});
