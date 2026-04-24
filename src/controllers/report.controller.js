const db   = require('../config/database');
const res_ = require('../utils/response');
const { createReport, generateShareToken } = require('../services/report.service');

exports.getReport = async (req, res) => {
  try {
    const { rows: [report] } = await db.query(
      `SELECT r.*, s.health_score, s.risk_level, s.total_damages, s.ai_results
       FROM reports r JOIN scans s ON r.scan_id = s.id
       WHERE r.id=$1 AND r.user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!report) return res_.error(res, 'Report not found', 404);
    return res_.success(res, { report });
  } catch (err) {
    return res_.error(res, 'Failed to fetch report');
  }
};

exports.getReportByScan = async (req, res) => {
  try {
    const { rows: [report] } = await db.query(
      'SELECT * FROM reports WHERE scan_id=$1 AND user_id=$2',
      [req.params.scanId, req.user.id]
    );
    if (!report) return res_.error(res, 'Report not found', 404);
    return res_.success(res, { report });
  } catch (err) {
    return res_.error(res, 'Failed to fetch report');
  }
};

exports.regenerateReport = async (req, res) => {
  try {
    const { rows: [scan] } = await db.query('SELECT id FROM scans WHERE id=$1 AND user_id=$2', [req.params.scanId, req.user.id]);
    if (!scan) return res_.error(res, 'Scan not found', 404);
    const report = await createReport(req.params.scanId);
    return res_.success(res, { report }, 'Report regenerated');
  } catch (err) {
    return res_.error(res, 'Failed to regenerate report');
  }
};

exports.shareReport = async (req, res) => {
  try {
    const { hours = 72 } = req.body;
    const { rows: [report] } = await db.query('SELECT id FROM reports WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    if (!report) return res_.error(res, 'Report not found', 404);
    const { token, expiresAt } = await generateShareToken(report.id, hours);
    const shareUrl = `${process.env.FRONTEND_URL}/shared/report/${token}`;
    return res_.success(res, { shareUrl, token, expiresAt });
  } catch (err) {
    return res_.error(res, 'Failed to generate share link');
  }
};

exports.viewSharedReport = async (req, res) => {
  try {
    const { token } = req.params;
    const { rows: [report] } = await db.query(
      `SELECT r.*, s.health_score, s.risk_level, s.total_damages, s.ai_results, b.name as building_name
       FROM reports r
       JOIN scans s ON r.scan_id = s.id
       LEFT JOIN buildings b ON s.building_id = b.id
       WHERE r.share_token=$1 AND r.is_shared=TRUE AND r.share_expires_at > NOW()`,
      [token]
    );
    if (!report) return res_.error(res, 'Report not found or link expired', 404);
    await db.query('UPDATE reports SET views = views + 1 WHERE id=$1', [report.id]);
    return res_.success(res, { report });
  } catch (err) {
    return res_.error(res, 'Failed to view shared report');
  }
};

exports.getUserReports = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.query(
        `SELECT r.id, r.title, r.pdf_url, r.is_shared, r.views, r.created_at, s.health_score, s.risk_level
         FROM reports r JOIN scans s ON r.scan_id = s.id
         WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset]
      ),
      db.query('SELECT COUNT(*) FROM reports WHERE user_id=$1', [req.user.id]),
    ]);
    return res_.paginate(res, rows, parseInt(cnt.count), page, limit);
  } catch (err) {
    return res_.error(res, 'Failed to fetch reports');
  }
};