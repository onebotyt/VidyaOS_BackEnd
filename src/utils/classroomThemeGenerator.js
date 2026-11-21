/**
 * Classroom Theme & Banner Generator
 * Generates authentic Google Classroom style vector banners with rich gradients
 * and subject-specific academic vector illustrations (Commerce, Android, Books,
 * Programming, Mathematics, Science, Arts, General Campus).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Themes matching real Google Classroom styles
const THEMES = {
  commerce: {
    key: 'commerce',
    name: 'E-Commerce & Economics',
    keywords: ['commerce', 'economic', 'business', 'finance', 'account', 'market', 'trade', 'management', 'banking'],
    gradient: 'linear-gradient(135deg, #1c262f 0%, #283747 50%, #17202a 100%)',
    bgStart: '#1c262f',
    bgMid: '#283747',
    bgEnd: '#17202a',
    accentColor: '#f39c12',
    textColor: '#ffffff',
    subTextColor: 'rgba(255, 255, 255, 0.88)',
    renderSvg: (seed = 1) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bg-comm" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e272e" />
            <stop offset="45%" stop-color="#2c3e50" />
            <stop offset="100%" stop-color="#182026" />
          </linearGradient>
          <radialGradient id="glow-gold" cx="70%" cy="50%" r="55%">
            <stop offset="0%" stop-color="#d4af37" stop-opacity="0.32" />
            <stop offset="60%" stop-color="#8e6e14" stop-opacity="0.10" />
            <stop offset="100%" stop-color="#1e272e" stop-opacity="0" />
          </radialGradient>
          <linearGradient id="gold-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffeaa7" />
            <stop offset="35%" stop-color="#fbc531" />
            <stop offset="70%" stop-color="#e1b12c" />
            <stop offset="100%" stop-color="#b8860b" />
          </linearGradient>
          <linearGradient id="ribbon-red" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#e84118" />
            <stop offset="100%" stop-color="#c23616" />
          </linearGradient>
          <linearGradient id="ribbon-blue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#00a8ff" />
            <stop offset="100%" stop-color="#0097e6" />
          </linearGradient>
          <linearGradient id="medal-inner" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#e1b12c" />
            <stop offset="50%" stop-color="#f5cd79" />
            <stop offset="100%" stop-color="#ffd32a" />
          </linearGradient>
          <filter id="comm-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="2" dy="5" stdDeviation="6" flood-color="#000" flood-opacity="0.45" />
          </filter>
        </defs>

        <!-- Background -->
        <rect width="800" height="300" fill="url(#bg-comm)" />
        <circle cx="620" cy="150" r="280" fill="url(#glow-gold)" />

        <!-- Ambient geometric motifs -->
        <circle cx="520" cy="70" r="14" fill="#f5cd79" opacity="0.35" />
        <circle cx="690" cy="50" r="9" fill="#f5cd79" opacity="0.25" />
        <circle cx="480" cy="220" r="18" fill="#f5cd79" opacity="0.2" />
        <circle cx="740" cy="240" r="12" fill="#f5cd79" opacity="0.3" />

        <!-- Floating Sparkles (4-point stars) -->
        <path d="M560 110 Q560 125 545 125 Q560 125 560 140 Q560 125 575 125 Q560 125 560 110 Z" fill="#fff" opacity="0.75" />
        <path d="M720 115 Q720 125 710 125 Q720 125 720 135 Q720 125 730 125 Q720 125 720 115 Z" fill="#ffd32a" opacity="0.8" />
        <path d="M470 140 Q470 148 462 148 Q470 148 470 156 Q470 148 478 148 Q470 148 470 140 Z" fill="#ffeaa7" opacity="0.6" />

        <!-- Floating Gold Coins in Perspective -->
        <g transform="matrix(0.88 0.22 -0.25 0.92 480 80)" filter="url(#comm-shadow)">
          <ellipse cx="0" cy="0" rx="34" ry="22" fill="#b8860b" />
          <ellipse cx="0" cy="-3" rx="34" ry="22" fill="url(#gold-grad)" />
          <ellipse cx="0" cy="-3" rx="26" ry="16" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="2" />
          <text x="0" y="2" fill="#784200" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">&#9733;</text>
        </g>

        <g transform="matrix(0.92 -0.18 0.20 0.95 720 180)" filter="url(#comm-shadow)">
          <ellipse cx="0" cy="0" rx="42" ry="28" fill="#996515" />
          <ellipse cx="0" cy="-4" rx="42" ry="28" fill="url(#gold-grad)" />
          <ellipse cx="0" cy="-4" rx="33" ry="21" fill="none" stroke="#fff" stroke-opacity="0.4" stroke-width="2.5" />
          <text x="0" y="3" fill="#6d3b00" font-family="sans-serif" font-size="20" font-weight="bold" text-anchor="middle">&#9733;</text>
        </g>

        <!-- Big Award Medal with Ribbons (Google Classroom Authentic Artwork) -->
        <g transform="translate(620, 160)" filter="url(#comm-shadow)">
          <!-- Ribbon tails hanging from medal -->
          <path d="M-22 25 L-48 115 L-12 95 L12 118 L-2 25 Z" fill="url(#ribbon-red)" opacity="0.95" />
          <path d="M8 25 L-8 120 L25 102 L54 116 L28 25 Z" fill="url(#ribbon-blue)" opacity="0.95" />
          <path d="M-8 25 L-18 85 L-5 76 L6 88 L4 25 Z" fill="#c23616" />

          <!-- Outer Medal Rim with star notches -->
          <circle cx="0" cy="0" r="64" fill="#996515" />
          <circle cx="0" cy="0" r="62" fill="url(#gold-grad)" />
          <circle cx="0" cy="0" r="54" fill="#b8860b" />
          <circle cx="0" cy="0" r="51" fill="url(#medal-inner)" />

          <!-- Center Star & Wreath on Medal -->
          <polygon points="0,-32 10,-9 33,-9 15,6 22,29 0,16 -22,29 -15,6 -33,-9 -10,-9" fill="#fff" opacity="0.92" filter="url(#comm-shadow)" />
          <circle cx="0" cy="0" r="10" fill="#fbc531" />
        </g>

        <!-- Ribbon Streamer Wave in background -->
        <path d="M430 250 Q 520 220, 600 270 T 780 250" fill="none" stroke="#fbc531" stroke-width="4" stroke-linecap="round" opacity="0.45" stroke-dasharray="14 8" />
        <path d="M450 60 Q 560 30, 650 70 T 780 40" fill="none" stroke="#e84118" stroke-width="3" stroke-linecap="round" opacity="0.35" />
      </svg>
    `
  },

  android: {
    key: 'android',
    name: 'Android & Mobile Development',
    keywords: ['android', 'mobile', 'kotlin', 'flutter', 'react native', 'ios', 'swift', 'app dev', 'devices'],
    gradient: 'linear-gradient(135deg, #093b39 0%, #0d5c58 50%, #004d40 100%)',
    bgStart: '#093b39',
    bgMid: '#0d5c58',
    bgEnd: '#004d40',
    accentColor: '#3ddc84',
    textColor: '#ffffff',
    subTextColor: 'rgba(255, 255, 255, 0.88)',
    renderSvg: (seed = 2) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bg-and" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#063230" />
            <stop offset="50%" stop-color="#0e5a56" />
            <stop offset="100%" stop-color="#023e3a" />
          </linearGradient>
          <radialGradient id="glow-mint" cx="72%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#3ddc84" stop-opacity="0.35" />
            <stop offset="60%" stop-color="#1abc9c" stop-opacity="0.12" />
            <stop offset="100%" stop-color="#063230" stop-opacity="0" />
          </radialGradient>
          <linearGradient id="phone-body" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#2c3e50" />
            <stop offset="100%" stop-color="#1a252f" />
          </linearGradient>
          <linearGradient id="screen-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ecf0f1" />
            <stop offset="100%" stop-color="#dfe6e9" />
          </linearGradient>
          <linearGradient id="screen-bar" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#00b894" />
            <stop offset="100%" stop-color="#00cec9" />
          </linearGradient>
          <filter id="phone-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="-4" dy="8" stdDeviation="9" flood-color="#000" flood-opacity="0.5" />
          </filter>
        </defs>

        <!-- Background -->
        <rect width="800" height="300" fill="url(#bg-and)" />
        <circle cx="640" cy="150" r="270" fill="url(#glow-mint)" />

        <!-- Floating ambient circles & UI chips -->
        <circle cx="460" cy="80" r="16" fill="#3ddc84" opacity="0.3" />
        <circle cx="490" cy="240" r="22" fill="#3ddc84" opacity="0.2" />
        <circle cx="750" cy="80" r="12" fill="#81ecec" opacity="0.35" />

        <!-- Floating UI Card behind phone -->
        <g transform="matrix(0.96 0.20 -0.20 0.96 520 70)" opacity="0.5" filter="url(#phone-shadow)">
          <rect width="110" height="75" rx="8" fill="#1b4d4a" stroke="#3ddc84" stroke-width="1.5" />
          <rect x="12" y="14" width="40" height="7" rx="3.5" fill="#3ddc84" />
          <rect x="12" y="28" width="85" height="5" rx="2.5" fill="#a8e6cf" />
          <rect x="12" y="38" width="65" height="5" rx="2.5" fill="#a8e6cf" />
        </g>

        <!-- Sticky Note with Pushpin -->
        <g transform="matrix(0.95 -0.15 0.15 0.95 700 170)" filter="url(#phone-shadow)">
          <rect width="80" height="80" rx="6" fill="#ffeaa7" />
          <rect x="10" y="16" width="60" height="5" rx="2.5" fill="#fdcb6e" />
          <rect x="10" y="28" width="50" height="5" rx="2.5" fill="#fdcb6e" />
          <rect x="10" y="40" width="55" height="5" rx="2.5" fill="#fdcb6e" />
          <circle cx="40" cy="8" r="4.5" fill="#e17055" />
        </g>

        <!-- Google Classroom Style Tilted Modern Smartphone (Perspectival Isometric) -->
        <g transform="matrix(0.94 0.12 -0.12 0.96 600 20)" filter="url(#phone-shadow)">
          <!-- Outer Phone Chassis -->
          <rect x="0" y="0" width="168" height="270" rx="26" fill="url(#phone-body)" stroke="#4b6584" stroke-width="3" />
          
          <!-- Inner Screen Glass -->
          <rect x="7" y="7" width="154" height="256" rx="20" fill="url(#screen-grad)" />

          <!-- Top Speaker / Camera Notch Pill -->
          <rect x="58" y="13" width="52" height="7" rx="3.5" fill="#2d3436" />
          <circle cx="100" cy="16.5" r="2.5" fill="#0984e3" />

          <!-- App Top App Bar -->
          <rect x="7" y="25" width="154" height="34" fill="url(#screen-bar)" />
          <circle cx="24" cy="42" r="8" fill="#ffffff" opacity="0.85" />
          <rect x="38" y="38" width="55" height="8" rx="4" fill="#ffffff" />

          <!-- Feed Card Item 1 (Avatar + Text Lines) -->
          <g transform="translate(14, 68)">
            <rect width="140" height="52" rx="10" fill="#ffffff" filter="url(#phone-shadow)" opacity="0.9" />
            <circle cx="20" cy="22" r="11" fill="#ff7675" />
            <rect x="38" y="14" width="55" height="6.5" rx="3" fill="#2d3436" />
            <rect x="38" y="25" width="88" height="5" rx="2.5" fill="#b2bec3" />
            <rect x="38" y="34" width="60" height="5" rx="2.5" fill="#dfe6e9" />
          </g>

          <!-- Feed Card Item 2 (Avatar + Text Lines) -->
          <g transform="translate(14, 128)">
            <rect width="140" height="52" rx="10" fill="#ffffff" opacity="0.9" />
            <circle cx="20" cy="22" r="11" fill="#74b9ff" />
            <rect x="38" y="14" width="62" height="6.5" rx="3" fill="#2d3436" />
            <rect x="38" y="25" width="80" height="5" rx="2.5" fill="#b2bec3" />
            <rect x="38" y="34" width="50" height="5" rx="2.5" fill="#dfe6e9" />
          </g>

          <!-- Feed Card Item 3 -->
          <g transform="translate(14, 188)">
            <rect width="140" height="46" rx="10" fill="#ffffff" opacity="0.9" />
            <circle cx="20" cy="20" r="11" fill="#55efc4" />
            <rect x="38" y="13" width="70" height="6.5" rx="3" fill="#2d3436" />
            <rect x="38" y="24" width="75" height="5" rx="2.5" fill="#b2bec3" />
          </g>

          <!-- Floating Action Button (FAB +) -->
          <circle cx="132" cy="235" r="18" fill="#0984e3" filter="url(#phone-shadow)" />
          <path d="M132 226 L132 244 M123 235 L141 235" stroke="#ffffff" stroke-width="3" stroke-linecap="round" />
        </g>
      </svg>
    `
  },

  literature: {
    key: 'literature',
    name: 'Literature, Books & Humanities',
    keywords: ['literature', 'book', 'english', 'hindi', 'humanities', 'history', 'language', 'reading', 'writing', 'notes'],
    gradient: 'linear-gradient(135deg, #3d141e 0%, #5c1e2b 50%, #421319 100%)',
    bgStart: '#3d141e',
    bgMid: '#5c1e2b',
    bgEnd: '#421319',
    accentColor: '#e17055',
    textColor: '#ffffff',
    subTextColor: 'rgba(255, 255, 255, 0.88)',
    renderSvg: (seed = 3) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bg-lit" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#341119" />
            <stop offset="50%" stop-color="#551a27" />
            <stop offset="100%" stop-color="#2c0c14" />
          </linearGradient>
          <radialGradient id="glow-rose" cx="70%" cy="50%" r="55%">
            <stop offset="0%" stop-color="#ff7675" stop-opacity="0.28" />
            <stop offset="60%" stop-color="#d63031" stop-opacity="0.10" />
            <stop offset="100%" stop-color="#341119" stop-opacity="0" />
          </radialGradient>
          <linearGradient id="book-cover" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#e17055" />
            <stop offset="70%" stop-color="#d63031" />
            <stop offset="100%" stop-color="#b71540" />
          </linearGradient>
          <filter id="lit-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="3" dy="7" stdDeviation="8" flood-color="#000" flood-opacity="0.5" />
          </filter>
        </defs>

        <!-- Background -->
        <rect width="800" height="300" fill="url(#bg-lit)" />
        <circle cx="630" cy="150" r="280" fill="url(#glow-rose)" />

        <!-- Floating bookmarks & paper clips -->
        <circle cx="480" cy="90" r="16" fill="#fab1a0" opacity="0.3" />
        <circle cx="730" cy="70" r="12" fill="#ffeaa7" opacity="0.35" />

        <!-- Notepad in perspective behind book -->
        <g transform="matrix(0.96 0.18 -0.18 0.96 460 110)" filter="url(#lit-shadow)">
          <rect width="140" height="170" rx="8" fill="#dfe6e9" />
          <rect x="0" y="0" width="140" height="28" fill="#b2bec3" />
          <circle cx="16" cy="14" r="5" fill="#636e72" />
          <circle cx="36" cy="14" r="5" fill="#636e72" />
          <circle cx="56" cy="14" r="5" fill="#636e72" />
          <!-- Ruled notebook lines -->
          <line x1="20" y1="48" x2="120" y2="48" stroke="#b2bec3" stroke-width="2" />
          <line x1="20" y1="68" x2="120" y2="68" stroke="#b2bec3" stroke-width="2" />
          <line x1="20" y1="88" x2="120" y2="88" stroke="#b2bec3" stroke-width="2" />
          <line x1="20" y1="108" x2="100" y2="108" stroke="#b2bec3" stroke-width="2" />
          <line x1="20" y1="128" x2="115" y2="128" stroke="#b2bec3" stroke-width="2" />
        </g>

        <!-- Reading Glasses Resting Beside Book -->
        <g transform="matrix(0.95 -0.15 0.15 0.95 690 190)" filter="url(#lit-shadow)">
          <!-- Frames -->
          <circle cx="0" cy="0" r="26" fill="none" stroke="#ffeaa7" stroke-width="5" />
          <circle cx="58" cy="0" r="26" fill="none" stroke="#ffeaa7" stroke-width="5" />
          <path d="M26 0 Q 29 -7, 32 0" fill="none" stroke="#ffeaa7" stroke-width="4.5" />
          <!-- Glasses Temple Arms -->
          <path d="M-26 0 Q -45 15, -60 45" fill="none" stroke="#ffeaa7" stroke-width="4" stroke-linecap="round" />
          <path d="M84 0 Q 100 15, 115 45" fill="none" stroke="#ffeaa7" stroke-width="4" stroke-linecap="round" />
        </g>

        <!-- Google Classroom Classic Large Hardcover Book -->
        <g transform="matrix(0.94 -0.15 0.15 0.96 560 30)" filter="url(#lit-shadow)">
          <!-- Book Pages thickness -->
          <polygon points="12,238 152,238 178,222 38,222" fill="#ecf0f1" />
          <!-- Book Front Cover -->
          <rect x="0" y="0" width="158" height="225" rx="8" fill="url(#book-cover)" stroke="#ff7675" stroke-width="2.5" />
          <!-- Spine Ridge accent -->
          <line x1="18" y1="0" x2="18" y2="225" stroke="#b71540" stroke-width="4" />
          <!-- Cover Decorative Frame -->
          <rect x="36" y="28" width="100" height="170" rx="4" fill="none" stroke="#ffeaa7" stroke-width="2" stroke-opacity="0.8" />
          <!-- Cover Title lines -->
          <rect x="52" y="65" width="68" height="8" rx="4" fill="#ffffff" />
          <rect x="60" y="82" width="52" height="6" rx="3" fill="#ffeaa7" />
          <!-- Bookmark Ribbon hanging out -->
          <path d="M86 215 L86 250 L96 242 L106 250 L106 215 Z" fill="#fdcb6e" filter="url(#lit-shadow)" />
        </g>

        <!-- Fountain Pen tilted -->
        <g transform="matrix(0.7 0.7 -0.7 0.7 510 30)" filter="url(#lit-shadow)">
          <rect x="0" y="0" width="14" height="130" rx="7" fill="#2d3436" />
          <rect x="0" y="30" width="14" height="12" fill="#ffeaa7" />
          <polygon points="0,130 14,130 7,155" fill="#fbc531" />
          <line x1="7" y1="130" x2="7" y2="150" stroke="#2d3436" stroke-width="1.5" />
        </g>
      </svg>
    `
  },

  programming: {
    key: 'programming',
    name: 'Computer Science & Coding',
    keywords: ['code', 'programming', 'cs', 'it', 'software', 'data structures', 'dsa', 'web', 'python', 'java', 'c++', 'algorithms', 'database', 'cloud'],
    gradient: 'linear-gradient(135deg, #0f1c3f 0%, #1e2e62 50%, #111a3b 100%)',
    bgStart: '#0f1c3f',
    bgMid: '#1e2e62',
    bgEnd: '#111a3b',
    accentColor: '#00d2d3',
    textColor: '#ffffff',
    subTextColor: 'rgba(255, 255, 255, 0.88)',
    renderSvg: (seed = 4) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bg-prog" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0a1128" />
            <stop offset="50%" stop-color="#1c2541" />
            <stop offset="100%" stop-color="#0b132b" />
          </linearGradient>
          <radialGradient id="glow-cyan" cx="72%" cy="50%" r="55%">
            <stop offset="0%" stop-color="#00d2d3" stop-opacity="0.32" />
            <stop offset="60%" stop-color="#48dbfb" stop-opacity="0.10" />
            <stop offset="100%" stop-color="#0a1128" stop-opacity="0" />
          </radialGradient>
          <linearGradient id="laptop-screen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e272e" />
            <stop offset="100%" stop-color="#0f1418" />
          </linearGradient>
          <linearGradient id="laptop-case" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#485460" />
            <stop offset="50%" stop-color="#808e9b" />
            <stop offset="100%" stop-color="#485460" />
          </linearGradient>
          <filter id="prog-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="3" dy="7" stdDeviation="8" flood-color="#000" flood-opacity="0.5" />
          </filter>
        </defs>

        <!-- Background -->
        <rect width="800" height="300" fill="url(#bg-prog)" />
        <circle cx="630" cy="150" r="280" fill="url(#glow-cyan)" />

        <!-- Binary and Circuit Node Tracks -->
        <g opacity="0.35" stroke="#00d2d3" stroke-width="1.5" fill="none">
          <path d="M460 70 L520 70 L550 100 L610 100" />
          <circle cx="460" cy="70" r="4" fill="#00d2d3" />
          <circle cx="610" cy="100" r="4" fill="#00d2d3" />
          <path d="M490 230 L550 230 L580 200 L640 200" />
          <circle cx="490" cy="230" r="4" fill="#48dbfb" />
          <circle cx="640" cy="200" r="4" fill="#48dbfb" />
        </g>

        <!-- Floating Code Tag Badge < / > -->
        <g transform="matrix(0.95 0.15 -0.15 0.95 480 60)" filter="url(#prog-shadow)">
          <rect width="90" height="52" rx="12" fill="#1b263b" stroke="#00d2d3" stroke-width="2" />
          <text x="45" y="34" fill="#00d2d3" font-family="monospace" font-size="22" font-weight="bold" text-anchor="middle">&lt; / &gt;</text>
        </g>

        <!-- Floating Curly Braces Badge { } -->
        <g transform="matrix(0.94 -0.18 0.18 0.94 710 190)" filter="url(#prog-shadow)">
          <rect width="70" height="58" rx="10" fill="#1b263b" stroke="#ff9f43" stroke-width="2" />
          <text x="35" y="38" fill="#ff9f43" font-family="monospace" font-size="26" font-weight="bold" text-anchor="middle">{ ; }</text>
        </g>

        <!-- Sleek Laptop in Perspective with IDE Editor -->
        <g transform="matrix(0.96 -0.08 0.08 0.96 550 40)" filter="url(#prog-shadow)">
          <!-- Laptop Screen Frame -->
          <rect x="0" y="0" width="200" height="135" rx="10" fill="url(#laptop-case)" />
          <rect x="8" y="8" width="184" height="119" rx="6" fill="url(#laptop-screen)" />

          <!-- IDE Header with Window Dots -->
          <rect x="8" y="8" width="184" height="18" fill="#111827" />
          <circle cx="20" cy="17" r="3.5" fill="#ff5f56" />
          <circle cx="30" cy="17" r="3.5" fill="#ffbd2e" />
          <circle cx="40" cy="17" r="3.5" fill="#27c93f" />

          <!-- Syntax Highlighted Code Lines -->
          <g transform="translate(18, 36)">
            <!-- Line 1: class App { -->
            <rect x="0" y="0" width="38" height="5" rx="2" fill="#ff7675" />
            <rect x="42" y="0" width="30" height="5" rx="2" fill="#54a0ff" />
            <rect x="76" y="0" width="8" height="5" rx="2" fill="#ffeaa7" />
            <!-- Line 2:   def build() -> { -->
            <rect x="14" y="10" width="26" height="5" rx="2" fill="#1dd1a1" />
            <rect x="44" y="10" width="40" height="5" rx="2" fill="#ffeaa7" />
            <!-- Line 3:     return compile(state); -->
            <rect x="28" y="20" width="35" height="5" rx="2" fill="#ff7675" />
            <rect x="67" y="20" width="45" height="5" rx="2" fill="#54a0ff" />
            <rect x="116" y="20" width="20" height="5" rx="2" fill="#ff9ff3" />
            <!-- Line 4:     notify('OK'); -->
            <rect x="28" y="30" width="48" height="5" rx="2" fill="#feca57" />
            <rect x="80" y="30" width="35" height="5" rx="2" fill="#1dd1a1" />
            <!-- Line 5:   } -->
            <rect x="14" y="40" width="12" height="5" rx="2" fill="#ffeaa7" />
            <!-- Line 6: } -->
            <rect x="0" y="50" width="10" height="5" rx="2" fill="#ffeaa7" />
          </g>

          <!-- Laptop Keyboard Base (Trapezoid) -->
          <polygon points="-25,150 225,150 200,135 0,135" fill="url(#laptop-case)" />
          <polygon points="-22,148 222,148 200,137 0,137" fill="#d2dae2" />
          <!-- Trackpad -->
          <rect x="76" y="140" width="48" height="8" rx="2" fill="#808e9b" />
        </g>
      </svg>
    `
  },

  mathematics: {
    key: 'mathematics',
    name: 'Mathematics & Engineering',
    keywords: ['math', 'mathematics', 'calculus', 'algebra', 'geometry', 'physics', 'discrete', 'statistics', 'numerical'],
    gradient: 'linear-gradient(135deg, #1f0b3b 0%, #3a1566 50%, #200735 100%)',
    bgStart: '#1f0b3b',
    bgMid: '#3a1566',
    bgEnd: '#200735',
    accentColor: '#a29bfe',
    textColor: '#ffffff',
    subTextColor: 'rgba(255, 255, 255, 0.88)',
    renderSvg: (seed = 5) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bg-math" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#190730" />
            <stop offset="50%" stop-color="#341257" />
            <stop offset="100%" stop-color="#140424" />
          </linearGradient>
          <radialGradient id="glow-purple" cx="70%" cy="50%" r="55%">
            <stop offset="0%" stop-color="#a29bfe" stop-opacity="0.35" />
            <stop offset="60%" stop-color="#6c5ce7" stop-opacity="0.12" />
            <stop offset="100%" stop-color="#190730" stop-opacity="0" />
          </radialGradient>
          <filter id="math-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="3" dy="7" stdDeviation="7" flood-color="#000" flood-opacity="0.5" />
          </filter>
        </defs>

        <!-- Background -->
        <rect width="800" height="300" fill="url(#bg-math)" />
        <circle cx="630" cy="150" r="280" fill="url(#glow-purple)" />

        <!-- Floating Math symbols: Pi, Sigma, Infinity -->
        <text x="470" y="80" fill="#a29bfe" font-family="serif" font-size="34" font-weight="bold" opacity="0.6">&pi;</text>
        <text x="730" y="90" fill="#fd79a8" font-family="serif" font-size="36" font-weight="bold" opacity="0.5">&Sigma;</text>
        <text x="490" y="240" fill="#fdcb6e" font-family="serif" font-size="38" font-weight="bold" opacity="0.55">&infin;</text>
        <text x="720" y="230" fill="#55efc4" font-family="serif" font-size="32" font-weight="bold" opacity="0.5">&radic;</text>

        <!-- Coordinate Grid Card with Parabola / Sine Wave -->
        <g transform="matrix(0.96 0.12 -0.12 0.96 490 80)" filter="url(#math-shadow)">
          <rect width="130" height="130" rx="10" fill="#2d1b4e" stroke="#6c5ce7" stroke-width="2" />
          <!-- Grid Lines -->
          <g stroke="#4834d4" stroke-width="1" opacity="0.6">
            <line x1="26" y1="10" x2="26" y2="120" />
            <line x1="52" y1="10" x2="52" y2="120" />
            <line x1="78" y1="10" x2="78" y2="120" />
            <line x1="104" y1="10" x2="104" y2="120" />
            <line x1="10" y1="26" x2="120" y2="26" />
            <line x1="10" y1="52" x2="120" y2="52" />
            <line x1="10" y1="78" x2="120" y2="78" />
            <line x1="10" y1="104" x2="120" y2="104" />
          </g>
          <!-- Axes -->
          <line x1="65" y1="10" x2="65" y2="120" stroke="#a29bfe" stroke-width="2" />
          <line x1="10" y1="65" x2="120" y2="65" stroke="#a29bfe" stroke-width="2" />
          <!-- Parabola curve -->
          <path d="M25 110 Q 65 15, 105 110" fill="none" stroke="#ffeaa7" stroke-width="3" stroke-linecap="round" />
        </g>

        <!-- Protractor (Semi-circle Ruler with angle ticks) -->
        <g transform="matrix(0.92 -0.22 0.22 0.92 630 140)" filter="url(#math-shadow)">
          <path d="M-80 0 A 80 80 0 0 1 80 0 Z" fill="#ffeaa7" opacity="0.85" stroke="#e17055" stroke-width="2.5" />
          <path d="M-40 0 A 40 40 0 0 1 40 0 Z" fill="#2d1b4e" opacity="0.65" />
          <circle cx="0" cy="0" r="4" fill="#e17055" />
          <!-- Degree Ticks -->
          <line x1="-70" y1="0" x2="-62" y2="0" stroke="#2d3436" stroke-width="1.5" />
          <line x1="70" y1="0" x2="62" y2="0" stroke="#2d3436" stroke-width="1.5" />
          <line x1="0" y1="-70" x2="0" y2="-60" stroke="#2d3436" stroke-width="2" />
          <line x1="-49" y1="-49" x2="-43" y2="-43" stroke="#2d3436" stroke-width="1.5" />
          <line x1="49" y1="-49" x2="43" y2="-43" stroke="#2d3436" stroke-width="1.5" />
        </g>

        <!-- Triangle Ruler (30-60-90) -->
        <g transform="matrix(0.85 0.35 -0.35 0.85 640 40)" filter="url(#math-shadow)">
          <polygon points="0,0 120,0 0,90" fill="#55efc4" opacity="0.85" stroke="#00b894" stroke-width="2.5" />
          <polygon points="18,12 80,12 18,60" fill="#190730" opacity="0.5" />
        </g>
      </svg>
    `
  },

  science: {
    key: 'science',
    name: 'Science & Chemistry Lab',
    keywords: ['science', 'chemistry', 'biology', 'lab', 'experiment', 'physics', 'environmental', 'biotech'],
    gradient: 'linear-gradient(135deg, #072a36 0%, #0c4a5e 50%, #083342 100%)',
    bgStart: '#072a36',
    bgMid: '#0c4a5e',
    bgEnd: '#083342',
    accentColor: '#00cec9',
    textColor: '#ffffff',
    subTextColor: 'rgba(255, 255, 255, 0.88)',
    renderSvg: (seed = 6) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bg-sci" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#041e26" />
            <stop offset="50%" stop-color="#0b3d4d" />
            <stop offset="100%" stop-color="#052732" />
          </linearGradient>
          <radialGradient id="glow-cyan-sci" cx="70%" cy="50%" r="55%">
            <stop offset="0%" stop-color="#00cec9" stop-opacity="0.35" />
            <stop offset="60%" stop-color="#0984e3" stop-opacity="0.12" />
            <stop offset="100%" stop-color="#041e26" stop-opacity="0" />
          </radialGradient>
          <linearGradient id="liquid-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#55efc4" />
            <stop offset="100%" stop-color="#00cec9" />
          </linearGradient>
          <filter id="sci-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="3" dy="7" stdDeviation="7" flood-color="#000" flood-opacity="0.5" />
          </filter>
        </defs>

        <!-- Background -->
        <rect width="800" height="300" fill="url(#bg-sci)" />
        <circle cx="630" cy="150" r="280" fill="url(#glow-cyan-sci)" />

        <!-- Floating Bubbles & Atoms -->
        <circle cx="480" cy="100" r="14" fill="#81ecec" opacity="0.3" />
        <circle cx="720" cy="80" r="10" fill="#55efc4" opacity="0.35" />
        <circle cx="510" cy="220" r="18" fill="#81ecec" opacity="0.2" />

        <!-- Atom Model (Elliptical Orbits with Nucleus) -->
        <g transform="matrix(0.9 0.2 -0.2 0.9 500 120)" opacity="0.75" filter="url(#sci-shadow)">
          <ellipse cx="0" cy="0" rx="55" ry="20" fill="none" stroke="#81ecec" stroke-width="2" />
          <ellipse cx="0" cy="0" rx="55" ry="20" fill="none" stroke="#81ecec" stroke-width="2" transform="rotate(60)" />
          <ellipse cx="0" cy="0" rx="55" ry="20" fill="none" stroke="#81ecec" stroke-width="2" transform="rotate(-60)" />
          <!-- Nucleus -->
          <circle cx="0" cy="0" r="10" fill="#fd79a8" />
          <circle cx="-3" cy="-3" r="5" fill="#ffeaa7" />
          <!-- Electrons -->
          <circle cx="52" cy="0" r="5" fill="#ffeaa7" />
          <circle cx="-26" cy="45" r="5" fill="#ffeaa7" />
        </g>

        <!-- Test Tube with Orange Fluid -->
        <g transform="matrix(0.95 -0.25 0.25 0.95 720 120)" filter="url(#sci-shadow)">
          <rect x="0" y="0" width="22" height="110" rx="11" fill="#dfe6e9" opacity="0.75" stroke="#ffffff" stroke-width="2" />
          <rect x="2" y="45" width="18" height="63" rx="9" fill="#ff7675" />
          <!-- Rim -->
          <rect x="-3" y="0" width="28" height="6" rx="3" fill="#ffffff" />
          <!-- Measurement Ticks -->
          <line x1="5" y1="25" x2="11" y2="25" stroke="#2d3436" stroke-width="1.5" />
          <line x1="5" y1="35" x2="11" y2="35" stroke="#2d3436" stroke-width="1.5" />
          <line x1="5" y1="45" x2="14" y2="45" stroke="#2d3436" stroke-width="1.5" />
        </g>

        <!-- Google Classroom Classic Large Erlenmeyer Flask -->
        <g transform="translate(620, 60)" filter="url(#sci-shadow)">
          <!-- Glass Body -->
          <path d="M-14 0 L14 0 L14 45 L58 140 A 18 18 0 0 1 42 165 L-42 165 A 18 18 0 0 1 -58 140 L-14 45 Z" fill="#dfe6e9" opacity="0.4" stroke="#ffffff" stroke-width="3" />
          
          <!-- Liquid Inside Flask -->
          <path d="M-44 110 Q 0 95, 44 110 L42 163 L-42 163 Z" fill="url(#liquid-grad)" opacity="0.92" />
          <!-- Liquid Meniscus wave -->
          <path d="M-44 110 Q 0 95, 44 110" fill="none" stroke="#ffffff" stroke-width="2.5" opacity="0.8" />

          <!-- Rising Bubbles in Liquid -->
          <circle cx="-10" cy="135" r="5" fill="#ffffff" opacity="0.7" />
          <circle cx="15" cy="125" r="7" fill="#ffffff" opacity="0.75" />
          <circle cx="0" cy="115" r="4" fill="#ffffff" opacity="0.8" />
          <circle cx="-18" cy="148" r="3.5" fill="#ffffff" opacity="0.6" />

          <!-- Top Rim Lip -->
          <rect x="-18" y="-4" width="36" height="8" rx="4" fill="#ffffff" />
        </g>
      </svg>
    `
  },

  arts: {
    key: 'arts',
    name: 'Arts, UI/UX & Creative Design',
    keywords: ['art', 'arts', 'design', 'ui', 'ux', 'graphic', 'multimedia', 'animation', 'drawing', 'music'],
    gradient: 'linear-gradient(135deg, #380d2a 0%, #61184a 50%, #3e092b 100%)',
    bgStart: '#380d2a',
    bgMid: '#61184a',
    bgEnd: '#3e092b',
    accentColor: '#fd79a8',
    textColor: '#ffffff',
    subTextColor: 'rgba(255, 255, 255, 0.88)',
    renderSvg: (seed = 7) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bg-arts" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#2c0820" />
            <stop offset="50%" stop-color="#551240" />
            <stop offset="100%" stop-color="#320622" />
          </linearGradient>
          <radialGradient id="glow-pink" cx="70%" cy="50%" r="55%">
            <stop offset="0%" stop-color="#fd79a8" stop-opacity="0.35" />
            <stop offset="60%" stop-color="#e84393" stop-opacity="0.12" />
            <stop offset="100%" stop-color="#2c0820" stop-opacity="0" />
          </radialGradient>
          <linearGradient id="wood-palette" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffeaa7" />
            <stop offset="100%" stop-color="#fdcb6e" />
          </linearGradient>
          <filter id="arts-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="3" dy="7" stdDeviation="7" flood-color="#000" flood-opacity="0.5" />
          </filter>
        </defs>

        <!-- Background -->
        <rect width="800" height="300" fill="url(#bg-arts)" />
        <circle cx="630" cy="150" r="280" fill="url(#glow-pink)" />

        <!-- Floating Color Swatches -->
        <circle cx="480" cy="80" r="14" fill="#fd79a8" opacity="0.35" />
        <circle cx="730" cy="90" r="12" fill="#ffeaa7" opacity="0.35" />

        <!-- Paint Swatch Fan Cards in background -->
        <g transform="matrix(0.96 0.2 -0.2 0.96 480 120)" filter="url(#arts-shadow)">
          <rect width="45" height="110" rx="6" fill="#e84393" transform="rotate(-25)" />
          <rect width="45" height="110" rx="6" fill="#00cec9" transform="rotate(-10)" />
          <rect width="45" height="110" rx="6" fill="#fdcb6e" transform="rotate(5)" />
          <circle cx="0" cy="100" r="5" fill="#2d3436" />
        </g>

        <!-- Classical Painter's Palette with 5 vibrant paint blobs -->
        <g transform="matrix(0.95 -0.15 0.15 0.95 620 50)" filter="url(#arts-shadow)">
          <!-- Wood Palette Kidney shape -->
          <path d="M0 60 C-60 40 -80 130 -10 160 C50 180 110 160 110 90 C110 30 50 -10 0 60 Z" fill="url(#wood-palette)" stroke="#e17055" stroke-width="3" />
          <!-- Thumb hole -->
          <ellipse cx="65" cy="115" rx="14" ry="18" fill="#2c0820" />

          <!-- Colorful paint dollops -->
          <ellipse cx="-25" cy="80" rx="13" ry="10" fill="#e84118" />
          <ellipse cx="0" cy="30" rx="14" ry="11" fill="#fbc531" />
          <ellipse cx="45" cy="35" rx="13" ry="10" fill="#00a8ff" />
          <ellipse cx="80" cy="70" rx="12" ry="9" fill="#4cd137" />
          <ellipse cx="-35" cy="120" rx="11" ry="9" fill="#9c88ff" />
        </g>

        <!-- Painter's Brush Crossing Palette -->
        <g transform="matrix(0.7 0.7 -0.7 0.7 580 30)" filter="url(#arts-shadow)">
          <!-- Wooden handle -->
          <polygon points="-6,0 6,0 3,160 -3,160" fill="#d35400" />
          <!-- Silver ferrule -->
          <rect x="-6" y="160" width="12" height="25" fill="#bdc3c7" stroke="#7f8c8d" stroke-width="1" />
          <!-- Dark bristles with paint tip -->
          <path d="M-6 185 L6 185 L3 215 Q 0 225 -3 215 Z" fill="#2c3e50" />
          <path d="M-4 205 L4 205 L2 215 Q 0 225 -2 215 Z" fill="#e84393" />
        </g>
      </svg>
    `
  },

  general_campus: {
    key: 'general_campus',
    name: 'Campus Academic & Diploma',
    keywords: ['general', 'campus', 'academic', 'theory', 'college', 'university', 'exam', 'seminar', 'orientation'],
    gradient: 'linear-gradient(135deg, #0d324d 0%, #175279 50%, #0e3b5c 100%)',
    bgStart: '#0d324d',
    bgMid: '#175279',
    bgEnd: '#0e3b5c',
    accentColor: '#48dbfb',
    textColor: '#ffffff',
    subTextColor: 'rgba(255, 255, 255, 0.88)',
    renderSvg: (seed = 8) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="bg-camp" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#082338" />
            <stop offset="50%" stop-color="#124161" />
            <stop offset="100%" stop-color="#0a2a42" />
          </linearGradient>
          <radialGradient id="glow-sky" cx="70%" cy="50%" r="55%">
            <stop offset="0%" stop-color="#48dbfb" stop-opacity="0.32" />
            <stop offset="60%" stop-color="#0abde3" stop-opacity="0.10" />
            <stop offset="100%" stop-color="#082338" stop-opacity="0" />
          </radialGradient>
          <filter id="camp-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="3" dy="7" stdDeviation="7" flood-color="#000" flood-opacity="0.5" />
          </filter>
        </defs>

        <!-- Background -->
        <rect width="800" height="300" fill="url(#bg-camp)" />
        <circle cx="630" cy="150" r="280" fill="url(#glow-sky)" />

        <!-- Floating campus stars & icons -->
        <circle cx="480" cy="80" r="14" fill="#48dbfb" opacity="0.3" />
        <circle cx="730" cy="70" r="10" fill="#feca57" opacity="0.4" />
        <circle cx="490" cy="230" r="18" fill="#48dbfb" opacity="0.2" />

        <!-- Classical Academic Columns (Greek Temple motif) -->
        <g transform="translate(480, 100)" opacity="0.45" stroke="#48dbfb" stroke-width="2.5" fill="none">
          <line x1="0" y1="120" x2="80" y2="120" stroke-width="4" />
          <line x1="10" y1="30" x2="10" y2="120" />
          <line x1="25" y1="30" x2="25" y2="120" />
          <line x1="55" y1="30" x2="55" y2="120" />
          <line x1="70" y1="30" x2="70" y2="120" />
          <polygon points="0,30 40,5 80,30" fill="none" stroke-width="3" />
        </g>

        <!-- Diploma Scroll with Red Ribbon & Wax Seal -->
        <g transform="matrix(0.92 0.22 -0.22 0.92 680 150)" filter="url(#camp-shadow)">
          <!-- Rolled Parchment -->
          <rect x="-60" y="-18" width="120" height="36" rx="10" fill="#f5f6fa" stroke="#dcdde1" stroke-width="2" />
          <ellipse cx="-60" cy="0" rx="8" ry="18" fill="#dcdde1" />
          <ellipse cx="60" cy="0" rx="8" ry="18" fill="#f5f6fa" />
          <!-- Red Ribbon Tied around roll -->
          <rect x="-10" y="-20" width="20" height="40" fill="#e84118" />
          <circle cx="0" cy="0" r="14" fill="#c23616" />
          <circle cx="0" cy="0" r="8" fill="#e84118" />
          <!-- Ribbon tails -->
          <path d="M-6 14 L-15 42 L0 36 L15 42 L6 14 Z" fill="#c23616" />
        </g>

        <!-- Graduation Mortarboard Cap (Google Classroom Icon) -->
        <g transform="matrix(0.95 -0.15 0.15 0.95 610 50)" filter="url(#camp-shadow)">
          <!-- Cap Skull Base -->
          <path d="M-30 45 C-30 65 30 65 30 45 Z" fill="#2d3436" />
          <!-- Diamond Cap Top -->
          <polygon points="0,0 80,28 0,56 -80,28" fill="#1e272e" stroke="#485460" stroke-width="2.5" />
          <!-- Button and Gold Tassel -->
          <circle cx="0" cy="28" r="6" fill="#fbc531" />
          <path d="M0 28 Q 45 42, 60 70" fill="none" stroke="#fbc531" stroke-width="3" stroke-linecap="round" />
          <!-- Tassel Brush Fringe -->
          <polygon points="56,70 64,70 68,96 52,96" fill="#fbc531" />
        </g>
      </svg>
    `
  }
};

/**
 * Automatically picks the best theme for a given class or randomly selects one.
 */
