const db = require('../config/database');

const audit = (action, entity = null) => async (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode < 400) {
      db.query(
        'INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          req.user?.id || null,
          action,
          entity,
          req.params?.id || body?.data?.id || null,
          JSON.stringify({ method: req.method, path: req.path, body: req.body }),
          req.ip,
          req.headers['user-agent'],
        ]
      ).catch(() => {});
    }
    return originalJson(body);
  };
  next();
};

module.exports = { audit };