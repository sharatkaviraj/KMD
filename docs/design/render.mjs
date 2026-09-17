/** Render only this static design artifact. Does not load app env, sessions or databases. */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};
const server = createServer(async (req,res)=>{
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname==='/'?'/index.html':pathname}`);
    if (!file.startsWith(root)) {res.writeHead(403).end();return;}
    const data = await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(data);
  } catch {res.writeHead(404).end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const evidence={generatedAt:new Date().toISOString(),scope:'Static design artifact only; no live application or backend tested',sourceHashes:{},screens:[],interactions:[],consoleErrors:[],requestFailures:[]};
try {
  for(const name of ['index.html','tokens.css','prototype.css','prototype.js'])evidence.sourceHashes[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex');
  await mkdir(path.join(root,'screenshots'),{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',error=>evidence.consoleErrors.push(error.message));
  page.on('requestfailed',r=>evidence.requestFailures.push({url:r.url(),error:r.failure()?.errorText}));
  await page.goto(`${origin}/index.html?screen=components`);
  const screens=await page.evaluate(()=>catalog.map(([id,title,description,role])=>({id,title,description,role})));
  for(const s of screens){
    const results=[];
    for(const width of [360,390,768,1024,1440]){
      await page.setViewportSize({width,height:width<761?844:1000});
      await page.goto(`${origin}/index.html?screen=${s.id}&role=${s.role}`);
      await page.evaluate(()=>document.fonts.ready);
      const layout=await page.evaluate(()=>({
        viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,
        h1:document.querySelector('h1')?.textContent,
        overflow:[...document.querySelectorAll('body *')].filter(el=>{
          const r=el.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&!el.closest('.table-wrap')&&getComputedStyle(el).position!=='fixed';
        }).map(e=>`${e.tagName}.${e.className}`).slice(0,12)
      }));
      results.push({width,...layout});
      if(width===1440||width===390){
        const device=width===390?'mobile':'desktop';
        await page.screenshot({path:path.join(root,'screenshots',`${s.id}-${device}.png`),fullPage:true,style:'body{position:relative}.sidebar{position:absolute}.bottom-nav{position:absolute;bottom:0}'});
        if(['accountant','teacher','admin'].includes(s.id))await page.screenshot({path:path.join(root,'screenshots',`${s.id}-${device}-first.png`)});
      }
    }
    evidence.screens.push({...s,layouts:results});
    console.log(`Rendered ${s.id}`);
  }
  const check=(name,ok)=>{evidence.interactions.push({name,passed:!!ok});if(!ok)throw new Error(name)};
  await page.setViewportSize({width:390,height:844});
  await page.goto(`${origin}/index.html?screen=attendance`);
  await page.locator('[data-attendance]').first().getByRole('button',{name:'Absent',exact:true}).click();
  await page.getByRole('button',{name:'Save attendance',exact:true}).click();
  check('Attendance counts reconcile after change and save',(await page.locator('#save-state').textContent()).includes('3 present · 1 absent'));
  await page.getByRole('button',{name:'Mark all present',exact:true}).click();
  check('All present resets the previous absence',await page.locator('.att[data-value=P][aria-pressed=true]').count()===4);
  await page.goto(`${origin}/index.html?screen=students`);
  await page.locator('#student-search').fill('02402');
  check('Directory finds SR number with leading zero',await page.locator('.mobile-card:visible').count()===1);
  await page.locator('#student-search').fill('zzzz');
  check('No-match state appears',await page.locator('#no-matches').isVisible());
  await page.goto(`${origin}/index.html?screen=payments`);
  await page.locator('#amount').fill('-50');
  check('Negative payment invalid',await page.locator('#amount').evaluate(el=>!el.checkValidity()));
  await page.locator('#amount').fill('3500');
  await page.getByRole('button',{name:'Review payment',exact:true}).click();
  check('Payment review reflects edited amount',(await page.locator('#dialog').textContent()).includes('3,500'));
  await page.keyboard.press('Escape');
  check('Dialog closes with Escape',!await page.locator('#dialog').isVisible());
  await page.goto(`${origin}/index.html?screen=marks`);
  await page.locator('.mark-input').first().fill('21');
  check('Marks above maximum invalid',await page.locator('.mark-input').first().evaluate(el=>!el.checkValidity()));
  await page.locator('.mark-input').first().fill('18');
  await page.locator('.absent-check').nth(2).check();
  check('Absent disables score',await page.locator('.mark-input').nth(2).isDisabled());
  await page.getByRole('button',{name:'Save marks',exact:true}).click();
  check('Zero marks remain distinct from absent and blank',(await page.locator('#marks-state').textContent()).includes('3 scored · 1 absent · 0 remaining'));
  await page.goto(`${origin}/index.html?screen=review`);
  await page.getByRole('button',{name:'Reject correction',exact:true}).click();
  check('Review rejection requires reason',(await page.locator('#dialog-title').textContent())==='Add a reason');
  await page.keyboard.press('Escape');
  await page.locator('#review-note').fill('Please reconfirm with the guardian.');
  await page.getByRole('button',{name:'Reject correction',exact:true}).click();
  check('Decision state blocks repeat action',await page.getByRole('button',{name:'Reject correction',exact:true}).isDisabled());
  await page.goto(`${origin}/index.html?screen=sampark`);
  await page.locator('input[value=class]').check();
  check('Audience count follows selection',(await page.locator('#audience-count').textContent())==='32 children');
  await page.goto(`${origin}/index.html?screen=request-link`);
  await page.getByRole('button',{name:'This is correct',exact:true}).click();
  check('Token request confirms without account shell',(await page.locator('#request-status').textContent()).includes('6 of 8')&&await page.locator('.sidebar').count()===0);
  await page.goto(`${origin}/index.html?screen=teacher-hi`);
  check('Hindi page declares correct language',await page.locator('html').getAttribute('lang')==='hi');
  await page.goto(`${origin}/index.html?screen=viewer`);
  check('Viewer shows summary without named children or fee actions',await page.getByText('Aarav Sharma',{exact:true}).count()===0&&await page.getByText('Receive payment',{exact:true}).count()===0);
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${origin}/index.html`);
  check('Gallery links all screens',await page.locator('.atlas-card').count()===screens.length);
  await page.screenshot({path:path.join(root,'screenshots','atlas.png'),fullPage:true});
  await writeFile(path.join(root,'screens.json'),JSON.stringify(screens,null,2)+'\n');
  const overview=`<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f8f7f3;color:#161c29;font:16px system-ui;padding:52px}h1{font-size:46px;letter-spacing:-1px;margin:8px 0 14px;font-weight:650}p{color:#656a70;margin:0 0 35px}.eyebrow{font-size:12px;letter-spacing:2px;color:#bd4b0f}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:26px}h2{font-size:22px;margin:0 0 4px}.col>p{font-size:13px;margin-bottom:20px}.desk{width:100%;border:1px solid #dad8d0;border-radius:10px;box-shadow:0 12px 28px #00000008}.phone{width:68%;display:block;margin:28px auto 0;border:7px solid #171c27;border-radius:28px;box-shadow:0 12px 30px #00000015}.foot{margin-top:32px;font-size:12px;color:#656a70}</style></head><body><div class="eyebrow">VPPS ONE · LEDGER CALM 2</div><h1>A familiar workspace for every role.</h1><p>Desktop for the whole picture. Mobile for the next useful action.</p><div class="grid">${[['accountant','Accounts','School Fees opens first.'],['teacher','Teacher','Their class and today’s work.'],['admin','Administrator','One combined school overview.']].map(([id,h,p])=>`<div class="col"><h2>${h}</h2><p>${p}</p><img class="desk" src="screenshots/${id}-desktop-first.png"><img class="phone" src="screenshots/${id}-mobile-first.png"></div>`).join('')}</div><div class="foot">Interactive HTML atlas · ${screens.length} responsive views · Illustrative data · September 2026</div></body></html>`;
  await writeFile(path.join(root,'overview.html'),overview);
  await page.setViewportSize({width:1600,height:1000});
  await page.goto(`${origin}/overview.html`);
  await page.screenshot({path:path.join(root,'screenshots','overview.png'),fullPage:true});
  evidence.passed=evidence.consoleErrors.length===0&&evidence.screens.every(s=>s.layouts.every(l=>l.scrollWidth<=l.width&&l.overflow.length===0))&&evidence.interactions.every(x=>x.passed);
} finally {
  await writeFile(path.join(root,'validation.json'),JSON.stringify(evidence,null,2)+'\n');
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({passed:evidence.passed,screens:evidence.screens.length,interactions:evidence.interactions.length,overflow:evidence.screens.flatMap(s=>s.layouts.filter(l=>l.scrollWidth>l.width||l.overflow.length).map(l=>({screen:s.id,...l}))),consoleErrors:evidence.consoleErrors},null,2));
if(!evidence.passed)process.exitCode=1;
