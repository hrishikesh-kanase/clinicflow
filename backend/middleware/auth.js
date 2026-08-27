const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired or invalid token. Please log in again.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `This action requires role: ${roles.join(' or ')}.` });
    }
    next();
  };
}

function signToken(payload, ttl) {
  return jwt.sign(payload, SECRET, { expiresIn: ttl });
}

module.exports = { requireAuth, requireRole, signToken, SECRET };
