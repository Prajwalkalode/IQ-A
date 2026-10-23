const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { after, before, beforeEach, describe, it } = require('node:test');

process.env.JWT_SECRET = 'question-service-test-secret';
process.env.INTERNAL_API_KEY = 'question-service-test-internal-key';

const Question = require('../src/models/Question');
const app = require('../src/app');
const { request, startServer } = require('../http-helper');

const questions = [];
let server;
let failCount = false;

function matchesTopic(question, filter) {
	return !filter.topic || question.topic === filter.topic;
}

function query(value) {
	return {
		select() {
			return this;
		},
		sort() {
			return this;
		},
		skip() {
			return this;
		},
		limit() {
			return this;
		},
		lean: async () => value,
		then(resolve, reject) {
			return Promise.resolve(value).then(resolve, reject);
		},
	};
}

Question.create = async (data) => {
	const question = new Question(data);
	await question.validate();
	questions.push(question);
	return question;
};
Question.countDocuments = async (filter = {}) => {
	if (failCount) {
		throw new Error('Database unavailable');
	}
	return questions.filter((question) => matchesTopic(question, filter)).length;
};
Question.aggregate = async (pipeline) => {
	const filter = pipeline.find((stage) => stage.$match)?.$match || {};
	const size = pipeline.find((stage) => stage.$sample).$sample.size;
	return questions
		.filter((question) => matchesTopic(question, filter))
		.slice(0, size)
		.map(({ _id, text, options }) => ({ _id, text, options }));
};
Question.find = (filter = {}) =>
	query(
		questions
			.filter((question) => {
				if (filter.topic && !matchesTopic(question, filter)) {
					return false;
				}
				if (filter._id && !filter._id.$in.some((id) => String(id) === String(question._id))) {
					return false;
				}
				return true;
			})
			.map((question) => ({
				_id: question._id,
				correctIndex: question.correctIndex,
			})),
	);
Question.findById = async (id) =>
	questions.find((question) => String(question._id) === String(id)) || null;
Question.findByIdAndUpdate = async (id, update, options) => {
	assert.equal(options.runValidators, true);
	const existingQuestion = await Question.findById(id);
	if (!existingQuestion) {
		return null;
	}
	const question = new Question(existingQuestion.toObject());
	question.set(update.$set);
	await question.validate();
	const index = questions.findIndex((item) => String(item._id) === String(id));
	questions[index] = question;
	return question;
};
Question.findByIdAndDelete = async (id) => {
	const index = questions.findIndex((question) => String(question._id) === String(id));
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
		assert.equal((await request(server.baseUrl, `/questions/${new mongoose.Types.ObjectId()}`, {
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
		await Question.create({
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
