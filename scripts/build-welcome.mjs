// Builds the welcome page visitors see at `/` from site/welcome/index.src.html:
// inlines its stylesheets, points the Play buttons at /play and the pictures at
// /welcome/img, and wraps it as a full document with link-preview tags.
//   node scripts/build-welcome.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://meridian-town-production.up.railway.app';
const src = 'site/welcome';
let s = readFileSync(join(src, 'index.src.html'), 'utf8');
for (const f of ['paper.css', 'tokens.css', 'base.css']) {
  s = s.replace(`@import url("./${f}");`, readFileSync(join(src, f), 'utf8'));
}
if (s.includes('@import')) throw new Error('an @import was left unresolved');
s = s.replaceAll(`${SITE}/`, '/play').replaceAll('src="img/', 'src="/welcome/img/');

const at = s.indexOf('</title>') + '</title>'.length;
const head = `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="A cozy 3D island market town on NEAR. Gather, trade with AI shopkeepers and buy your own shop. Play free in your browser, no wallet needed.">
<meta property="og:title" content="Meridian Town">
<meta property="og:description" content="A market town that runs itself. Gather, trade and buy your own shop from AI merchants. Play free in your browser.">
<meta property="og:image" content="${SITE}/welcome/img/festival-night.jpg">
<meta name="twitter:card" content="summary_large_image">`;
s = `<!doctype html>\n<html lang="en">\n<head>\n${s.slice(0, at)}${head}${s.slice(at)}`;
s = s.replace('</style>\n', '</style>\n</head>\n<body>\n');
s = `${s.trimEnd()}\n</body>\n</html>\n`;

writeFileSync('apps/web/public/welcome/index.html', s);
console.log(`welcome page: ${s.length} bytes`);
