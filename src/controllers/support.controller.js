const db   = require('../config/database');
const res_ = require('../utils/response');

exports.createTicket = async (req, res) => {
  try {
    const { subject, description, priority } = req.body;
    const { rows: [ticket] } = await db.query(
      'INSERT INTO support_tickets (user_id, subject, description, priority) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.id, subject, description, priority || 'medium']
    );
    return res_.created(res, { ticket }, 'Support ticket submitted');
  } catch (err) {
    return res_.error(res, 'Failed to create ticket');
  }
};

exports.getMyTickets = async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM support_tickets WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user.id]
    );
    return res_.success(res, { tickets: rows });
  } catch (err) {
    return res_.error(res, 'Failed to fetch tickets');
  }
};

exports.getTicket = async (req, res) => {
  try {
    const { rows: [ticket] } = await db.query(
      'SELECT * FROM support_tickets WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!ticket) return res_.error(res, 'Ticket not found', 404);
    return res_.success(res, { ticket });
  } catch (err) {
    return res_.error(res, 'Failed to fetch ticket');
  }
};