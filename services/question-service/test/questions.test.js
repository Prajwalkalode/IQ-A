const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { after, before, beforeEach, describe, it } = require('node:test');

process.env.JWT_SECRET = 'question-service-test-secret';
process.env.INTERNAL_API_KEY = 'question-service-test-internal-key';

const questionRepository = require('../src/repositories/questionRepository');
const app = require('../src/app');
const { request, startServer } = require('../http-helper');

const questions = [];
let server;
let failCount = false;
let nextId = 1;

function matchesTopic(question, topic) {
	return !topic || question.topic === topic;
}

questionRepository.create = async (data) => {
	const id = String(nextId++).padStart(24, '0');
	const now = new Date().toISOString();
	const question = {
		_id: id,
		__v: 0,
		...data,
		createdAt: now,
		updatedAt: now,
	};
	questions.push(question);
	return question;
};

questionRepository.countByTopic = async (topic) => {
	if (failCount) {
		throw new Error('Database unavailable');
	}
	return questions.filter((question) => matchesTopic(question, topic)).length;
};
questionRepository.findRandomByTopic = async (topic, count) => {
	const availableQuestions = questions.filter((question) => matchesTopic(question, topic));
	return {
		available: availableQuestions.length,
		questions: availableQuestions.slice(0, count).map(({ _id, text, options }) => ({
			_id,
			text,
			options,
		})),
	};
};
questionRepository.findAnswersByIds = async (ids) => {
	const idSet = new Set(ids.map((id) => id.toLowerCase()));
	return questions
		.filter((question) => idSet.has(question._id.toLowerCase()))
		.map(({ _id, correctIndex }) => ({ _id, correctIndex }));
};
questionRepository.list = async ({ topic, page, limit }) => {
	const filtered = questions
		.filter((question) => matchesTopic(question, topic))
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	return {
		questions: filtered.slice((page - 1) * limit, page * limit),
		total: filtered.length,
	};
};
questionRepository.findById = async (id) =>
	questions.find((question) => question._id === id.toLowerCase()) || null;
questionRepository.update = async (id, updates) => {
	const existingQuestion = await questionRepository.findById(id);
	if (!existingQuestion) {
		return null;
	}
	const question = {
		...existingQuestion,
		...updates,
		updatedAt: new Date().toISOString(),
	};
	const index = questions.findIndex((item) => item._id === id.toLowerCase());
	questions[index] = question;
	return question;
};
questionRepository.deleteById = async (id) => {
	const index = questions.findIndex((question) => question._id === id.toLowerCase());
	if (index < 0) {
		return null;
	}
	return questions.splice(index, 1)[0];
};

const teacherToken = jwt.sign(
	{ email: 'teacher@example.com', role: 'teacher' },
	process.env.JWT_SECRET,
);
const studentToken = jwt.sign(
	{ email: 'student@example.com', role: 'student' },
	process.env.JWT_SECRET,
);

