const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { after, before, beforeEach, describe, it } = require('node:test');

process.env.JWT_SECRET = 'submission-service-test-secret';
process.env.INTERNAL_API_KEY = 'submission-service-test-internal-key';

const Submission = require('../src/models/Submission');
const quizClient = require('../src/clients/quizClient');
const questionClient = require('../src/clients/questionClient');
const app = require('../src/app');
const { request, startServer } = require('../http-helper');

const submissions = [];
let server;
let assignment = null;
let session = null;
let answerKey = [];
let upstreamFailure = false;
let completionFailure = false;
let completionCalls = 0;

function matches(submission, filter) {
	return Object.entries(filter).every(
		([key, value]) => String(submission[key]) === String(value),
	);
}

Submission.findOne = async (filter) =>
	submissions.find((submission) => matches(submission, filter)) || null;
Submission.prototype.save = async function () {
	await this.validate();
	if (submissions.some((submission) => submission.quizId === this.quizId && submission.studentEmail === this.studentEmail)) {
		const error = new Error('Duplicate submission');
		error.code = 11000;
		throw error;
	}
	submissions.push(this);
	return this;
};
Submission.find = (filter = {}) => ({
	sort() {
		return this;
	},
	lean: async () =>
		submissions
			.filter((submission) => matches(submission, filter))
			.slice()
			.sort((left, right) => right.submittedAt - left.submittedAt)
			.map((submission) => submission.toObject()),
});

quizClient.getAssignment = async () => {
	if (upstreamFailure) {
		const error = new Error('Quiz service unavailable');
		error.upstream = true;
		throw error;
	}
	return assignment;
};
quizClient.completeAssignment = async () => {
	completionCalls += 1;
	if (completionFailure) {
		throw new Error('Completion unavailable');
	}
	if (assignment) {
		assignment.status = 'completed';
	}
};
quizClient.getSession = async () => {
	if (upstreamFailure) {
		const error = new Error('Quiz service unavailable');
		error.upstream = true;
		throw error;
	}
	return session;
};
questionClient.getAnswers = async () => {
	if (upstreamFailure) {
		const error = new Error('Question service unavailable');
		error.upstream = true;
		throw error;
	}
	return answerKey;
};

const studentToken = jwt.sign(
	{ email: 'student@example.com', role: 'student' },
	process.env.JWT_SECRET,
);
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

