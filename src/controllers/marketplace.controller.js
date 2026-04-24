const db   = require('../config/database');
const res_ = require('../utils/response');
const notif = require('../services/notification.service');

// ── REQUESTS ────────────────────────────────────────────────────────────────
exports.createRequest = async (req, res) => {
  try {
    const { building_id, scan_id, title, description, budget_min, budget_max, currency, deadline, specialty, location } = req.body;
    const { rows: [request] } = await db.query(
      `INSERT INTO requests (owner_id, building_id, scan_id, title, description, budget_min, budget_max, currency, deadline, specialty, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.user.id, building_id, scan_id, title, description, budget_min, budget_max, currency || 'USD', deadline, specialty, location ? JSON.stringify(location) : null]
    );
    return res_.created(res, { request });
  } catch (err) {
    return res_.error(res, 'Failed to create request');
  }
};

exports.getRequests = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, specialty, lat, lng, radius_km } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE r.status = $1';
    const params = [status || 'open'];

    if (specialty) { params.push(specialty); where += ` AND r.specialty = $${params.length}`; }

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.query(
        `SELECT r.*, u.full_name as owner_name, b.name as building_name, (SELECT COUNT(*) FROM bids WHERE request_id = r.id) as bid_count
         FROM requests r
         JOIN users u ON r.owner_id = u.id
         LEFT JOIN buildings b ON r.building_id = b.id
         ${where} ORDER BY r.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
        [...params, limit, offset]
      ),
      db.query(`SELECT COUNT(*) FROM requests r ${where}`, params),
    ]);
    return res_.paginate(res, rows, parseInt(cnt.count), page, limit);
  } catch (err) {
    return res_.error(res, 'Failed to fetch requests');
  }
};

exports.getMyRequests = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, (SELECT COUNT(*) FROM bids WHERE request_id = r.id) as bid_count
       FROM requests r WHERE r.owner_id=$1 ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    return res_.success(res, { requests: rows });
  } catch (err) {
    return res_.error(res, 'Failed to fetch requests');
  }
};

exports.getRequest = async (req, res) => {
  try {
    const { rows: [request] } = await db.query(
      `SELECT r.*, u.full_name as owner_name FROM requests r JOIN users u ON r.owner_id=u.id WHERE r.id=$1`,
      [req.params.id]
    );
    if (!request) return res_.error(res, 'Request not found', 404);

    const { rows: bids } = await db.query(
      `SELECT b.*, u.full_name as company_name, ep.rating, ep.specialties
       FROM bids b JOIN users u ON b.company_id=u.id LEFT JOIN engineer_profiles ep ON b.company_id=ep.user_id
       WHERE b.request_id=$1 ORDER BY b.created_at DESC`,
      [request.id]
    );
    return res_.success(res, { request: { ...request, bids } });
  } catch (err) {
    return res_.error(res, 'Failed to fetch request');
  }
};

// ── BIDS ────────────────────────────────────────────────────────────────────
exports.submitBid = async (req, res) => {
  try {
    const { price, currency, timeline, proposal, attachments } = req.body;
    const { rows: [request] } = await db.query('SELECT id, owner_id FROM requests WHERE id=$1 AND status=$2', [req.params.requestId, 'open']);
    if (!request) return res_.error(res, 'Request not found or not open', 404);

    const { rows: [bid] } = await db.query(
      `INSERT INTO bids (request_id, company_id, price, currency, timeline, proposal, attachments)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.requestId, req.user.id, price, currency || 'USD', timeline, proposal, JSON.stringify(attachments || [])]
    );

    await notif.createNotification({
      userId: request.owner_id,
      type: 'bid_received',
      title: 'New Bid Received',
      body: `You received a new bid of ${price} ${currency || 'USD'}`,
      data: { bidId: bid.id, requestId: req.params.requestId },
    });

    return res_.created(res, { bid });
  } catch (err) {
    if (err.code === '23505') return res_.error(res, 'You already submitted a bid for this request', 409);
    return res_.error(res, 'Failed to submit bid');
  }
};

exports.acceptBid = async (req, res) => {
  try {
    const { rows: [bid] } = await db.query(
      `SELECT b.*, r.owner_id, r.title FROM bids b JOIN requests r ON b.request_id=r.id
       WHERE b.id=$1 AND r.owner_id=$2 AND b.status='pending'`,
      [req.params.bidId, req.user.id]
    );
    if (!bid) return res_.error(res, 'Bid not found', 404);

    // Update bid & request status
    await db.query('UPDATE bids SET status=$1 WHERE id=$2', ['accepted', bid.id]);
    await db.query('UPDATE requests SET status=$1 WHERE id=$2', ['awarded', bid.request_id]);
    await db.query("UPDATE bids SET status='rejected' WHERE request_id=$1 AND id!=$2 AND status='pending'", [bid.request_id, bid.id]);

    // Create contract
    const { rows: [contract] } = await db.query(
      `INSERT INTO contracts (request_id, bid_id, owner_id, company_id, price, currency)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [bid.request_id, bid.id, req.user.id, bid.company_id, bid.price, bid.currency]
    );

    await notif.createNotification({
      userId: bid.company_id,
      type: 'bid_accepted',
      title: 'Your Bid Was Accepted!',
      body: `Your bid for "${bid.title}" has been accepted.`,
      data: { contractId: contract.id, bidId: bid.id },
    });

    return res_.success(res, { contract, bid }, 'Bid accepted and contract created');
  } catch (err) {
    return res_.error(res, 'Failed to accept bid');
  }
};

// ── MARKETPLACE PROFILES ────────────────────────────────────────────────────
exports.getEngineers = async (req, res) => {
  try {
    const { page = 1, limit = 10, specialty, min_rating } = req.query;
    const offset = (page - 1) * limit;
    let where = "WHERE u.user_type IN ('engineer','company') AND u.is_active=TRUE";
    const params = [];

    if (specialty) { params.push(`%${specialty}%`); where += ` AND ep.specialties::text ILIKE $${params.length}`; }
    if (min_rating) { params.push(parseFloat(min_rating)); where += ` AND ep.rating >= $${params.length}`; }

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.query(
        `SELECT u.id, u.full_name, u.email, u.user_type, u.avatar_url, ep.specialties, ep.rating, ep.years_exp, ep.is_verified
         FROM users u LEFT JOIN engineer_profiles ep ON u.id=ep.user_id
         ${where} ORDER BY ep.rating DESC NULLS LAST LIMIT $${params.length+1} OFFSET $${params.length+2}`,
        [...params, limit, offset]
      ),
      db.query(`SELECT COUNT(*) FROM users u LEFT JOIN engineer_profiles ep ON u.id=ep.user_id ${where}`, params),
    ]);

    return res_.paginate(res, rows, parseInt(cnt.count), page, limit);
  } catch (err) {
    return res_.error(res, 'Failed to fetch engineers');
  }
};

exports.getContracts = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*, r.title as request_title, u.full_name as company_name
       FROM contracts c
       JOIN requests r ON c.request_id=r.id
       JOIN users u ON c.company_id=u.id
       WHERE c.owner_id=$1 OR c.company_id=$1
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    return res_.success(res, { contracts: rows });
  } catch (err) {
    return res_.error(res, 'Failed to fetch contracts');
  }
};