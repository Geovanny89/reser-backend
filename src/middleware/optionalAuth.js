const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt');

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return next();
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    // Si el token es inválido, podrías elegir fallar o simplemente ignorarlo
    // En este caso, si enviaron un token y es inválido, mejor fallar por seguridad
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
};
