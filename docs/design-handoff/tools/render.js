// Static preview renderer for the VPPS One .dc.html design frames (npm i htmlparser2).
// node render.js <built file> <out.html> [start] [dark] [clickPath ...]
// clickPath: dotted path into renderVals() result of a function to call before rendering (e.g. tabs.2.pick)
const fs = require('fs');
const path = require('path');
const { parseDocument } = require('htmlparser2');
const PROJ = path.resolve(__dirname, '../design/project');

class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(u) { const n = typeof u === 'function' ? u(this.state) : u; this.state = Object.assign({}, this.state, n); } forceUpdate() {} }
global.navigator = { vibrate: () => true, clipboard: { writeText: () => Promise.resolve() } };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const LIT = /^(true|false|null|-?\d+(\.\d+)?|'[^']*'|"[^"]*")$/;
function lookup(scope, p) { p = p.trim(); if (LIT.test(p)) return JSON.parse(p.replace(/'/g, '"')); let v = scope; for (const k of p.split('.')) { if (v == null) return undefined; v = v[k]; } return v; }
const fill = (str, scope) => str.replace(/\{\{([\s\S]+?)\}\}/g, (_, p) => { const v = lookup(scope, p); return v == null ? '' : String(v); });
const heads = [];
function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const script = src.split(/<script type="text\/x-dc" data-dc-script[^>]*>/)[1].split('</script>')[0];
  const C = new Function('DCLogic', 'StreamableLogic', 'React', script + '\nreturn Component;')(DCLogic, DCLogic, {});
  const body = src.split('<x-dc>')[1].split('</x-dc>')[0];
  return { C, doc: parseDocument(body, { lowerCaseAttributeNames: false, recognizeSelfClosing: true }) };
}
function out(node, scope) {
  if (node.type === 'text') return fill(node.data, scope).replace(/</g, '&lt;');
  if (node.type === 'comment' || node.type === 'directive') return '';
  if (!node.name) return (node.children || []).map((c) => out(c, scope)).join('');
  const tag = node.name; const a = node.attribs || {};
  if (tag === 'helmet') { heads.push((node.children || []).map((c) => out(c, scope)).join('')); return ''; }
  if (tag === 'style') return '<style>' + node.children.map((c) => c.data).join('') + '</style>';
  if (tag === 'sc-for') { const list = lookup(scope, (a.list || '').replace(/[{}]/g, '')) || []; return list.map((it, i) => (node.children || []).map((c) => out(c, Object.assign({}, scope, { [a.as || 'item']: it, $index: i }))).join('')).join(''); }
  if (tag === 'sc-if') { const v = lookup(scope, (a.value || '').replace(/[{}]/g, '')); return v ? (node.children || []).map((c) => out(c, scope)).join('') : ''; }
  if (tag === 'dc-import') {
    const props = {}; for (const [k, v] of Object.entries(a)) { if (k === 'name' || k.startsWith('hint-')) continue; const m = v.match(/^\{\{([\s\S]+)\}\}$/); props[k] = m ? lookup(scope, m[1]) : v; }
    const f = path.join(PROJ, a.name + '.dc.html'); if (!fs.existsSync(f)) return '<div>[' + a.name + ']</div>';
    const sub = load(f); const inst = new sub.C(props); const vals = inst.renderVals();
    return sub.doc.children.map((c) => out(c, vals)).join('');
  }
  let s = '<' + tag;
  for (const [k, v] of Object.entries(a)) { if (/^on[A-Z]/.test(k) || k.startsWith('hint-')) continue; s += ' ' + k + '="' + esc(fill(v, scope)) + '"'; }
  const voids = ['input', 'img', 'br', 'hr', 'meta', 'link', 'path', 'circle', 'polyline', 'rect', 'line'];
  if (voids.includes(tag) && !(node.children || []).length) return s + (['path', 'circle', 'polyline', 'rect', 'line'].includes(tag) ? '/>' : '>');
  s += '>' + (tag === 'textarea' ? esc(fill(a.value || '', scope)) : '') + (node.children || []).map((c) => out(c, scope)).join('') + '</' + tag + '>';
  return s;
}
const [file, dest, start, dark, ...clicks] = process.argv.slice(2);
const m = load(file);
const inst = new m.C(Object.assign(start && start !== '-' ? { start } : {}, dark === 'dark' ? { dark: true } : {}));
for (const c of clicks) { const v = inst.renderVals(); let fn = v; for (const k of c.split('.')) fn = fn == null ? undefined : fn[k]; if (typeof fn !== 'function') { console.error('no fn', c); continue; } fn({ target: { value: '12', checked: true, files: [] }, preventDefault() {}, stopPropagation() {} }); }
const vals = inst.renderVals();
const html = m.doc.children.map((c) => out(c, vals)).join('');
fs.writeFileSync(dest, '<!doctype html><html><head><meta charset="utf-8">' + heads.join('') + '</head><body>' + html + '</body></html>');
setTimeout(() => process.exit(0), 10);
