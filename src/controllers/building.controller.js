const db  = require('../config/database');
const res_ = require('../utils/response');
const { deleteImage } = require('../config/cloudinary');

exports.createBuilding = async (req, res) => {
  try {
    const { name, address, city, country, latitude, longitude, building_type, year_built, floors, area_sqm, notes, tags } = req.body;

    const images = req.files
      ? req.files.map(f => ({ url: f.path, public_id: f.filename }))
      : [];

    const { rows: [building] } = await db.query(
      `INSERT INTO buildings (owner_id, name, address, city, country, latitude, longitude, building_type, year_built, floors, area_sqm, notes, tags, images)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [req.user.id, name, address, city, country, latitude, longitude, building_type, year_built, floors, area_sqm, notes, tags || [], JSON.stringify(images)]
    );
    return res_.created(res, { building });
  } catch (err) {
    return res_.error(res, 'Failed to create building');
  }
};

exports.getBuildings = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, type } = req.query;
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE owner_id = $1 AND is_active = TRUE';
    const params = [req.user.id];

    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (name ILIKE $${params.length} OR address ILIKE $${params.length})`;
    }
    if (type) {
      params.push(type);
      whereClause += ` AND building_type = $${params.length}`;
    }

    const countParams = [...params];
    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.query(`SELECT * FROM buildings ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
      db.query(`SELECT COUNT(*) FROM buildings ${whereClause}`, countParams),
    ]);

    return res_.paginate(res, rows, parseInt(cnt.count), page, limit);
  } catch (err) {
    return res_.error(res, 'Failed to fetch buildings');
  }
};

exports.getBuilding = async (req, res) => {
  try {
    const { rows: [building] } = await db.query(
      'SELECT * FROM buildings WHERE id=$1 AND owner_id=$2 AND is_active=TRUE',
      [req.params.id, req.user.id]
    );
    if (!building) return res_.error(res, 'Building not found', 404);

    // Get scan history
    const { rows: scans } = await db.query(
      'SELECT id, status, health_score, risk_level, total_damages, created_at FROM scans WHERE building_id=$1 ORDER BY created_at DESC LIMIT 10',
      [building.id]
    );
    return res_.success(res, { building: { ...building, scan_history: scans } });
  } catch (err) {
    return res_.error(res, 'Failed to fetch building');
  }
};

exports.updateBuilding = async (req, res) => {
  try {
    const { name, address, city, country, latitude, longitude, building_type, year_built, floors, area_sqm, notes, tags } = req.body;
    const { rows: [building] } = await db.query(
      `UPDATE buildings SET name=$1, address=$2, city=$3, country=$4, latitude=$5, longitude=$6,
       building_type=$7, year_built=$8, floors=$9, area_sqm=$10, notes=$11, tags=$12
       WHERE id=$13 AND owner_id=$14 RETURNING *`,
      [name, address, city, country, latitude, longitude, building_type, year_built, floors, area_sqm, notes, tags || [], req.params.id, req.user.id]
    );
    if (!building) return res_.error(res, 'Building not found', 404);
    return res_.success(res, { building }, 'Building updated');
  } catch (err) {
    return res_.error(res, 'Failed to update building');
  }
};

exports.deleteBuilding = async (req, res) => {
  try {
    const { rows: [b] } = await db.query('SELECT id FROM buildings WHERE id=$1 AND owner_id=$2', [req.params.id, req.user.id]);
    if (!b) return res_.error(res, 'Building not found', 404);
    await db.query('UPDATE buildings SET is_active=FALSE WHERE id=$1', [req.params.id]);
    return res_.success(res, {}, 'Building deleted');
  } catch (err) {
    return res_.error(res, 'Failed to delete building');
  }
};