const db   = require('../config/database');
const res_ = require('../utils/response');

exports.getDashboard = async (req, res) => {
  try {
    const [users, scans, reports, requests, revenue] = await Promise.all([
      db.query('SELECT COUNT(*), user_type FROM users GROUP BY user_type'),
      db.query("SELECT COUNT(*), status FROM scans GROUP BY status"),
      db.query('SELECT COUNT(*) FROM reports'),
      db.query('SELECT COUNT(*), status FROM requests GROUP BY status'),
      db.query('SELECT COALESCE(SUM(price),0) as total FROM contracts WHERE status != $1', ['cancelled']),
    ]);

    return res_.success(res, {
      users:    users.rows,
      scans:    scans.rows,
      reports:  parseInt(reports.rows[0].count),
      requests: requests.rows,
      totalContractValue: parseFloat(revenue.rows[0].total),
    });
  } catch (err) {
    return res_.error(res, 'Failed to load dashboard');
  }
};

exports.getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, user_type, is_active } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];

    if (search)    { params.push(`%${search}%`); where += ` AND (full_name ILIKE $${params.length} OR email ILIKE $${params.length})`; }
    if (user_type) { params.push(user_type);      where += ` AND user_type = $${params.length}`; }
    if (is_active !== undefined) { params.push(is_active === 'true'); where += ` AND is_active = $${params.length}`; }

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.query(`SELECT id, full_name, email, user_type, is_active, email_verified, created_at FROM users ${where} ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params, limit, offset]),
      db.query(`SELECT COUNT(*) FROM users ${where}`, params),
    ]);

    return res_.paginate(res, rows, parseInt(cnt.count), page, limit);
  } catch (err) {
    return res_.error(res, 'Failed to fetch users');
  }
};

exports.toggleUserStatus = async (req, res) => {
  try {
    const { rows: [user] } = await db.query(
      'UPDATE users SET is_active = NOT is_active WHERE id=$1 RETURNING id, is_active',
      [req.params.userId]
    );
    if (!user) return res_.error(res, 'User not found', 404);
    return res_.success(res, { user }, `User ${user.is_active ? 'activated' : 'deactivated'}`);
  } catch (err) {
    return res_.error(res, 'Failed to update user');
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, user_id } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];

    if (action)  { params.push(action);  where += ` AND action = $${params.length}`; }
    if (user_id) { params.push(user_id); where += ` AND user_id = $${params.length}`; }

    const [{ rows }, { rows: [cnt] }] = await Promise.all([
      db.query(
        `SELECT al.*, u.full_name, u.email FROM audit_logs al LEFT JOIN users u ON al.user_id=u.id
         ${where} ORDER BY al.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
        [...params, limit, offset]
      ),
      db.query(`SELECT COUNT(*) FROM audit_logs ${where}`, params),
    ]);
    return res_.paginate(res, rows, parseInt(cnt.count), page, limit);
  } catch (err) {
    return res_.error(res, 'Failed to fetch audit logs');
  }
};

exports.getTickets = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT st.*, u.full_name, u.email FROM support_tickets st JOIN users u ON st.user_id=u.id ORDER BY st.created_at DESC`
    );
    return res_.success(res, { tickets: rows });
  } catch (err) {
    return res_.error(res, 'Failed to fetch tickets');
  }
};

exports.updateTicket = async (req, res) => {
  try {
    const { status, admin_notes } = req.body;
    const resolved_at = status === 'resolved' ? new Date() : null;
    const { rows: [ticket] } = await db.query(
      'UPDATE support_tickets SET status=$1, admin_notes=$2, resolved_at=$3 WHERE id=$4 RETURNING *',
      [status, admin_notes, resolved_at, req.params.id]
    );
    return res_.success(res, { ticket }, 'Ticket updated');
  } catch (err) {
    return res_.error(res, 'Failed to update ticket');
  }
};