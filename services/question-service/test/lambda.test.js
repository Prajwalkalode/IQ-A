const assert = require('node:assert/strict');
const { it } = require('node:test');
const { handler } = require('../src/handler');

it('serves the health endpoint through an API Gateway v2 event', async () => {
	const response = await handler(
		{
			version: '2.0',
			rawPath: '/health',
			rawQueryString: '',
			headers: { host: 'question.example.com' },
			requestContext: {
				http: { method: 'GET', path: '/health', sourceIp: '127.0.0.1' },
			},
			isBase64Encoded: false,
		},
		{ awsRequestId: 'question-lambda-test' },
	);

	assert.equal(response.statusCode, 200);
	assert.deepEqual(JSON.parse(response.body), { status: 'question-service ok' });
});
