/* BulkIG headless smoke test */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getJson, postJson, uploadFile, redactToken, ensureDir, exists, writeFileSafe, removeIfExists, shortSnippet, nowIso, measure, makeTestPng, makeTestMp4 } from './test-utils';

interface Args { base: string; quick: boolean; }

function parseArgs(): Args {
  const a: any = { base: 'http://localhost:4010', quick: false };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--quick') a.quick = true;
    else if (v === '--base') a.base = process.argv[++i];
  }
  return a as Args;
}

const REPORT_DIR = path.resolve('reports/smoke');
ensureDir(REPORT_DIR);

function redactEnv(env: Record<string,string>) {
  const out: Record<string,string> = {};
  for (const k of Object.keys(env)) {
    const v = env[k] ?? '';
    out[k] = k.includes('TOKEN') ? redactToken(v) : v;
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const base = args.base.replace(/\/$/, '');
  const results: any[] = [];
  const startedAt = Date.now();

  function record(name: string, ok: boolean, res: any) {
    results.push({ name, ok, ...res });
  }

  // Load and parse .env
  const envPath = path.resolve('.env');
  const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const envVars: Record<string,string> = {};
  envText.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) envVars[m[1]] = m[2].replace(/^"|"$/g, '');
  });

  // Environment & Config checks
  const { res: healthRes, json: healthJson } = await getJson(`${base}/health`, { timeoutMs: 5000, retries: 5 });
  record('env.health', healthRes.status === 200 && healthJson?.status === 'ok', {
    method: 'GET', endpoint: '/health', status: healthRes.status, timeMs: healthRes.timeMs, snippet: shortSnippet(healthRes.text)
  });

  const requiredEnv = ['IG_MOCK','IG_USER_ID','FB_LONG_LIVED_PAGE_TOKEN','INBOX_PATH','IG_POSTER_PORT','STATIC_SERVER_PORT'];
  const missing = requiredEnv.filter(k => !(k in envVars));
  record('env.vars', missing.length === 0, { required: requiredEnv, missing, shown: redactEnv(envVars) });

  // Inbox existence and writability
  const inbox = envVars['INBOX_PATH'] || 'C:/IG/inbox';
  const dirExists = exists(inbox);
  let writeOk = false;
  try { writeFileSafe(path.join(inbox, 'smoke-write.tmp'), 'ok'); writeOk = true; removeIfExists(path.join(inbox, 'smoke-write.tmp')); } catch {}
  record('env.inbox', dirExists && writeOk, { inbox, dirExists, writeOk });

  // Ports
  const { res: stRes } = await getJson(`${base}/ig/status`, { timeoutMs: 5000, retries: 3 });
  record('server.status', stRes.status === 200, { method: 'GET', endpoint: '/ig/status', status: stRes.status, timeMs: stRes.timeMs, snippet: shortSnippet(stRes.text) });

  // Static server on 5005 is optional; attempt and note
  let staticOk = false; let staticStatus = 0; let staticSnippet = '';
  try {
    const { res } = await getJson(`http://localhost:${envVars['STATIC_SERVER_PORT']||'5005'}/`, { timeoutMs: 1500, retries: 1 });
    staticOk = res.status >= 200 && res.status < 500; staticStatus = res.status; staticSnippet = shortSnippet(res.text);
  } catch (e:any) { staticOk = false; }
  record('server.static5005', staticOk, { method: 'GET', endpoint: 'http://localhost:5005/', status: staticStatus, snippet: staticSnippet });

  // Media index
  const { res: mediaIdx } = await getJson(`${base}/media/`, { timeoutMs: 5000, retries: 3 });
  record('server.mediaIndex', mediaIdx.status === 200, { method: 'GET', endpoint: '/media/', status: mediaIdx.status, timeMs: mediaIdx.timeMs, snippet: shortSnippet(mediaIdx.text) });

  // Upload files
  const imgName = `smoke-image-${Date.now()}.png`;
  const vidName = `smoke-video-${Date.now()}.mp4`;
  const { res: upImgRes, json: upImgJson } = await uploadFile(base, imgName, makeTestPng());
  record('upload.image', upImgRes.status === 200 && upImgJson?.success, { method: 'POST', endpoint: '/ig/upload', status: upImgRes.status, timeMs: upImgRes.timeMs, snippet: shortSnippet(upImgRes.text) });
  const { res: upVidRes, json: upVidJson } = await uploadFile(base, vidName, makeTestMp4());
  record('upload.video', upVidRes.status === 200 && upVidJson?.success, { method: 'POST', endpoint: '/ig/upload', status: upVidRes.status, timeMs: upVidRes.timeMs, snippet: shortSnippet(upVidRes.text) });

  // Confirm files exist
  const imgPath = path.join(inbox, imgName); const vidPath = path.join(inbox, vidName);
  record('files.saved', exists(imgPath) && exists(vidPath), { imgPath, vidPath });

  // Watcher detection & QUEUED
  await new Promise(r => setTimeout(r, 800));
  const { json: statusAfterUpload, res: statusRes2 } = await getJson(`${base}/ig/status?t=${Date.now()}`, { timeoutMs: 5000, retries: 3 });
  const queuedNames = (statusAfterUpload?.posts||[]).filter((p:any)=> p.status==='QUEUED').map((p:any)=> p.filename);
  record('queue.detected', queuedNames.includes(imgName) || queuedNames.includes(vidName), { method: 'GET', endpoint: '/ig/status', status: statusRes2.status, queued: queuedNames.slice(0,10) });

  // Scheduler config round-trip
  const { json: cfgJson } = await getJson(`${base}/ig/schedule-config`);
  record('sched.config.get', !!cfgJson, { endpoint: '/ig/schedule-config', cfg: cfgJson });

  const targetCfg = { mode: 'times', days: [1,2,3,4,5], times: ['09:00','13:00','17:00'], intervalHours: 4 };
  const { res: cfgPostRes } = await postJson(`${base}/ig/schedule-config`, targetCfg);
  record('sched.config.set', cfgPostRes.status === 200, { method: 'POST', endpoint: '/ig/schedule-config', status: cfgPostRes.status });

  const { json: previewJson } = await getJson(`${base}/ig/schedule-preview?count=10`);
  record('sched.preview', Array.isArray(previewJson) && previewJson.length>0, { endpoint: '/ig/schedule-preview', next: previewJson?.slice?.(0,3) });

  // Plan
  const { res: planRes } = await postJson(`${base}/ig/plan`, {});
  record('sched.plan', planRes.status === 200, { method: 'POST', endpoint: '/ig/plan', status: planRes.status, snippet: shortSnippet(planRes.text) });

  const { json: statusAfterPlan } = await getJson(`${base}/ig/status?t=${Date.now()}`);
  const scheduled = (statusAfterPlan?.posts||[]).filter((p:any)=> p.status==='SCHEDULED');
  record('sched.scheduled', scheduled.length >= 1, { scheduledCount: scheduled.length, next: statusAfterPlan?.next });

  // Mock publishing: autorun ON and post-now one item
  const { res: autorunRes } = await postJson(`${base}/ig/autorun`, { enabled: true });
  record('pub.autorun', autorunRes.status === 200, { method: 'POST', endpoint: '/ig/autorun', status: autorunRes.status });

  const target = scheduled[0] || (statusAfterPlan?.posts||[]).find((p:any)=> p.status==='SCHEDULED');
  if (target) {
    const { res: postNowRes } = await postJson(`${base}/ig/post-now`, { id: target.id, filename: target.filename });
    record('pub.postNow.request', postNowRes.status === 200, { method: 'POST', endpoint: '/ig/post-now', status: postNowRes.status });

    // Poll logs and status for completion
    let publishedOk = false;
    for (let i=0;i<15;i++) {
      await new Promise(r => setTimeout(r, 600));
      const { json: s } = await getJson(`${base}/ig/status?t=${Date.now()}`);
      const p = (s?.posts||[]).find((x:any)=> x.id===target.id);
      if (p && p.status==='PUBLISHED') { publishedOk = true; break; }
    }
    record('pub.postNow.result', publishedOk, { id: target.id, filename: target.filename });
  } else {
    record('pub.postNow.result', false, { reason: 'No SCHEDULED item found' });
  }

  // API health set
  const apiList = [
    { m:'GET', u:'/ig/status' },
    { m:'GET', u:'/ig/logs' },
    { m:'POST', u:'/ig/logs/clear' },
    { m:'GET', u:'/media/' },
    { m:'GET', u:'/ig/history?limit=10' },
  ];
  for (const a of apiList) {
    const { res } = a.m==='GET' ? await getJson(`${base}${a.u}`) : await postJson(`${base}${a.u}`, {});
    record(`api.${a.m}.${a.u}`, res.status===200 || (a.u==='/media/' && res.status===200), { method:a.m, endpoint:a.u, status:res.status, snippet: shortSnippet(res.text) });
  }

  // Dashboard root
  const { res: rootRes } = await getJson(`${base}/`);
  record('ui.index', rootRes.status===200 && /BulkIG Dashboard/i.test(rootRes.text), { method:'GET', endpoint:'/', status:rootRes.status, snippet: shortSnippet(rootRes.text) });

  // Write reports
  const endedAt = Date.now();
  const durationSec = Math.round((endedAt-startedAt)/1000);
  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationSec,
    base,
    results,
  };

  const jsonOut = path.join(REPORT_DIR, 'latest.json');
  fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2));

  // Markdown report
  const passCount = results.filter(r=>r.ok).length;
  const failCount = results.filter(r=>r.ok===false).length;
  const md = [
    `# BulkIG System Smoke Test Report`,
    `Generated: ${nowIso()}`,
    `Test Duration: ${durationSec} seconds`,
    '',
    `## Summary`,
    `Base: ${base}`,
    `Pass: ${passCount}  Fail: ${failCount}`,
    '',
    `## Detailed Checks`,
    ...results.map(r=>{
      return [
        `### ${r.name} — ${r.ok ? 'PASS' : 'FAIL'}`,
        `- Endpoint: ${r.endpoint||''} (${r.method||''})`,
        `- Status: ${r.status||''}  Time: ${r.timeMs||''}ms`,
        r.snippet? `- Snippet: \
\`${mdEscape(r.snippet)}\`` : '',
        r.missing? `- Missing: ${JSON.stringify(r.missing)}` : '',
        r.note? `- Note: ${r.note}` : '',
        ''
      ].filter(Boolean).join('\n');
    })
  ].join('\n');

  const mdPath = path.join(REPORT_DIR, `${new Date().toISOString().replace(/[:.]/g,'-')}-bulkig-smoke.md`);
  fs.writeFileSync(mdPath, md, 'utf8');

  // Cleanup test files
  removeIfExists(imgPath); removeIfExists(vidPath);

  // Console summary
  console.log(`Smoke test complete. Pass=${passCount} Fail=${failCount}`);
  console.log(`Report: ${mdPath}`);
  console.log(`JSON:   ${jsonOut}`);

  // exit code
  process.exit(failCount>0 ? 1 : 0);
}

function mdEscape(s: string){ return s.replace(/`/g,'\\`'); }

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});