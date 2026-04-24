const axios  = require('axios');
const db     = require('../config/database');
const { scanQueue, reportQueue } = require('../config/queue');
const { analyzeImage, aggregateScanResults } = require('./ai.service');
const logger  = require('../config/logger');
const { createReport } = require('./report.service');
const notificationService = require('./notification.service');

const STAGES = ['analyzing', 'detecting', 'evaluating', 'reporting'];

scanQueue.process(3, async (job) => {
  const { scanId, images } = job.data;
  logger.info(`Processing scan ${scanId} with ${images.length} image(s)`);

  try {
    // Stage 1: analyzing
    await updateScanStatus(scanId, 'analyzing');
    await job.progress(10);

    // Stage 2: detecting — process each image
    await updateScanStatus(scanId, 'detecting');
    const imageResults = [];

    for (let i = 0; i < images.length; i++) {
      const imgUrl    = images[i].url;
      const response  = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 30000 });
      const buffer    = Buffer.from(response.data);
      const result    = await analyzeImage(buffer, imgUrl);
      imageResults.push(result);
      await job.progress(10 + Math.round((i + 1) / images.length * 50));
    }

    // Stage 3: evaluating
    await updateScanStatus(scanId, 'evaluating');
    await job.progress(65);
    const aggregated = aggregateScanResults(imageResults);

    // Stage 4: reporting
    await updateScanStatus(scanId, 'reporting');
    await job.progress(80);

    // Save AI results to scan
    await db.query(
      `UPDATE scans SET
        status = 'completed',
        ai_results = $1,
        health_score = $2,
        risk_level = $3,
        total_damages = $4,
        processing_ended_at = NOW()
      WHERE id = $5`,
      [
        JSON.stringify(aggregated),
        aggregated.health_score,
        aggregated.risk_level,
        aggregated.total_damages,
        scanId,
      ]
    );

    // Save annotations
    for (const detection of aggregated.detections) {
      const scan = await db.query('SELECT user_id FROM scans WHERE id = $1', [scanId]);
      await db.query(
        `INSERT INTO annotations (scan_id, user_id, image_url, tool_type, coordinates, severity, label, is_ai)
         VALUES ($1, $2, $3, 'bounding_box', $4, $5, $6, TRUE)`,
        [
          scanId,
          scan.rows[0].user_id,
          detection.image_url,
          JSON.stringify(detection.bbox),
          ['low','medium'].indexOf(detection.severity) >= 0 ? (detection.severity === 'low' ? 1 : 3) : (detection.severity === 'high' ? 4 : 5),
          detection.class_name,
        ]
      );
    }

    // Auto-generate report
    const reportJob = await reportQueue.add({ scanId }, { attempts: 3 });

    await job.progress(100);

    // Notify user
    const { rows } = await db.query('SELECT user_id FROM scans WHERE id = $1', [scanId]);
    if (rows[0]) {
      await notificationService.createNotification({
        userId: rows[0].user_id,
        type: 'scan_complete',
        title: 'Scan Analysis Complete',
        body: `Your scan has been analyzed. Health score: ${aggregated.health_score}%`,
        data: { scanId },
      });
    }

    logger.info(`Scan ${scanId} completed successfully`);
    return { success: true, scanId };

  } catch (err) {
    logger.error(`Scan ${scanId} failed: ${err.message}`);
    await db.query(
      "UPDATE scans SET status = 'failed', error_message = $1 WHERE id = $2",
      [err.message, scanId]
    );
    throw err;
  }
});

const updateScanStatus = (scanId, status) =>
  db.query('UPDATE scans SET status = $1 WHERE id = $2', [status, scanId]);

// Report generation worker
reportQueue.process(2, async (job) => {
  const { scanId } = job.data;
  try {
    await createReport(scanId);
    logger.info(`Report generated for scan ${scanId}`);
  } catch (err) {
    logger.error(`Report generation failed for ${scanId}: ${err.message}`);
    throw err;
  }
});

module.exports = { scanQueue };