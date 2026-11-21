function internalOnly(req, res, next) {
	if (
		!process.env.INTERNAL_API_KEY ||
		req.headers['x-internal-key'] !== process.env.INTERNAL_API_KEY
	) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	return next();
}

module.exports = internalOnly;
