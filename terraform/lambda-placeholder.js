exports.handler = async () => ({
	statusCode: 503,
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ error: 'Service code has not been deployed' }),
});
