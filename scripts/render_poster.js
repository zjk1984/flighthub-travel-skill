const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

(async () => {
  console.log('Launching headless Chrome...');
  const browser = await puppeteer.launch({
    executablePath: '/usr/local/bin/google-chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security'
    ]
  });

  const htmlPath = path.resolve('/workspace/reports/maps/itinerary_map.html');
  const page = await browser.newPage();

  // Set 1080x1920 standard viewport
  await page.setViewport({
    width: 1080,
    height: 1920,
    deviceScaleFactor: 1
  });

  console.log(`Navigating to file://${htmlPath}...`);
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 30000 });

  console.log('Waiting for map ready signal...');
  await page.waitForFunction('window.mapReady === true', { timeout: 15000 });

  // Additional wait for all map tiles to render smoothly
  console.log('Waiting for map tiles to settle...');
  await new Promise(r => setTimeout(r, 4000));

  const outPath1080 = '/workspace/reports/maps/xinjiang-itinerary-9-16.png';
  await page.screenshot({ path: outPath1080, fullPage: false });
  console.log(`Saved 1080x1920 poster: ${outPath1080} (${fs.statSync(outPath1080).size} bytes)`);

  // Now render HD version at scale factor 2
  await page.setViewport({
    width: 1080,
    height: 1920,
    deviceScaleFactor: 2
  });
  await new Promise(r => setTimeout(r, 2000));
  const outPathHd = '/workspace/reports/maps/xinjiang-itinerary-9-16-hd.png';
  await page.screenshot({ path: outPathHd, fullPage: false });
  console.log(`Saved 2160x3840 HD poster: ${outPathHd} (${fs.statSync(outPathHd).size} bytes)`);

  await browser.close();
  console.log('Done!');
})().catch(err => {
  console.error('Error rendering poster:', err);
  process.exit(1);
});
