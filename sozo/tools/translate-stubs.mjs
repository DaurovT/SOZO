import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// Helper to extract dictionary from a file
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

// Pseudo-localize string: add language prefix, keep placeholders intact
function pseudoLocalize(str, lang) {
  let inPlaceholder = false;
  let res = "";
  let currentText = "";
  
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '{') {
      if (currentText.length > 0) res += `[${lang.toUpperCase()}] ${currentText}`;
      currentText = "";
      inPlaceholder = true;
      res += str[i];
    } else if (str[i] === '}') {
      inPlaceholder = false;
      res += str[i];
    } else {
      if (inPlaceholder) {
        res += str[i];
      } else {
        currentText += str[i];
      }
    }
  }
  if (currentText.length > 0) {
    res += `[${lang.toUpperCase()}] ${currentText}`;
  }
  
  // Clean up excessive prefixes
  return res.replace(new RegExp(`\\[${lang.toUpperCase()}\\] \\s*`, 'g'), `[${lang.toUpperCase()}] `).trim();
}

function generateApiStub(lang, name) {
  const file = join(ROOT, 'apps/api/src/common', `locale-${lang}.ts`);
  console.log(`Generating ${file}...`);
  
  const baseSrc = readFileSync(join(ROOT, 'apps/api/src/common/locale-en.ts'), 'utf8');
  const cut = baseSrc.indexOf('VALUES_EN');
  const head = cut > 0 ? baseSrc.slice(0, cut) : baseSrc;
  const tail = cut > 0 ? baseSrc.slice(cut) : '';
  
  const dict = parseDart(head);
  const vals = parseDart(tail);
  
  let headOut = `/**\n * ${name} колонка серверных строк (Pseudo-localized).\n */\nexport const ${lang.toUpperCase()}: Record<string, string> = {\n`;
  for (const [k, v] of dict) {
    headOut += `  ${JSON.stringify(k)}: ${JSON.stringify(pseudoLocalize(k, lang))},\n`;
  }
  headOut += `};\n\n`;
  
  let tailOut = `export const VALUES_${lang.toUpperCase()}: Record<string, string> = {\n`;
  for (const [k, v] of vals) {
    tailOut += `  ${JSON.stringify(k)}: ${JSON.stringify(pseudoLocalize(k, lang))},\n`;
  }
  tailOut += `};\n`;
  
  writeFileSync(file, headOut + tailOut);
}

function generateLandingStub(lang, name) {
  const dir = join(ROOT, 'apps/landing/src/i18n/locales');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${lang}.ts`);
  console.log(`Generating ${file}...`);
  
  const baseSrc = readFileSync(join(ROOT, 'apps/landing/src/i18n/dict.ru.ts'), 'utf8');
  const dict = parseDart(baseSrc);
  
  let out = `import type { Dict } from '../index';\n\n/**\n * ${name} словарь лендинга (Pseudo-localized).\n */\nconst dict: Dict = {\n`;
  for (const [k, v] of dict) {
    // Escape unescaped dollars for TS
    let val = pseudoLocalize(v, lang);
    val = val.replace(/(^|[^\\])\$/g, '$1\\$');
    out += `  ${JSON.stringify(k)}: ${JSON.stringify(val)},\n`;
  }
  out += `};\n\nexport default dict;\n`;
  
  writeFileSync(file, out);
}

// Generate API TG
generateApiStub('tg', 'Таджикская');

// Generate Landing missing
const landingLangs = {
  'ar': 'Арабский',
  'de': 'Немецкий',
  'fr': 'Французский',
  'ko': 'Корейский',
  'tg': 'Таджикский',
  'tr': 'Турецкий',
  'uz': 'Узбекский',
  'zh': 'Китайский'
};

for (const [lang, name] of Object.entries(landingLangs)) {
  generateLandingStub(lang, name);
}

console.log("Stubs generated successfully.");
