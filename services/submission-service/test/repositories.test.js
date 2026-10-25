const assert = require('node:assert/strict');
const { after, beforeEach, describe, it } = require('node:test');
const {
	DynamoDBDocumentClient,
	GetCommand,
	PutCommand,
	QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');

process.env.AWS_REGION = 'ap-south-1';
process.env.SUBMISSIONS_TABLE = 'submissions-test';

const documentClientMock = mockClient(DynamoDBDocumentClient);
const submissionRepository = require('../src/repositories/submissionRepository');

beforeEach(() => {
	documentClientMock.reset();
});

after(() => {
	documentClientMock.restore();
});

describe('submission repository', () => {
	it('reads by the composite key with a consistent read', async () => {
		documentClientMock.on(GetCommand).resolves({
			Item: {
				quizId: 'math-quiz',
				studentEmail: 'student@example.com',
				submittedAt: '2025-01-01T00:00:00.000Z',
			},
		});

		assert.equal(
			(
				await submissionRepository.findByQuizAndStudent(
					'math-quiz',
					'student@example.com',
				)
			).quizId,
			'math-quiz',
		);
		assert.deepEqual(documentClientMock.commandCalls(GetCommand)[0].args[0].input, {
			TableName: 'submissions-test',
			Key: { quizId: 'math-quiz', studentEmail: 'student@example.com' },
			ConsistentRead: true,
		});
	});

	it('validates and conditionally creates a timestamped submission', async () => {
		documentClientMock.on(PutCommand).resolves({});
		const submission = await submissionRepository.create({
			quizId: 'MATH-QUIZ',
			studentEmail: 'STUDENT@EXAMPLE.COM',
			results: [
				{
					questionId: 'q1',
					selectedIndex: null,
					correctIndex: 0,
					isCorrect: false,
				},
			],
			score: 0,
			total: 1,
		});
		const input = documentClientMock.commandCalls(PutCommand)[0].args[0].input;

		assert.equal(submission.quizId, 'math-quiz');
		assert.equal(submission.studentEmail, 'student@example.com');
		assert.equal(submission.voided, 0);
		assert.equal(typeof submission.submittedAt, 'string');
		assert.equal(submission.submittedAt, submission.createdAt);
		assert.equal(submission.createdAt, submission.updatedAt);
		assert.equal(input.TableName, 'submissions-test');
		assert.equal(input.ConditionExpression, 'attribute_not_exists(#quizId)');
		assert.deepEqual(input.ExpressionAttributeNames, { '#quizId': 'quizId' });
	});

	it('rejects invalid records without writing to DynamoDB', async () => {
		await assert.rejects(
			submissionRepository.create({
				quizId: '',
				studentEmail: 'student@example.com',
				results: [],
				score: 0,
				total: 0,
			}),
		);
		assert.equal(documentClientMock.commandCalls(PutCommand).length, 0);
	});

	it('queries all quiz submissions consistently and paginates', async () => {
		documentClientMock
			.on(QueryCommand)
			.resolvesOnce({
				Items: [
					{
						quizId: 'math-quiz',
						studentEmail: 'one@example.com',
						submittedAt: '2025-01-01T00:00:00.000Z',
					},
				],
				LastEvaluatedKey: {
					quizId: 'math-quiz',
					studentEmail: 'one@example.com',
				},
			})
			.resolves({
				Items: [
					{
						quizId: 'math-quiz',
						studentEmail: 'two@example.com',
						submittedAt: '2025-01-02T00:00:00.000Z',
					},
				],
			});

		const submissions = await submissionRepository.listByQuiz('math-quiz');
		const calls = documentClientMock.commandCalls(QueryCommand);
		assert.equal(calls.length, 2);
		assert.equal(calls[0].args[0].input.ConsistentRead, true);
		assert.equal(calls[0].args[0].input.KeyConditionExpression, '#quizId = :quizId');
		assert.deepEqual(calls[0].args[0].input.ExpressionAttributeNames, {
			'#quizId': 'quizId',
		});
		assert.equal(submissions[0].studentEmail, 'two@example.com');
		assert.equal(submissions[1].studentEmail, 'one@example.com');
	});
});
