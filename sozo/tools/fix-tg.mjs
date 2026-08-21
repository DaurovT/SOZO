import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function parseDart(text) {
  const out = new Map();
  const re = /^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*,/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1] ?? m[2];
    const value = m[3] ?? m[4];
    out.set(key, value);
  }
  return out;
}

const holders = (s) => (s.match(/\{[a-zA-Z0-9][a-zA-Z0-9_]*\}/g) ?? []).sort().join(',');

const apiBase = readFileSync(join(ROOT, 'apps/api/src/common/locale-en.ts'), 'utf8');
const cut = apiBase.indexOf('VALUES_EN');
const baseDict = parseDart(apiBase.slice(0, cut));
const baseVals = parseDart(apiBase.slice(cut));
for (const [k, v] of baseVals) baseDict.set(k, v);

const tgPath = join(ROOT, 'apps/api/src/common/locale-tg.ts');
const tgContent = readFileSync(tgPath, 'utf8');
const tgDict = parseDart(tgContent);

let fixedStr = tgContent;
for (const [k, v] of tgDict) {
  if (!baseDict.has(k)) continue;
  if (holders(baseDict.get(k)) !== holders(v)) {
    console.log(`Fixing ${k}`);
    const originalLine = new RegExp(`\\s*(?:'|")` + k.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\$&') + `(?:'|")\\s*:\\s*(?:'|").*?(?:'|")\\s*,`, 'g');
    
    // Replace carefully by building a new string instead of regex if it fails
    // But wait, the values might have unescaped things.
    let baseValEscaped = baseDict.get(k).replace(/(^|[^\\])\$/g, '$1\\$');
    fixedStr = fixedStr.replace(originalLine, `\n  ${JSON.stringify(k)}: ${JSON.stringify(baseValEscaped)},`);
  }
}
writeFileSync(tgPath, fixedStr);
