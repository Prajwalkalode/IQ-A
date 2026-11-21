async function startServer(app) {
	const server = app.listen(0, '127.0.0.1');
	await new Promise((resolve) => server.once('listening', resolve));

	return {
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		close: () =>
			new Promise((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

async function request(baseUrl, route, { method = 'GET', token, internalKey, body } = {}) {
	const response = await fetch(`${baseUrl}${route}`, {
		method,
		headers: {
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(internalKey ? { 'x-internal-key': internalKey } : {}),
			...(body === undefined ? {} : { 'content-type': 'application/json' }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

	return { status: response.status, body: await response.json() };
}

module.exports = { startServer, request };
