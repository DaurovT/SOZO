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

function fixPlaceholders(filePath, baseFile, type) {
  const fileStr = readFileSync(filePath, 'utf8');
  const baseStr = readFileSync(baseFile, 'utf8');
  
  let baseDict;
  if (type === 'api') {
    const cut = baseStr.indexOf('VALUES_EN');
    baseDict = parseDart(cut > 0 ? baseStr.slice(0, cut) : baseStr);
    const baseVals = parseDart(cut > 0 ? baseStr.slice(cut) : '');
    for (const [k, v] of baseVals) baseDict.set(k, v);
  } else {
    baseDict = parseDart(baseStr);
  }
  
  const dict = parseDart(fileStr);
  
  let fixedStr = fileStr;
  for (const [k, v] of dict) {
    if (!baseDict.has(k)) continue;
    const baseH = holders(baseDict.get(k));
    const dictH = holders(v);
    
    if (baseH !== dictH) {
      console.log(`Fixing key "${k}" in ${filePath}`);
      // Fallback to base string for this key
      const baseValEscaped = baseDict.get(k).replace(/(^|[^\\])\$/g, '$1\\$');
      
      // We will replace the value in fixedStr
      const regex = new RegExp(`('|")` + k.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\$&') + `\\1\\s*:\\s*('|").*?\\2\\s*,`, 'g');
      fixedStr = fixedStr.replace(regex, `"${k}": ${JSON.stringify(baseValEscaped)},`);
    }
  }
  writeFileSync(filePath, fixedStr);
}

// Fix API TG
fixPlaceholders(join(ROOT, 'apps/api/src/common/locale-tg.ts'), join(ROOT, 'apps/api/src/common/locale-en.ts'), 'api');

// Fix Landing AR, KO, TG, ZH
const langs = ['ar', 'ko', 'tg', 'zh'];
for (const l of langs) {
  fixPlaceholders(join(ROOT, `apps/landing/src/i18n/locales/${l}.ts`), join(ROOT, 'apps/landing/src/i18n/dict.ru.ts'), 'landing');
}
