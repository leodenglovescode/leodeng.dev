// Geeky typing effect for the terminal
const typedText = document.getElementById('typed-text');
const cursor = document.querySelector('.cursor');
const text = "whoami && echo 'Welcome to leodeng.dev'";
let index = 0;

function typeWriter() {
    if (typedText && index < text.length) {
        typedText.innerHTML += text.charAt(index);
        index++;
        setTimeout(typeWriter, 100);
    } else if (cursor) {
        cursor.style.animation = 'none';
    }
}

// Page switching with fade effects
function switchPage(target) {
    const current = document.querySelector('#content section.active');
    const next = document.getElementById(target);
    
    if (current === next) return;
    
    if (current) current.classList.remove('active');
    next.classList.add('active');
    window.location.hash = target;
    window.scrollTo(0, 0); // Scroll to top on page change
    
    // Handle typing for home
    if (target === 'home') {
        // Fill background text with just 1-2 lines
        const bgText = document.querySelector('.bg-text');
        if (bgText) {
            bgText.innerHTML = '01010101     01010101';
        }
        index = 0;
        if (typedText) typedText.innerHTML = '';
        if (cursor) cursor.style.animation = 'blink 1s infinite';
        setTimeout(typeWriter, 1000);
    }
}

// Handle nav clicks
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = this.getAttribute('href').substring(1);
        switchPage(target);
    });
});

// Handle initial load and hash changes
document.addEventListener('DOMContentLoaded', () => {
    const hash = window.location.hash.substring(1) || 'home';
    const section = document.getElementById(hash);
    if (section) {
        section.classList.add('active');
        if (hash === 'home') {
            // Fill background text with just 1-2 lines
            const bgText = document.querySelector('.bg-text');
            if (bgText) {
                bgText.innerHTML = '01010101     01010101';
            }
            setTimeout(typeWriter, 1000);
        }
    }
});

window.addEventListener('hashchange', () => {
    const hash = window.location.hash.substring(1);
    if (hash) switchPage(hash);
});