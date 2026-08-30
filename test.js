const { chromium, devices } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  const courseJson = fs.readFileSync('./コース/サンプルカントリークラブ.json', 'utf8');
  page.on('dialog', async d => {
    if (d.type() === 'prompt') await d.accept(courseJson);
    else await d.accept();
  });

  await page.goto('http://127.0.0.1:8811/index.html');
  await page.waitForTimeout(400);

  // --- コース取り込み ---
  await page.click('#goCourses');
  await page.click('#cImport');
  await page.waitForTimeout(400);
  const courseCount = await page.locator('#courseList .card').count();
  console.log('取り込んだコース数:', courseCount);
  console.log('コース表示:', (await page.locator('#courseList .card').first().innerText()).replace(/\n/g, ' | '));

  // --- ラウンド開始 ---
  await page.click('#back');
  await page.click('#goNew');
  await page.waitForTimeout(200);
  console.log('コース情報:', await page.locator('#nCourseNote').innerText());
  await page.selectOption('#nTee', 'レギュラー');
  await page.fill('#nWeather', '晴れ 風強め');
  await page.click('#startRound');
  await page.waitForTimeout(300);

  // --- 18ホール入力: 全部ボギー / 2パット / FWキープ ---
  for (let i = 0; i < 18; i++) {
    const meta = await page.locator('#pMeta').innerText();
    const par = parseInt(meta.match(/Par (\d+)/)[1], 10);
    // 打数ボタン: par+1 (ボギー)
    await page.locator('#pStrokes .opt', { hasText: new RegExp('^' + (par + 1) + 'ボギー$') }).first().click();
    // パット: 通常2、1番だけ3パット
    await page.locator('#pPutts .opt').nth(i === 0 ? 3 : 2).click();
    // 念のため同じボタンをもう一度押す(トグルで消えないことの確認)
    await page.locator('#pPutts .opt').nth(i === 0 ? 3 : 2).click();
    // ティーショット (par>=4)
    if (par >= 4) await page.locator('#pFw .opt', { hasText: i === 0 ? '右' : 'キープ' }).click();
    if (i === 0) {
      await page.locator('#pOb button[data-d="1"]').click();  // 1番だけOB 1
      await page.fill('#pNote', 'ティーショット右OB');
    }
    if (i < 17) await page.click('#pNext');
    await page.waitForTimeout(60);
  }
  const running = await page.locator('#pRunning').innerText();
  console.log('進行中の累計:', running);
  await page.screenshot({ path: '/tmp/golf-shot-play.png' });

  // --- 終了 ---
  await page.click('#pFinish');
  await page.waitForTimeout(500);

  const head = await page.locator('#sHead').innerText();
  console.log('--- サマリー ---');
  console.log(head);
  const stat = await page.locator('#sStat').innerText();
  console.log(stat.replace(/\n/g, ' | '));
  await page.screenshot({ path: '/tmp/golf-shot-summary.png', fullPage: true });

  // --- 生成されるJSON/Markdownを確認 ---
  const out = await page.evaluate(() => ({ json: roundJSON(summaryRound), md: roundMarkdown(summaryRound) }));
  const st = JSON.parse(out.json).stats;
  console.log('--- 検証 ---');
  const expect = (label, got, want) => console.log((got === want ? 'OK  ' : 'NG  ') + label + ': ' + got + ' (期待 ' + want + ')');
  expect('total', st.total, 90);
  expect('vsPar', st.vsPar, 18);
  expect('putts', st.putts, 37);
  expect('パーオン', st.gir, 1);  // 1番は5打3パット=2打でオン
  expect('FWキープ', st.fwKeep, 13);
  expect('右へ', st.fwRight, 1);
  expect('3パット', st.threePutts, 1);
  expect('パーオン率', st.girPct, 6);
  expect('FW対象ホール', st.fwHoles, 14);
  expect('OB', st.ob, 1);
  expect('ボギー数', st.dist.bogey, 18);
  expect('OUT', st.out, 45);
  expect('IN', st.in, 45);
  console.log('--- Markdown 冒頭 ---');
  console.log(out.md.split('\n').slice(0, 12).join('\n'));

  // --- ホームに戻って履歴が残るか ---
  await page.click('#sHome');
  await page.waitForTimeout(300);
  console.log('履歴件数:', await page.locator('#roundList .card').count());
  console.log('履歴:', (await page.locator('#roundList .card').first().innerText()).replace(/\n/g, ' | '));

  // --- リロードして永続化されているか ---
  await page.reload();
  await page.waitForTimeout(500);
  console.log('リロード後の履歴件数:', await page.locator('#roundList .card').count());
  console.log('リロード後のコース数:', await page.evaluate(() => JSON.parse(localStorage.getItem('golf.courses')).length));

  console.log('--- エラー ---');
  console.log(errors.length ? errors.join('\n') : 'なし');
  await browser.close();
})().catch(e => { console.error('TEST FAILED:', e.message); process.exit(1); });
