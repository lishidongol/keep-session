// scripts/generate-icons.js — 生成 SVG 图标并导出为 PNG 占位
// 运行方式：node scripts/generate-icons.js

const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
const outDir = path.join(__dirname, '..', 'icons');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

sizes.forEach((size) => {
  // 生成 SVG 内容
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a73e8"/>
      <stop offset="100%" style="stop-color:#4285f4"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <g transform="translate(24, 24)" fill="none" stroke="white" stroke-width="8" stroke-linecap="round">
    <path d="M40 8 C40 8 56 8 56 24 C56 40 72 40 72 40" opacity="0.7"/>
    <circle cx="40" cy="56" r="28" fill="none"/>
    <path d="M26 56 L40 70 L58 46" stroke-width="10"/>
  </g>
</svg>`;

  const svgPath = path.join(outDir, `icon-${size}.svg`);
  fs.writeFileSync(svgPath, svg);
  console.log(`Created: icon-${size}.svg`);

  // 也创建一个简单的 PNG 占位文件（实际部署时需要用工具转换）
  // 用 SVG 作为 web 可访问的资源
});

console.log('\n注意：SVG 图标已生成。Chrome Web Store 需要 PNG 格式。');
console.log('请使用在线工具（如 cloudconvert.com）将 SVG 转为 PNG，或直接替换为 PNG 图标。');
