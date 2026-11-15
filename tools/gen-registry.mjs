// Генератор src/core/registry.js из data/rcsp-opcodes.json. Запуск: node tools/gen-registry.mjs
// Реестр — данные, а не код: правки вносятся в JSON-артефакт, затем пересобирается.
import{readFileSync,writeFileSync}from'node:fs';
const root=new URL('../',import.meta.url);
const d=JSON.parse(readFileSync(new URL('data/rcsp-opcodes.json',root),'utf8'));
const head=`/* ===== core/registry — авторитетный реестр RCSP (СГЕНЕРИРОВАН) =====
 * Источник: data/rcsp-opcodes.json — Jieli-Tech/fw-AC63_BT_SDK (Apache-2.0),
 * wire-семантика: qix-ble / auracast / ebadge-python-cli (MIT).
 * Не править вручную: node tools/gen-registry.mjs
 * confidence: sdk-source > capture-verified > ported-tool > unverified. */
`;
writeFileSync(new URL('src/core/registry.js',root),head+'const RCSP_REF='+JSON.stringify(d)+';\n');
console.log('src/core/registry.js ←',d.opcodes.length,'opcodes +',d.ota_opcodes.length,'OTA');
