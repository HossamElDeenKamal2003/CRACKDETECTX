const { v4: uuidv4 } = require('uuid');
const db   = require('../config/database');
const res_ = require('../utils/response');
const { scanQueue } = require('../config/queue');
const logger = require('../config/logger');

exports.createScan = async (req, res) => {
  try {
    const { building_id, project_id, notes, location } = req.body;

    if (!req.files || req.files.length === 0)
      return res_.error(res, 'At least one image is required', 400);

    const images = req.files.map(f => ({ url: f.path, public_id: f.filename, original_name: f.originalname }));

    const { rows: [scan] } = await db.query(
      `INSERT INTO scans (user_id, building_id, project_id, images, notes, location, status, processing_started_at)
       VALUES ($1,$2,$3,$4,$5,$6,'queued',NOW()) RETURNING *`,
      [req.user.id, building_id || null, project_id || null, JSON.stringify(images), notes, location ? JSON.stringify(location) : null]
    );

    // Enqueue AI job
    const job = await scanQueue.add(
      { scanId: scan.id, images, userId: req.user.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, timeout: 300000 }
    );

    await db.query('UPDATE scans SET job_id=$1 WHERE id=$2', [String(job.id), scan.id]);

    return res_.created(res, {
      scan: { ...scan, job_id: String(job.id) },
      estimatedTime: `${images.length * 3}–${images.length * 5} seconds`,
    });
  } catch (err) {
    logger.error(`createScan error: ${err.message}`);
    return res_.error(res, 'Failed to create scan');
  }
};

exports.getScans = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, building_id } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE user_id = $1';
    const params = [req.user.id];

    if (status)      { params.push(status);      where += ` AND status = $${params.length}`; }
    if (building_id) { params.push(building_id); where += ` AND building_id = $${params.length}`; }

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.query(`SELECT id, building_id, status, health_score, risk_level, total_damages, created_at FROM scans ${where} ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, limit, offset]),
      db.query(`SELECT COUNT(*) FROM scans ${where}`, params),
    ]);

    return res_.paginate(res, rows, parseInt(cnt.count), page, limit);
  } catch (err) {
    return res_.error(res, 'Failed to fetch scans');
  }
};

exports.getScan = async (req, res) => {
  try {
    const { rows: [scan] } = await db.query(
      `SELECT s.*, b.name as building_name, p.name as project_name
       FROM scans s
       LEFT JOIN buildings b ON s.building_id = b.id
       LEFT JOIN projects p ON s.project_id = p.id
       WHERE s.id = $1 AND s.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!scan) return res_.error(res, 'Scan not found', 404);

    // Get annotations
    const { rows: annotations } = await db.query('SELECT * FROM annotations WHERE scan_id=$1', [scan.id]);

    // Get report if exists
    const { rows: [report] } = await db.query('SELECT id, pdf_url, share_token, created_at FROM reports WHERE scan_id=$1', [scan.id]);

    return res_.success(res, { scan: { ...scan, annotations, report: report || null } });
  } catch (err) {
    return res_.error(res, 'Failed to fetch scan');
  }
};

exports.getScanStatus = async (req, res) => {
  try {
    const { rows: [scan] } = await db.query(
      'SELECT id, status, job_id, health_score, risk_level, total_damages, error_message FROM scans WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!scan) return res_.error(res, 'Scan not found', 404);

    let jobProgress = null;
    if (scan.job_id && !['completed','failed','cancelled'].includes(scan.status)) {
      try {
        const job = await scanQueue.getJob(scan.job_id);
        if (job) jobProgress = await job.progress();
      } catch (_) {}
    }

    return res_.success(res, { status: scan.status, progress: jobProgress, scan });
  } catch (err) {
    return res_.error(res, 'Failed to fetch status');
  }
};

exports.cancelScan = async (req, res) => {
  try {
    const { rows: [scan] } = await db.query(
      'SELECT id, job_id, status FROM scans WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!scan) return res_.error(res, 'Scan not found', 404);
    if (['completed','failed','cancelled'].includes(scan.status))
      return res_.error(res, 'Cannot cancel a finished scan', 400);

    if (scan.job_id) {
      const job = await scanQueue.getJob(scan.job_id).catch(() => null);
      if (job) await job.remove().catch(() => {});
    }
    await db.query("UPDATE scans SET status='cancelled' WHERE id=$1", [scan.id]);
    return res_.success(res, {}, 'Scan cancelled');
  } catch (err) {
    return res_.error(res, 'Failed to cancel scan');
  }
};

// ── Offline draft sync
exports.syncDraft = async (req, res) => {
  try {
    const { draft_id, building_data, images, notes, location, project_id } = req.body;

    // Create scan from draft
    const { rows: [scan] } = await db.query(
      `INSERT INTO scans (user_id, notes, location, images, status)
       VALUES ($1,$2,$3,$4,'queued') RETURNING *`,
      [req.user.id, notes, location ? JSON.stringify(location) : null, JSON.stringify(images || [])]
    );

    if (draft_id) {
      await db.query(
        "UPDATE drafts SET sync_status='synced', synced_scan_id=$1 WHERE id=$2 AND user_id=$3",
        [scan.id, draft_id, req.user.id]
      );
    }

    if (images && images.length > 0) {
      const job = await scanQueue.add({ scanId: scan.id, images, userId: req.user.id }, { attempts: 3 });
      await db.query('UPDATE scans SET job_id=$1 WHERE id=$2', [String(job.id), scan.id]);
    }

    return res_.created(res, { scan }, 'Draft synced and queued');
  } catch (err) {
    return res_.error(res, 'Failed to sync draft');
  }
};

exports.getAnnotations = async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM annotations WHERE scan_id=$1', [req.params.id]);
    return res_.success(res, { annotations: rows });
  } catch (err) {
    return res_.error(res, 'Failed to fetch annotations');
  }
};

exports.saveAnnotation = async (req, res) => {
  try {
    const { image_url, tool_type, coordinates, severity, label, color, notes } = req.body;
    const { rows: [ann] } = await db.query(
      `INSERT INTO annotations (scan_id, user_id, image_url, tool_type, coordinates, severity, label, color, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.id, req.user.id, image_url, tool_type, JSON.stringify(coordinates), severity, label, color, notes]
    );
    return res_.created(res, { annotation: ann });
  } catch (err) {
    return res_.error(res, 'Failed to save annotation');
  }
};