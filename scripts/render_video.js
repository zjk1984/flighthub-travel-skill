const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const routeData = require('/workspace/data/route_data_sampled.json');

// Video settings
const FPS = 24;
const WIDTH = 1920;
const HEIGHT = 1080;
const OUTPUT_MP4 = '/workspace/reports/maps/xinjiang-itinerary-16-9.mp4';

// Timeline design: 45 seconds total duration
// D1: 3.5s (84 frames)   - Arrival & airport pickup
// D2: 5.0s (120 frames)  - S237 Yizhao Highway & Zhaosu Yuhu
// D3: 5.0s (120 frames)  - S237 Te-Zhao road to Kalajun
// D4: 5.0s (120 frames)  - Kalajun Grassland & Kuokesu Grand Canyon
// D5: 5.5s (132 frames)  - Kuerdening & Tangbula Gallery
// D6: 6.5s (156 frames)  - Duku North → G30 → Kalanduo (no lake entry)
// D7: 5.0s (120 frames)  - Sayram CCW loop → South gate → Guozigou sunset
// D8: 3.5s (84 frames)   - Kalanduo → Bole airport → CAN
// Final overview showcase: 6.0s (144 frames)
// Total frames: 1080 frames = 45.0 seconds exactly @ 24fps

const dayDurationsSec = [3.5, 5.0, 5.0, 5.0, 5.5, 6.5, 5.0, 3.5];
const dayFrames = dayDurationsSec.map(sec => Math.round(sec * FPS));
const finalFrames = Math.round(6.0 * FPS);

const totalFrames = dayFrames.reduce((a, b) => a + b, 0) + finalFrames;

console.log(`Planned Video: ${totalFrames} frames @ ${FPS} fps (~${(totalFrames / FPS).toFixed(1)}s)`);

(async () => {
  console.log('Launching Headless Chrome...');
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

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  const htmlUrl = 'file://' + path.resolve('/workspace/reports/maps/itinerary_video_stage.html');
  console.log('Loading page:', htmlUrl);
  await page.goto(htmlUrl, { waitUntil: 'networkidle0', timeout: 30000 });

  await page.waitForFunction('window.mapReady === true', { timeout: 15000 });
  console.log('Map ready! Waiting 3.5s for all background tiles to settle...');
  await new Promise(r => setTimeout(r, 3500));

  // Spawn ffmpeg to receive raw JPEG image stream from stdin
  console.log(`Starting ffmpeg process for output: ${OUTPUT_MP4}...`);
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-r', String(FPS),
    '-i', '-',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'fast',
    '-crf', '18',
    '-movflags', '+faststart',
    OUTPUT_MP4
  ]);

  ffmpeg.stderr.on('data', data => {
    const str = data.toString();
    if (str.includes('error') || str.includes('Error')) {
      console.error('FFmpeg stderr:', str);
    }
  });

  ffmpeg.on('close', code => {
    console.log(`FFmpeg process exited with code ${code}`);
  });

  let currentDist = 0;
  let frameCount = 0;
  const startTime = Date.now();

  // Render Day by Day
  for (let dayIdx = 0; dayIdx < routeData.segments.length; dayIdx++) {
    const seg = routeData.segments[dayIdx];
    const framesForThisDay = dayFrames[dayIdx];
    const startDist = currentDist;
    const endDist = currentDist + seg.distance_km;

    console.log(`Rendering Day ${seg.day} (${seg.title}) - ${framesForThisDay} frames...`);

    for (let f = 0; f < framesForThisDay; f++) {
      const p = (f + 1) / framesForThisDay; // progress from 0+ to 1.0
      // Smooth easing curve
      const easedP = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      const interpP = Math.max(0.01, Math.min(1.0, easedP));
      const frameDist = startDist + (endDist - startDist) * interpP;

      await page.evaluate((state) => {
        window.setVideoState(state);
      }, {
        dayIdx: dayIdx,
        progress: interpP,
        cumulativeDistKm: frameDist,
        isFinal: false
      });

      const frameBuf = await page.screenshot({ type: 'jpeg', quality: 90 });
      ffmpeg.stdin.write(frameBuf);

      frameCount++;
      if (frameCount % 48 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const fpsReal = (frameCount / elapsed).toFixed(1);
        console.log(`  -> Progress: frame ${frameCount}/${totalFrames} (${(frameCount / totalFrames * 100).toFixed(1)}%) @ ${fpsReal} fps`);
      }
    }

    currentDist = endDist;
  }

  // Render Final Showcase Hold
  console.log(`Rendering Final Overview Hold (${finalFrames} frames)...`);
  await page.evaluate((finalDist) => {
    window.setVideoState({
      dayIdx: 7,
      progress: 1.0,
      cumulativeDistKm: finalDist,
      isFinal: true
    });
  }, currentDist);

  for (let f = 0; f < finalFrames; f++) {
    const frameBuf = await page.screenshot({ type: 'jpeg', quality: 90 });
    ffmpeg.stdin.write(frameBuf);
    frameCount++;
  }

  console.log(`Finishing video rendering. Total frames written: ${frameCount}. Closing ffmpeg stdin...`);
  ffmpeg.stdin.end();

  await new Promise((resolve, reject) => {
    ffmpeg.on('close', resolve);
    ffmpeg.on('error', reject);
  });

  await browser.close();

  const stat = fs.statSync(OUTPUT_MP4);
  console.log(`SUCCESS! Video created at: ${OUTPUT_MP4} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
})().catch(err => {
  console.error('Fatal rendering error:', err);
  process.exit(1);
});
