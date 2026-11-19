// make-icons.js — draws the PlaygroundBooth icons (gold serif "P" with a gold dot on cream).
//   node installer/make-icons.js            → installer/icon.png (1024, app icon for Mac & Windows)
//                                             demo/ikon-512.png, demo/ikon-180.png (phone demo, full square)
//   node installer/make-icons.js --preview  → only writes dist/icon-preview.png (all fonts side by side)
// Drawn as SVG and rendered by the Chromium that comes with Playwright (devDependency).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FONT = "'Bodoni MT', 'Georgia', serif"; // Bodoni MT comes with Windows Office; the PNGs are committed
const GOLD = ['#BC9660', '#A57C47']; // top → bottom, the same gold as the guest screens

// The letter and dot, in a 1024 box. `x`/`y` move the mark, `size` is the font size.
function mark({ font = FONT, size = 560, x = 480, y = 735 } = {}) {
  return `
    <text x="${x}" y="${y}" text-anchor="middle" font-family="${font}" font-weight="700" font-size="${size}"
      fill="url(#gold)">P</text>
    <circle cx="${x + 205}" cy="${y - 28}" r="30" fill="#B08D57"/>`;
}

const defs = `
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FAF3EA"/><stop offset="1" stop-color="#EAD8BE"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${GOLD[0]}"/><stop offset="1" stop-color="${GOLD[1]}"/>
  </linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity="0.28"/>
  </filter>`;

// App icon: rounded square with a soft shadow on a transparent background (macOS style, also fine on Windows)
const appIcon = opts => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${defs}</defs>
  <rect x="102" y="102" width="820" height="820" rx="185" fill="url(#bg)" stroke="#E6D5BC" stroke-width="4"
    filter="url(#shadow)"/>
  ${mark(opts)}
</svg>`;

// Phone demo icon: full square (the phone rounds the corners itself)
const demoIcon = opts => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${defs}</defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <g transform="translate(-22 -40) scale(1.05)">${mark(opts)}</g>
</svg>`;

async function render(page, svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg style="width:${size}px;height:${size}px;display:block" `)}</body></html>`,
  );
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: true });
  console.log('✓ ' + path.relative(ROOT, file));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  if (process.argv.includes('--preview')) {
    const fonts = ['Georgia', 'Cambria', 'Times New Roman', 'Book Antiqua', 'Constantia', 'Bodoni MT'];
    const cells = fonts
      .map(
        f =>
          `<div style="text-align:center;font:14px sans-serif">${appIcon({ font: `'${f}', serif` }).replace(
            '<svg ',
            '<svg style="width:220px;height:220px" ',
          )}<br>${f}</div>`,
      )
      .join('');
    await page.setViewportSize({ width: 1400, height: 300 });
    await page.setContent(`<body style="margin:10px;display:flex;gap:6px;background:#fff">${cells}</body>`);
    fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, 'dist', 'icon-preview.png') });
    console.log('✓ dist/icon-preview.png');
  } else {
    await render(page, appIcon(), 1024, path.join(ROOT, 'installer', 'icon.png'));
    await render(page, demoIcon(), 512, path.join(ROOT, 'demo', 'ikon-512.png'));
    await render(page, demoIcon(), 180, path.join(ROOT, 'demo', 'ikon-180.png'));
  }
  await browser.close();
})();
