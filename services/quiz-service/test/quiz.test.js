const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { after, before, beforeEach, describe, it } = require('node:test');

process.env.JWT_SECRET = 'quiz-service-test-secret';
process.env.INTERNAL_API_KEY = 'quiz-service-test-internal-key';

const quizAssignmentRepository = require('../src/repositories/quizAssignmentRepository');
const quizSessionRepository = require('../src/repositories/quizSessionRepository');
const app = require('../src/app');
const { request, startServer } = require('../http-helper');

const sessions = [];
const assignments = [];
let bankQuestions = [];
let server;
let questionServer;
let upstreamError = false;

function matchingQuestions(topic) {
	return bankQuestions.filter((question) => !topic || question.topic === topic);
}

const questionApp = express();
questionApp.use((req, res, next) => {
	if (req.get('x-internal-key') !== process.env.INTERNAL_API_KEY) {
		return res.status(401).json({ error: 'Unauthorized' });
	}
	if (upstreamError) {
		return res.status(503).json({ error: 'Unavailable' });
	}
	return next();
});
questionApp.get('/questions/internal/count', (req, res) => {
	return res.status(200).json({ available: matchingQuestions(req.query.topic).length });
});
questionApp.get('/questions/internal/random', (req, res) => {
	const count = Number(req.query.count);
	const available = matchingQuestions(req.query.topic).length;
	const response = {
		questions: matchingQuestions(req.query.topic)
			.slice(0, count)
			.map(({ _id, text, options }) => ({ _id, text, options })),
	};
	if (available < count) {
		response.available = available;
	}
	return res.status(200).json(response);
});

quizSessionRepository.findByQuizId = async (quizId) =>
	sessions.find((session) => session.quizId === quizId) || null;
