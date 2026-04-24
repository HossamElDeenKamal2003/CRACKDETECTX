const db   = require('../config/database');
const res_ = require('../utils/response');

// Save draft locally (client sends data when back online or preemptively)
exports.saveDraft = async (req, res) => {
  try {
    const { id, building_data, images, notes, location, project_id } = req.body;

    if (id) {
      // Update existing
      const { rows: [draft] } = await db.query(
        `UPDATE drafts SET building_data=$1, images=$2, notes=$3, location=$4, project_id=$5, sync_status='pending'
         WHERE id=$6 AND user_id=$7 RETURNING *`,
        [JSON.stringify(building_data), JSON.stringify(images || []), notes, JSON.stringify(location), project_id, id, req.user.id]
      );
      if (!draft) return res_.error(res, 'Draft not found', 404);
      return res_.success(res, { draft }, 'Draft updated');
    }

    const { rows: [draft] } = await db.query(
      `INSERT INTO drafts (user_id, building_data, images, notes, location, project_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, JSON.stringify(building_data || {}), JSON.stringify(images || []), notes, JSON.stringify(location), project_id]
    );
    return res_.created(res, { draft });
  } catch (err) {
    return res_.error(res, 'Failed to save draft');
  }
};

exports.getDrafts = async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM drafts WHERE user_id=$1 AND sync_status != 'synced' ORDER BY created_at DESC",
      [req.user.id]
    );
    return res_.success(res, { drafts: rows });
  } catch (err) {
    return res_.error(res, 'Failed to fetch drafts');
  }
};

exports.deleteDraft = async (req, res) => {
  try {
    await db.query('DELETE FROM drafts WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    return res_.success(res, {}, 'Draft deleted');
  } catch (err) {
    return res_.error(res, 'Failed to delete draft');
  }
};

exports.syncPendingDrafts = async (req, res) => {
  try {
    const { rows: pending } = await db.query(
      "SELECT * FROM drafts WHERE user_id=$1 AND sync_status='pending'",
      [req.user.id]
    );
    return res_.success(res, { pending_count: pending.length, drafts: pending });
  } catch (err) {
    return res_.error(res, 'Failed to fetch pending drafts');
  }
};