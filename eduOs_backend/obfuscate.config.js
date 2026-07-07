import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import JavaScriptObfuscator from 'javascript-obfuscator';

const SOURCE_FILE = 'dist/app.js';
const OUTPUT_DIR = 'dist-obfuscated';
const OUTPUT_FILE = `${OUTPUT_DIR}/app.js`;

if (!existsSync(SOURCE_FILE)) {
  console.error(`✘  ${SOURCE_FILE} not found. Run "npm run build" first.`);
  process.exit(1);
}

const source = readFileSync(SOURCE_FILE, 'utf-8');

const obfuscated = JavaScriptObfuscator.obfuscate(source, {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: true,
  renameGlobals: false,
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
});

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(OUTPUT_FILE, obfuscated.getObfuscatedCode());

console.log(`Obfuscation complete → ${OUTPUT_FILE}`);
console.log(`Plain build kept at  → ${SOURCE_FILE}`);