quizSessionRepository.create = async (session) => {
	if (sessions.some((item) => item.quizId === session.quizId)) {
		const error = new Error('Duplicate quiz ID');
		error.name = 'ConditionalCheckFailedException';
		throw error;
	}
	const created = {
		_id: '000000000000000000000001',
		__v: 0,
		isActive: true,
		...session,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
	sessions.push(created);
	return created;
};
quizSessionRepository.listAll = async () =>
	[...sessions].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
quizSessionRepository.listByCreator = async (createdBy) =>
	[...sessions]
		.filter((session) => session.createdBy === createdBy)
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
quizSessionRepository.update = async (quizId, updates) => {
	const session = sessions.find((item) => item.quizId === quizId);
	if (!session) {
		return null;
	}
	Object.assign(session, updates, {
		updatedAt: new Date().toISOString(),
		__v: session.__v + 1,
	});
	return session;
};
quizSessionRepository.deleteByQuizId = async (quizId) => {
	const index = sessions.findIndex((session) => session.quizId === quizId);
	if (index >= 0) {
		sessions.splice(index, 1);
	}
};

quizAssignmentRepository.findByQuizAndStudent = async (quizId, studentEmail) =>
	assignments.find(
		(assignment) =>
			assignment.quizId === quizId && assignment.studentEmail === studentEmail,
	) || null;
quizAssignmentRepository.create = async (assignment) => {
	if (
		assignments.some(
			(item) =>
				item.quizId === assignment.quizId &&
				item.studentEmail === assignment.studentEmail,
		)
	) {
		const error = new Error('Duplicate assignment');
		error.name = 'ConditionalCheckFailedException';
		throw error;
	}
	const created = {
		_id: '000000000000000000000002',
		__v: 0,
		status: 'assigned',
		startedAt: new Date().toISOString(),
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...assignment,
	};
	assignments.push(created);
	return created;
};
quizAssignmentRepository.complete = async (quizId, studentEmail) => {
	const assignment = assignments.find(
		(item) =>
			item.quizId === quizId &&
			item.studentEmail === studentEmail &&
			item.status === 'assigned',
	);
	if (!assignment) {
		return null;
	}
	Object.assign(assignment, {
		status: 'completed',
		completedAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		__v: assignment.__v + 1,
	});
	return assignment;
};
quizAssignmentRepository.existsByQuiz = async (quizId) =>
	assignments.some((assignment) => assignment.quizId === quizId);

const teacherToken = jwt.sign(
	{ email: 'teacher@example.com', role: 'teacher' },
	process.env.JWT_SECRET,
);
const otherTeacherToken = jwt.sign(
	{ email: 'other@example.com', role: 'teacher' },
	process.env.JWT_SECRET,
);
const adminToken = jwt.sign(
	{ email: 'admin@example.com', role: 'admin' },
	process.env.JWT_SECRET,
);
const studentToken = jwt.sign(
	{ email: 'student@example.com', role: 'student' },
	process.env.JWT_SECRET,
);

describe('quiz-service HTTP routes', () => {
	before(async () => {
		questionServer = await startServer(questionApp);
		process.env.QUESTION_SERVICE_URL = questionServer.baseUrl;
		server = await startServer(app);
	});

	after(async () => {
		await server.close();
		await questionServer.close();
	});

	beforeEach(() => {
		sessions.length = 0;
		assignments.length = 0;
		upstreamError = false;
		bankQuestions = Array.from({ length: 10 }, (_, index) => ({
			_id: `question-${index + 1}`,
			text: `Question ${index + 1}`,
			options: ['A', 'B'],
			correctIndex: index % 2,
			topic: 'math',
			createdBy: 'teacher@example.com',
		}));
		process.env.QUESTION_SERVICE_URL = questionServer.baseUrl;
	});

	it('creates quiz sessions after checking question availability', async () => {
		assert.deepEqual(await request(server.baseUrl, '/health'), {
			status: 200,
			body: { status: 'quiz-service ok' },
		});
		assert.equal((await request(server.baseUrl, '/quiz', {
			method: 'POST',
			body: { quizId: 'math-quiz', questionCount: 2 },
		})).status, 401);
		assert.equal((await request(server.baseUrl, '/quiz', {
			method: 'POST',
			token: studentToken,
			body: { quizId: 'math-quiz', questionCount: 2 },
		})).status, 403);

		bankQuestions = bankQuestions.slice(0, 1);
		const insufficient = await request(server.baseUrl, '/quiz', {
			method: 'POST',
			token: teacherToken,
			body: { quizId: 'math-quiz', questionCount: 2 },
		});
		assert.equal(insufficient.status, 422, JSON.stringify(insufficient.body));
		assert.equal(insufficient.body.requested, 2);
		assert.equal(insufficient.body.available, 1);

		const invalid = await request(server.baseUrl, '/quiz', {
			method: 'POST',
			token: teacherToken,
			body: { quizId: 'internal', questionCount: 2 },
		});
		assert.equal(invalid.status, 400);

		bankQuestions = Array.from({ length: 10 }, (_, index) => ({
			_id: `question-${index + 1}`,
			text: `Question ${index + 1}`,
			options: ['A', 'B'],
			correctIndex: index % 2,
			topic: 'math',
			createdBy: 'teacher@example.com',
		}));
		const created = await request(server.baseUrl, '/quiz', {
			method: 'POST',
			token: teacherToken,
			body: {
				quizId: ' Math-Quiz ',
				questionCount: 2,
				topic: ' Math ',
				createdBy: 'attacker@example.com',
				revealScore: true,
			},
		});
		assert.equal(created.status, 201);
		assert.equal(created.body.quizId, 'math-quiz');
		assert.equal(created.body.topic, 'math');
		assert.equal(created.body.createdBy, 'teacher@example.com');
		assert.equal(created.body.revealScore, true);

		const duplicate = await request(server.baseUrl, '/quiz', {
			method: 'POST',
			token: teacherToken,
			body: { quizId: 'math-quiz', questionCount: 1 },
		});
		assert.equal(duplicate.status, 409);

		upstreamError = true;
		const upstream = await request(server.baseUrl, '/quiz', {
			method: 'POST',
			token: teacherToken,
			body: { quizId: 'other-quiz', questionCount: 1 },
		});
		assert.equal(upstream.status, 502);
		assert.deepEqual(upstream.body, { error: 'Question service unavailable' });
		upstreamError = false;
	});

	it('enforces teacher ownership and protects quizzes with assignments from deletion', async () => {
		const createQuiz = (quizId, token = teacherToken) =>
			request(server.baseUrl, '/quiz', {
				method: 'POST',
				token,
				body: { quizId, questionCount: 1 },
			});
		await createQuiz('owned-quiz');
		assert.equal((await request(server.baseUrl, '/quiz', { token: otherTeacherToken })).body.length, 0);
		assert.equal((await request(server.baseUrl, '/quiz/owned-quiz', {
			token: otherTeacherToken,
		})).status, 404);
		assert.equal((await request(server.baseUrl, '/quiz/owned-quiz', {
			token: teacherToken,
		})).status, 200);

		const forbiddenPatch = await request(server.baseUrl, '/quiz/owned-quiz', {
			method: 'PATCH',
			token: otherTeacherToken,
			body: { isActive: false },
		});
		assert.equal(forbiddenPatch.status, 403);
		const update = await request(server.baseUrl, '/quiz/owned-quiz', {
			method: 'PATCH',
			token: teacherToken,
			body: { isActive: false, questionCount: 90 },
		});
		assert.equal(update.status, 200);
		assert.equal(update.body.isActive, false);
		assert.equal(update.body.questionCount, 1);

		await createQuiz('admin-quiz', adminToken);
		assert.equal((await request(server.baseUrl, '/quiz/admin-quiz', {
			token: adminToken,
		})).status, 200);
	});

	it('starts once, returns the same snapshot on refresh, and handles unavailable quizzes', async () => {
		await request(server.baseUrl, '/quiz', {
			method: 'POST',
			token: teacherToken,
			body: { quizId: 'start-quiz', questionCount: 2, revealScore: true },
		});

		const started = await request(server.baseUrl, '/quiz/START-QUIZ/start', {
			method: 'POST',
			token: studentToken,
		});
		assert.equal(started.status, 201);
		assert.equal(started.body.questions.length, 2);
		assert.ok(started.body.questions.every((question) => !('correctIndex' in question)));

		bankQuestions = [{
			_id: 'different-question',
			text: 'Different',
			options: ['X', 'Y'],
			correctIndex: 0,
			topic: 'math',
			createdBy: 'teacher@example.com',
		}];
		const refreshed = await request(server.baseUrl, '/quiz/start-quiz/start', {
			method: 'POST',
			token: studentToken,
		});
		assert.equal(refreshed.status, 200);
		assert.deepEqual(refreshed.body.questions, started.body.questions);

		const internal = await request(server.baseUrl, '/quiz/internal/assignment?quizId=START-QUIZ&studentEmail=STUDENT%40EXAMPLE.COM', {
			internalKey: process.env.INTERNAL_API_KEY,
		});
		assert.equal(internal.status, 200);
		assert.deepEqual(internal.body.questionIds, started.body.questions.map((question) => question.questionId));
		assert.equal(internal.body.revealScore, true);
		assert.equal((await request(server.baseUrl, '/quiz/internal/session?quizId=start-quiz', {
			internalKey: process.env.INTERNAL_API_KEY,
		})).body.createdBy, 'teacher@example.com');
		assert.equal((await request(server.baseUrl, '/quiz/internal/session?quizId=start-quiz')).status, 401);

		const complete = await request(server.baseUrl, '/quiz/internal/assignment/complete', {
			method: 'POST',
			internalKey: process.env.INTERNAL_API_KEY,
			body: { quizId: 'start-quiz', studentEmail: 'student@example.com' },
		});
		assert.equal(complete.status, 200);
		assert.equal((await request(server.baseUrl, '/quiz/start-quiz/start', {
			method: 'POST',
			token: studentToken,
		})).status, 409);

		assert.equal((await request(server.baseUrl, '/quiz/missing-quiz/start', {
			method: 'POST',
			token: studentToken,
		})).status, 404);
		await request(server.baseUrl, '/quiz', {
			method: 'POST',
			token: teacherToken,
			body: { quizId: 'inactive-quiz', questionCount: 1 },
		});
		await request(server.baseUrl, '/quiz/inactive-quiz', {
			method: 'PATCH',
			token: teacherToken,
			body: { isActive: false },
		});
		assert.equal((await request(server.baseUrl, '/quiz/inactive-quiz/start', {
			method: 'POST',
			token: studentToken,
		})).status, 403);

		const unauthorized = await request(server.baseUrl, '/quiz/internal/assignment?quizId=start-quiz&studentEmail=student%40example.com');
		assert.equal(unauthorized.status, 401);
	});

	it('returns conflicts when question bank shrinks or quiz has an assignment', async () => {
		await request(server.baseUrl, '/quiz', {
			method: 'POST',
			token: teacherToken,
			body: { quizId: 'shrunk-quiz', questionCount: 2 },
		});
		bankQuestions = bankQuestions.slice(0, 1);
		const unavailable = await request(server.baseUrl, '/quiz/shrunk-quiz/start', {
			method: 'POST',
			token: studentToken,
		});
		assert.equal(unavailable.status, 409);

		await request(server.baseUrl, '/quiz', {
			method: 'POST',
			token: teacherToken,
			body: { quizId: 'delete-quiz', questionCount: 1 },
		});
		await request(server.baseUrl, '/quiz/delete-quiz/start', { method: 'POST', token: studentToken });
		const conflict = await request(server.baseUrl, '/quiz/delete-quiz', {
			method: 'DELETE',
			token: teacherToken,
		});
		assert.equal(conflict.status, 409);
		assert.deepEqual(conflict.body, {
			error: 'Quiz has student attempts; deactivate it instead',
		});
	});
});
