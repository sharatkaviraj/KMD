import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

const routes = ['login', '(app)/teach', '(app)/teach/attendance', '(app)/dashboard', '(app)/students', '(app)/fees/payments', '(app)/fees/transactions', '(app)/preferences'];
const measurements = {};
for (const route of routes) {
  const file = path.join('.next/server/app', route, 'page_client-reference-manifest.js');
  const context = {};
  vm.runInNewContext(readFileSync(file, 'utf8'), context);
  const manifest = Object.values(context.__RSC_MANIFEST)[0];
  const files = [...new Set(Object.values(manifest.clientModules).flatMap((module) => module.chunks))].filter((file) => typeof file === 'string' && file.endsWith('.js'));
  measurements['/' + route.replace('(app)/', '')] = {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + statSync(path.join('.next', file)).size, 0),
    gzipBytes: files.reduce((sum, file) => sum + gzipSync(readFileSync(path.join('.next', file))).length, 0),
  };
}
const report = { measuredAt: new Date().toISOString(), method: 'Unique route-referenced production client chunks; excludes RSC/HTML payloads. Bundle regression proxy, not browser transfer or latency.', routes: measurements };
const output = process.argv.indexOf('--write');
if (output !== -1) writeFileSync(process.argv[output + 1], JSON.stringify(report, null, 2) + '\n');
console.table(Object.entries(measurements).map(([route, data]) => ({ route, files: data.files, gzipKB: +(data.gzipBytes / 1024).toFixed(1) })));
const baselineFlag = process.argv.indexOf('--baseline');
if (baselineFlag !== -1) {
  const baseline = JSON.parse(readFileSync(process.argv[baselineFlag + 1], 'utf8'));
  for (const [route, data] of Object.entries(measurements)) {
    if (data.gzipBytes > baseline.routes[route].gzipBytes * 1.1) throw new Error(`${route}: eager JS grew more than 10%`);
  }
}