function resolveThemeKey(group = {}) {
  const text = `${group.name || ''} ${group.subject_name || ''} ${group.subject_code || ''} ${group.subject_short_name || ''}`.toLowerCase();

  for (const [key, theme] of Object.entries(THEMES)) {
    if (theme.keywords.some(kw => text.includes(kw))) {
      return key;
    }
  }

  // If no keyword match, select deterministically or randomly based on ID / seed
  const themeKeys = Object.keys(THEMES);
  const seed = (group.id || group.teacher_id || Math.floor(Math.random() * 1000));
  return themeKeys[seed % themeKeys.length];
}

/**
 * Generates an SVG banner file on disk and returns its relative path
 * @param {Object} group - Teaching group data { id, name, subject_name, subject_code }
 * @param {string} [customThemeKey] - Optional override theme key
 * @returns {string} Relative URL path, e.g. '/uploads/classroom-banners/theme-commerce-12.svg'
 */
function generateClassroomBanner(group = {}, customThemeKey = null) {
  try {
    const themeKey = customThemeKey && THEMES[customThemeKey] ? customThemeKey : resolveThemeKey(group);
    const theme = THEMES[themeKey] || THEMES.general_campus;

    const bannerDir = path.join(__dirname, '..', '..', 'uploads', 'classroom-banners');
    if (!fs.existsSync(bannerDir)) {
      fs.mkdirSync(bannerDir, { recursive: true });
    }

    const filename = `banner_${themeKey}_${group.id || Date.now()}_${crypto.randomBytes(3).toString('hex')}.svg`;
    const filePath = path.join(bannerDir, filename);

    const svgContent = theme.renderSvg(group.id || 1).trim();
    fs.writeFileSync(filePath, svgContent, 'utf8');

    return `/uploads/classroom-banners/${filename}`;
  } catch (err) {
    console.error('Error in generateClassroomBanner:', err);
    return null;
  }
}

/**
 * Backfills missing theme_image in all teaching_groups in database
 * @param {Function} query - Database query function
 */
async function backfillClassroomThemes(query) {
  try {
    const groups = await query(`SELECT id, name, subject_name, subject_code, theme_image FROM teaching_groups WHERE theme_image IS NULL OR theme_image = ''`);
    if (!groups || groups.length === 0) return;

    for (const g of groups) {
      const bannerUrl = generateClassroomBanner(g);
      if (bannerUrl) {
        await query(`UPDATE teaching_groups SET theme_image = ? WHERE id = ?`, [bannerUrl, g.id]);
      }
    }
    console.log(`[ClassroomThemes] Backfilled ${groups.length} teaching groups with generated banners.`);
  } catch (err) {
    console.error('Error in backfillClassroomThemes:', err);
  }
}

module.exports = {
  THEMES,
  resolveThemeKey,
  generateClassroomBanner,
  backfillClassroomThemes
};
