const assert = require('node:assert/strict');
const express = require('express');
const { after, before, describe, it } = require('node:test');

process.env.INTERNAL_API_KEY = 'submission-client-test-key';

const quizClient = require('../src/clients/quizClient');
const questionClient = require('../src/clients/questionClient');
const { startServer } = require('../http-helper');

let server;
let upstreamStatus = 200;
const receivedKeys = [];

const mockUpstreams = express();
mockUpstreams.use(express.json());
mockUpstreams.use((req, res, next) => {
	receivedKeys.push(req.get('x-internal-key'));
	if (req.get('x-internal-key') !== process.env.INTERNAL_API_KEY) {
		return res.status(401).json({ error: 'Unauthorized' });
	}
	return next();
});
mockUpstreams.get('/quiz/internal/assignment', (req, res) => {
	if (upstreamStatus !== 200) {
		return res.status(upstreamStatus).json({});
	}
	if (req.query.quizId === 'missing') {
		return res.status(404).json({ error: 'Not found' });
	}
	return res.status(200).json({
		quizId: req.query.quizId,
		studentEmail: req.query.studentEmail,
		status: 'assigned',
		questionIds: ['q1'],
		revealScore: true,
	});
});
mockUpstreams.get('/quiz/internal/session', (req, res) => {
	if (upstreamStatus !== 200) {
		return res.status(upstreamStatus).json({});
	}
	if (req.query.quizId === 'missing') {
		return res.status(404).json({ error: 'Not found' });
	}
	return res.status(200).json({
		quizId: req.query.quizId,
		createdBy: 'teacher@example.com',
		questionCount: 1,
		revealScore: true,
		isActive: true,
	});
});
mockUpstreams.post('/quiz/internal/assignment/complete', (req, res) => {
	if (upstreamStatus !== 200) {
		return res.status(upstreamStatus).json({});
	}
	return res.status(409).json({ error: 'Already completed' });
});
mockUpstreams.post('/questions/internal/answers', (req, res) => {
	if (upstreamStatus !== 200) {
		return res.status(upstreamStatus).json({});
	}
	return res.status(200).json([{ _id: req.body.ids[0], correctIndex: 1 }]);
});

describe('submission-service internal clients', () => {
	before(async () => {
		server = await startServer(mockUpstreams);
		process.env.QUIZ_SERVICE_URL = server.baseUrl;
		process.env.QUESTION_SERVICE_URL = server.baseUrl;
	});

	after(async () => {
		await server.close();
	});

	it('sends the internal header, uses the matching endpoints, and handles not-found/completed states', async () => {
		receivedKeys.length = 0;
		const assignment = await quizClient.getAssignment('quiz one', 'student+one@example.com');
		assert.equal(assignment.quizId, 'quiz one');
		assert.equal(assignment.studentEmail, 'student+one@example.com');
		assert.equal(assignment.status, 'assigned');
		assert.deepEqual(assignment.questionIds, ['q1']);

		assert.equal(await quizClient.getAssignment('missing', 'student@example.com'), null);
		assert.equal((await quizClient.getSession('quiz-one')).createdBy, 'teacher@example.com');
		assert.equal(await quizClient.getSession('missing'), null);
		await quizClient.completeAssignment('quiz-one', 'student@example.com');
		assert.ok(receivedKeys.length >= 5);
		assert.ok(receivedKeys.every((key) => key === process.env.INTERNAL_API_KEY));

		const answers = await questionClient.getAnswers(['q1']);
		assert.deepEqual(answers, [{ _id: 'q1', correctIndex: 1 }]);
		assert.equal(receivedKeys.at(-1), process.env.INTERNAL_API_KEY);
	});

	it('marks non-2xx and unreachable upstreams as upstream errors', async () => {
		upstreamStatus = 503;
		await assert.rejects(quizClient.getSession('quiz-one'), (error) => error.upstream === true);
		await assert.rejects(questionClient.getAnswers(['q1']), (error) => error.upstream === true);

		upstreamStatus = 200;
		const previousUrl = process.env.QUIZ_SERVICE_URL;
		process.env.QUIZ_SERVICE_URL = 'http://127.0.0.1:1';
		try {
			await assert.rejects(quizClient.getSession('quiz-one'), (error) => error.upstream === true);
		} finally {
			process.env.QUIZ_SERVICE_URL = previousUrl;
		}
	});
});