describe('question-service HTTP routes', () => {
	before(async () => {
		server = await startServer(app);
	});

	after(async () => {
		await server.close();
	});

	beforeEach(() => {
		questions.length = 0;
		nextId = 1;
		failCount = false;
	});

	it('creates, filters, updates, and deletes questions with owner from token', async () => {
		assert.deepEqual(await request(server.baseUrl, '/health'), {
			status: 200,
			body: { status: 'question-service ok' },
		});
		assert.equal((await request(server.baseUrl, '/questions', {
			method: 'POST',
			body: { text: 'Question', options: ['A', 'B'], correctIndex: 0 },
		})).status, 401);
		assert.equal((await request(server.baseUrl, '/questions', {
			method: 'GET',
			token: studentToken,
		})).status, 403);

		const invalid = await request(server.baseUrl, '/questions', {
			method: 'POST',
			token: teacherToken,
			body: { text: 'Invalid', options: ['Only one'], correctIndex: 2 },
		});
		assert.equal(invalid.status, 400);

		const created = await request(server.baseUrl, '/questions', {
			method: 'POST',
			token: teacherToken,
			body: {
				text: '  Capital of France? ',
				options: [' Paris ', 'London'],
				correctIndex: 0,
				topic: ' Geography ',
				createdBy: 'attacker@example.com',
			},
		});
		assert.equal(created.status, 201);
		assert.equal(created.body.text, 'Capital of France?');
		assert.equal(created.body.options[0], 'Paris');
		assert.equal(created.body.topic, 'geography');
		assert.equal(created.body.createdBy, 'teacher@example.com');
		const id = created.body._id;

		const listed = await request(server.baseUrl, '/questions?topic=%20GEOGRAPHY%20', {
			token: teacherToken,
		});
		assert.equal(listed.status, 200);
		assert.equal(listed.body.total, 1);
		assert.equal(listed.body.questions.length, 1);

		const invalidUpdate = await request(server.baseUrl, `/questions/${id}`, {
			method: 'PUT',
			token: teacherToken,
			body: { options: ['A', 'B'], correctIndex: 4, createdBy: 'attacker@example.com' },
		});
		assert.equal(invalidUpdate.status, 400);

		const updated = await request(server.baseUrl, `/questions/${id}`, {
			method: 'PUT',
			token: teacherToken,
			body: { topic: ' History ', createdBy: 'attacker@example.com' },
		});
		assert.equal(updated.status, 200);
		assert.equal(updated.body.topic, 'history');
		assert.equal(updated.body.createdBy, 'teacher@example.com');
		assert.equal((await request(server.baseUrl, '/questions/not-an-id', {
			token: teacherToken,
		})).status, 400);
		assert.equal((await request(server.baseUrl, '/questions/000000000000000000000099', {
			token: teacherToken,
		})).status, 404);
		assert.equal((await request(server.baseUrl, `/questions/${id}`, {
			method: 'DELETE',
			token: teacherToken,
		})).status, 200);
		assert.equal((await request(server.baseUrl, `/questions/${id}`, {
			method: 'DELETE',
			token: teacherToken,
		})).status, 404);
	});

	it('protects internal APIs and never exposes correct answers in random questions', async () => {
		await questionRepository.create({
			text: 'Two plus two?',
			options: ['Four', 'Five'],
			correctIndex: 0,
			topic: 'math',
			createdBy: 'teacher@example.com',
		});

		assert.equal((await request(server.baseUrl, '/questions/internal/count')).status, 401);
		assert.equal((await request(server.baseUrl, '/questions/internal/count', {
			internalKey: 'wrong',
		})).status, 401);
		assert.equal((await request(server.baseUrl, '/questions/internal/random?count=0', {
			internalKey: process.env.INTERNAL_API_KEY,
		})).status, 400);

		const random = await request(server.baseUrl, '/questions/internal/random?count=2&topic=%20MATH%20', {
			internalKey: process.env.INTERNAL_API_KEY,
		});
		assert.equal(random.status, 200);
		assert.equal(random.body.questions.length, 1);
		assert.equal(random.body.available, 1);
		assert.ok(!('correctIndex' in random.body.questions[0]));

		const count = await request(server.baseUrl, '/questions/internal/count?topic=%20MATH%20', {
			internalKey: process.env.INTERNAL_API_KEY,
		});
		assert.deepEqual(count, { status: 200, body: { available: 1 } });

		const invalidAnswers = await request(server.baseUrl, '/questions/internal/answers', {
			method: 'POST',
			internalKey: process.env.INTERNAL_API_KEY,
			body: { ids: ['not-an-object-id'] },
		});
		assert.equal(invalidAnswers.status, 400);

		const answers = await request(server.baseUrl, '/questions/internal/answers', {
			method: 'POST',
			internalKey: process.env.INTERNAL_API_KEY,
			body: { ids: [random.body.questions[0]._id] },
		});
		assert.deepEqual(answers, {
			status: 200,
			body: [{ _id: random.body.questions[0]._id, correctIndex: 0 }],
		});
	});

	it('returns sanitized server errors when database operations fail', async () => {
		failCount = true;
		const errors = [];
		const originalConsoleError = console.error;
		console.error = (...args) => errors.push(args);
		let response;
		try {
			response = await request(server.baseUrl, '/questions/internal/count', {
				internalKey: process.env.INTERNAL_API_KEY,
			});
		} finally {
			console.error = originalConsoleError;
		}
		assert.deepEqual(response, {
			status: 500,
			body: { error: 'Internal server error' },
		});
		assert.equal(errors.length, 1);
	});
});
