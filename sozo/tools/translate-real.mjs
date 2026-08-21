import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as https from 'node:https';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// Parse dart/ts dictionary
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

// Request to translate.googleapis.com
function translateChunk(text, targetLang) {
  return new Promise((resolve, reject) => {
    let googleLang = targetLang;
    if (targetLang === 'zh') googleLang = 'zh-CN';
    
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=${googleLang}&dt=t&q=${encodeURIComponent(text)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json[0].map(x => x[0]).join(''));
        } catch(e) {
          resolve("ERROR"); // Retry logic handled outside
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Helper to delay
const delay = ms => new Promise(r => setTimeout(r, ms));

async function translateDictionary(dictMap, lang) {
  const keys = Array.from(dictMap.keys());
  const translatedDict = new Map();
  
  const BATCH_SIZE = 35; // 35 strings per request
  
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batchKeys = keys.slice(i, i + BATCH_SIZE);
    
    // Protect placeholders
    const batchProtected = [];
    const placeholdersPerString = [];
    
    for (const key of batchKeys) {
      const originalValue = dictMap.get(key);
      const placeholders = [];
      let protectedValue = originalValue.replace(/\{[a-zA-Z0-9_]+\}/g, m => {
        placeholders.push(m);
        return ` M${placeholders.length - 1}M `; // e.g. M0M, M1M
      });
      batchProtected.push(protectedValue);
      placeholdersPerString.push(placeholders);
    }
    
    // Join with a unique delimiter that Google won't break
    const delimiter = '\n\n|||\n\n';
    const textToTranslate = batchProtected.join(delimiter);
    
    let result = "ERROR";
    let retries = 3;
    while (result === "ERROR" && retries > 0) {
      result = await translateChunk(textToTranslate, lang);
      if (result === "ERROR") {
        retries--;
        await delay(1000);
      }
    }
    
    if (result === "ERROR") {
      console.error(`Failed to translate batch for ${lang}. Falling back to Russian.`);
      for (const k of batchKeys) translatedDict.set(k, dictMap.get(k));
      continue;
    }
    
    // Split back
    const splitResult = result.split(/\|\|\|/g).map(s => s.trim());
    
    if (splitResult.length !== batchKeys.length) {
      console.error(`Batch size mismatch for ${lang}! Expected ${batchKeys.length}, got ${splitResult.length}. Falling back to 1-by-1 for this batch.`);
      // Fallback 1-by-1
      for (let j = 0; j < batchKeys.length; j++) {
        const k = batchKeys[j];
        const v = batchProtected[j];
        let r = await translateChunk(v, lang);
        if (r === "ERROR") r = dictMap.get(k); // fallback
        
        let restored = r;
        const ph = placeholdersPerString[j];
        for (let p = 0; p < ph.length; p++) {
          restored = restored.replace(new RegExp(`\\s*M${p}M\\s*`, 'g'), ph[p]);
        }
        translatedDict.set(k, restored);
        await delay(200);
      }
    } else {
      for (let j = 0; j < batchKeys.length; j++) {
        let restored = splitResult[j];
        const ph = placeholdersPerString[j];
        for (let p = 0; p < ph.length; p++) {
          restored = restored.replace(new RegExp(`\\s*M${p}M\\s*`, 'gi'), ph[p]);
        }
        translatedDict.set(batchKeys[j], restored);
      }
    }
    
    console.log(`[${lang}] Translated ${Math.min(i + BATCH_SIZE, keys.length)} / ${keys.length}`);
    await delay(300); // 300ms delay to speed up
  }
  
  return translatedDict;
}

async function generateApiReal(lang, name) {
  const file = join(ROOT, 'apps/api/src/common', `locale-${lang}.ts`);
  console.log(`Generating ${file}...`);
  
  const baseSrc = readFileSync(join(ROOT, 'apps/api/src/common/locale-en.ts'), 'utf8');
  const cut = baseSrc.indexOf('VALUES_EN');
  const head = cut > 0 ? baseSrc.slice(0, cut) : baseSrc;
  const tail = cut > 0 ? baseSrc.slice(cut) : '';
  
  const dict = parseDart(head);
  const vals = parseDart(tail);
  
  console.log(`Translating API strings for ${lang}...`);
  const translatedDict = await translateDictionary(dict, lang);
  console.log(`Translating API values for ${lang}...`);
  const translatedVals = await translateDictionary(vals, lang);
  
  let headOut = `/**\n * ${name} колонка серверных строк (Auto-translated).\n */\nexport const ${lang.toUpperCase()}: Record<string, string> = {\n`;
  for (const [k, v] of translatedDict) {
    headOut += `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`;
  }
  headOut += `};\n\n`;
  
  let tailOut = `export const VALUES_${lang.toUpperCase()}: Record<string, string> = {\n`;
  for (const [k, v] of translatedVals) {
    tailOut += `  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`;
  }
  tailOut += `};\n`;
  
  writeFileSync(file, headOut + tailOut);
}

async function generateLandingReal(lang, name) {
  const dir = join(ROOT, 'apps/landing/src/i18n/locales');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${lang}.ts`);
  console.log(`Generating ${file}...`);
  
  const baseSrc = readFileSync(join(ROOT, 'apps/landing/src/i18n/dict.ru.ts'), 'utf8');
  const dict = parseDart(baseSrc);
  
  console.log(`Translating Landing strings for ${lang}...`);
  const translatedDict = await translateDictionary(dict, lang);
  
  let out = `import type { Dict } from '../index';\n\n/**\n * ${name} словарь лендинга (Auto-translated).\n */\nconst dict: Dict = {\n`;
  for (const [k, v] of translatedDict) {
    let val = v.replace(/(^|[^\\])\$/g, '$1\\$'); // Escape unescaped dollars
    out += `  ${JSON.stringify(k)}: ${JSON.stringify(val)},\n`;
  }
  out += `};\n\nexport default dict;\n`;
  
  writeFileSync(file, out);
}

async function main() {
  await generateApiReal('tg', 'Таджикская');
  
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
    await generateLandingReal(lang, name);
  }
  console.log("All real translations generated successfully!");
}

main();