describe('submission-service HTTP routes', () => {
	before(async () => {
		server = await startServer(app);
	});

	after(async () => {
		await server.close();
	});

	beforeEach(() => {
		submissions.length = 0;
		assignment = {
			quizId: 'math-quiz',
			studentEmail: 'student@example.com',
			status: 'assigned',
			questionIds: ['q1', 'q2', 'deleted-question'],
			revealScore: true,
		};
		session = {
			quizId: 'math-quiz',
			createdBy: 'teacher@example.com',
		};
		answerKey = [
			{ _id: 'q1', correctIndex: 0 },
			{ _id: 'q2', correctIndex: 1 },
		];
		upstreamFailure = false;
		completionFailure = false;
		completionCalls = 0;
	});

	it('validates and grades an assignment, counts deleted questions, then completes it', async () => {
		assert.deepEqual(await request(server.baseUrl, '/health'), {
			status: 200,
			body: { status: 'submission-service ok' },
		});
		assert.equal((await request(server.baseUrl, '/submissions', {
			method: 'POST',
			body: { quizId: 'math-quiz', answers: [] },
		})).status, 401);

		const invalid = await request(server.baseUrl, '/submissions', {
			method: 'POST',
			token: studentToken,
			body: { quizId: 'math-quiz', answers: [{ questionId: 'q1', selectedIndex: 6 }] },
		});
		assert.equal(invalid.status, 400);
		const duplicateAnswers = await request(server.baseUrl, '/submissions', {
			method: 'POST',
			token: studentToken,
			body: {
				quizId: 'math-quiz',
				answers: [
					{ questionId: 'q1', selectedIndex: 0 },
					{ questionId: 'q1', selectedIndex: 1 },
				],
			},
		});
		assert.equal(duplicateAnswers.status, 400);
		const unassigned = await request(server.baseUrl, '/submissions', {
			method: 'POST',
			token: studentToken,
			body: { quizId: 'math-quiz', answers: [{ questionId: 'other', selectedIndex: 0 }] },
		});
		assert.equal(unassigned.status, 400);
		assert.deepEqual(unassigned.body.offendingIds, ['other']);

		const submitted = await request(server.baseUrl, '/submissions', {
			method: 'POST',
			token: studentToken,
			body: {
				quizId: ' MATH-QUIZ ',
				answers: [
					{ questionId: 'q1', selectedIndex: 0 },
					{ questionId: 'q2', selectedIndex: 0 },
				],
			},
		});
		assert.equal(submitted.status, 201);
		assert.equal(submitted.body.score, 1);
		assert.equal(submitted.body.total, 2);
		assert.equal(submitted.body.percentage, 50);
		assert.equal(submissions[0].voided, 1);
		assert.equal(submissions[0].results.length, 2);
		assert.equal(submissions[0].results[1].isCorrect, false);
		assert.equal(completionCalls, 1);
		assert.equal(assignment.status, 'completed');

		const repeated = await request(server.baseUrl, '/submissions', {
			method: 'POST',
			token: studentToken,
			body: { quizId: 'math-quiz', answers: [] },
		});
		assert.equal(repeated.status, 409);
		assert.deepEqual(repeated.body, { error: 'Already submitted' });
	});

	it('handles missing/completed assignments, upstream failures, and hidden scores', async () => {
		assignment = null;
		assert.equal((await request(server.baseUrl, '/submissions', {
			method: 'POST',
			token: studentToken,
			body: { quizId: 'math-quiz', answers: [] },
		})).status, 404);

		assignment = {
			quizId: 'math-quiz',
			studentEmail: 'student@example.com',
			status: 'completed',
			questionIds: ['q1', 'q2', 'deleted-question'],
			revealScore: true,
		};
		assert.equal((await request(server.baseUrl, '/submissions', {
			method: 'POST',
			token: studentToken,
			body: { quizId: 'math-quiz', answers: [] },
		})).status, 409);

		assignment.status = 'assigned';
		upstreamFailure = true;
		const unavailable = await request(server.baseUrl, '/submissions', {
			method: 'POST',
			token: studentToken,
			body: { quizId: 'math-quiz', answers: [] },
		});
		assert.equal(unavailable.status, 502);
		assert.deepEqual(unavailable.body, { error: 'Upstream service unavailable' });

		upstreamFailure = false;
		completionFailure = true;
		assignment.revealScore = false;
		const errors = [];
		const originalConsoleError = console.error;
		console.error = (...args) => errors.push(args);
		let hiddenScore;
		try {
			hiddenScore = await request(server.baseUrl, '/submissions', {
				method: 'POST',
				token: studentToken,
				body: { quizId: 'math-quiz', answers: [{ questionId: 'q1', selectedIndex: 0 }] },
			});
		} finally {
			console.error = originalConsoleError;
		}
		assert.equal(hiddenScore.status, 201);
		assert.equal(errors.length, 1);
		assert.ok(!('score' in hiddenScore.body));
		assert.ok(!('total' in hiddenScore.body));
		assert.ok(!('percentage' in hiddenScore.body));
		assert.equal(submissions.length, 1);

		completionFailure = false;
		const mine = await request(server.baseUrl, '/submissions/quiz/math-quiz/mine', {
			token: studentToken,
		});
		assert.equal(mine.status, 200);
		assert.ok(!('score' in mine.body));
		assert.ok(!('results' in mine.body));
	});

	it('reveals current score on mine and limits reports to the quiz owner or admin', async () => {
		const submission = new Submission({
			quizId: 'math-quiz',
			studentEmail: 'student@example.com',
			results: [{ questionId: 'q1', selectedIndex: 0, correctIndex: 0, isCorrect: true }],
			score: 1,
			total: 1,
			voided: 0,
		});
		await submission.save();

		assignment.revealScore = false;
		const privateResult = await request(server.baseUrl, '/submissions/quiz/math-quiz/mine', {
			token: studentToken,
		});
		assert.equal(privateResult.status, 200);
		assert.ok(!('score' in privateResult.body));

		assignment.revealScore = true;
		const visibleResult = await request(server.baseUrl, '/submissions/quiz/math-quiz/mine', {
			token: studentToken,
		});
		assert.equal(visibleResult.body.score, 1);
		assert.equal(visibleResult.body.total, 1);
		assert.ok(!('results' in visibleResult.body));

		assert.equal((await request(server.baseUrl, '/submissions/quiz/math-quiz', {
			token: otherTeacherToken,
		})).status, 403);
		const report = await request(server.baseUrl, '/submissions/quiz/math-quiz', {
			token: teacherToken,
		});
		assert.equal(report.status, 200);
		assert.equal(report.body.summary.submissions, 1);
		assert.equal(report.body.summary.averagePercentage, 100);
		assert.equal(report.body.submissions[0].percentage, 100);
		assert.ok(!('results' in report.body.submissions[0]));
		assert.equal((await request(server.baseUrl, '/submissions/quiz/math-quiz', {
			token: adminToken,
		})).status, 200);

		session = null;
		assert.equal((await request(server.baseUrl, '/submissions/quiz/missing', {
			token: adminToken,
		})).status, 404);
	});
});
