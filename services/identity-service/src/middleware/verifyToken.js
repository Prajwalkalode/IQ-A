const jwt = require('jsonwebtoken');

function verifyToken(req, res, next) {
	const authorization = req.get('Authorization');
	const [scheme, token] = authorization ? authorization.split(' ') : [];

	if (scheme !== 'Bearer' || !token) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	try {
		req.user = jwt.verify(token, process.env.JWT_SECRET);
		return next();
	} catch (error) {
		return res.status(401).json({ error: 'Unauthorized' });
	}
}

module.exports = verifyToken;
