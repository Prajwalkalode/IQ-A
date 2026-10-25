const assert = require('node:assert/strict');
const { after, beforeEach, describe, it } = require('node:test');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const {
	DeleteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');

process.env.AWS_REGION = 'ap-south-1';
process.env.QUIZ_SESSIONS_TABLE = 'quiz-sessions-test';
process.env.QUIZ_ASSIGNMENTS_TABLE = 'quiz-assignments-test';

const documentClientMock = mockClient(DynamoDBDocumentClient);
const quizAssignmentRepository = require('../src/repositories/quizAssignmentRepository');
const quizSessionRepository = require('../src/repositories/quizSessionRepository');

beforeEach(() => {
	documentClientMock.reset();
});

after(() => {
	documentClientMock.restore();
});

describe('quiz session repository', () => {
	it('reads a quiz session consistently from the configured table', async () => {
		documentClientMock.on(GetCommand).resolves({ Item: { quizId: 'math-quiz' } });

		assert.deepEqual(await quizSessionRepository.findByQuizId('math-quiz'), {
			quizId: 'math-quiz',
		});
		assert.deepEqual(documentClientMock.commandCalls(GetCommand)[0].args[0].input, {
			TableName: 'quiz-sessions-test',
			Key: { quizId: 'math-quiz' },
			ConsistentRead: true,
		});
	});

	it('validates and conditionally creates a timestamped session', async () => {
		documentClientMock.on(PutCommand).resolves({});

		const created = await quizSessionRepository.create({
			quizId: ' Math-Quiz ',
			questionCount: '2',
			createdBy: 'teacher@example.com',
		});
		const input = documentClientMock.commandCalls(PutCommand)[0].args[0].input;

		assert.equal(created.quizId, 'math-quiz');
		assert.equal(created.questionCount, 2);
		assert.equal(created.revealScore, false);
		assert.equal(created.isActive, true);
		assert.equal(typeof created.createdAt, 'string');
		assert.equal(created.createdAt, created.updatedAt);
		assert.equal(input.TableName, 'quiz-sessions-test');
		assert.equal(input.ConditionExpression, 'attribute_not_exists(#quizId)');
		assert.deepEqual(input.ExpressionAttributeNames, { '#quizId': 'quizId' });
	});

	it('queries the creator index in descending order without consistent reads', async () => {
		documentClientMock.on(QueryCommand).resolves({ Items: [] });

		await quizSessionRepository.listByCreator('teacher@example.com');
		const input = documentClientMock.commandCalls(QueryCommand)[0].args[0].input;

		assert.equal(input.IndexName, 'createdBy-createdAt-index');
		assert.equal(input.KeyConditionExpression, '#createdBy = :createdBy');
		assert.deepEqual(input.ExpressionAttributeNames, {
			'#createdBy': 'createdBy',
		});
		assert.equal(input.ScanIndexForward, false);
		assert.equal('ConsistentRead' in input, false);
	});

	it('uses consistent reads for the all-session scan and aliases update attributes', async () => {
		documentClientMock.on(ScanCommand).resolves({ Items: [] });
		await quizSessionRepository.listAll();
		assert.equal(
			documentClientMock.commandCalls(ScanCommand)[0].args[0].input.ConsistentRead,
			true,
		);

		documentClientMock.on(UpdateCommand).resolves({
			Attributes: { quizId: 'math-quiz', revealScore: true },
		});
		await quizSessionRepository.update('math-quiz', { revealScore: true });
		const input = documentClientMock.commandCalls(UpdateCommand)[0].args[0].input;
		assert.equal(input.ConditionExpression, 'attribute_exists(#quizId)');
		assert.equal(input.ExpressionAttributeNames['#field0'], 'revealScore');
		assert.equal(input.ExpressionAttributeNames['#field1'], 'updatedAt');
		assert.equal(input.ExpressionAttributeNames['#version'], '__v');
		assert.equal(input.ExpressionAttributeValues[':value0'], true);
	});

	it('deletes a session by its table key', async () => {
		documentClientMock.on(DeleteCommand).resolves({});
		await quizSessionRepository.deleteByQuizId('math-quiz');
		assert.deepEqual(documentClientMock.commandCalls(DeleteCommand)[0].args[0].input, {
			TableName: 'quiz-sessions-test',
			Key: { quizId: 'math-quiz' },
		});
	});
});

describe('quiz assignment repository', () => {
	it('reads assignments consistently using both table keys', async () => {
		documentClientMock.on(GetCommand).resolves({ Item: { status: 'assigned' } });

		assert.deepEqual(
			await quizAssignmentRepository.findByQuizAndStudent(
				'math-quiz',
				'student@example.com',
			),
			{ status: 'assigned' },
		);
		assert.deepEqual(documentClientMock.commandCalls(GetCommand)[0].args[0].input, {
			TableName: 'quiz-assignments-test',
			Key: {
				quizId: 'math-quiz',
				studentEmail: 'student@example.com',
			},
			ConsistentRead: true,
		});
	});

	it('conditionally creates assignments with normalized keys and ISO timestamps', async () => {
		documentClientMock.on(PutCommand).resolves({});
		const assignment = await quizAssignmentRepository.create({
			quizId: 'MATH-QUIZ',
			studentEmail: 'STUDENT@EXAMPLE.COM',
			questions: [{ questionId: 'q1', text: 'Question', options: ['A', 'B'] }],
		});
		const input = documentClientMock.commandCalls(PutCommand)[0].args[0].input;

		assert.equal(assignment.quizId, 'math-quiz');
		assert.equal(assignment.studentEmail, 'student@example.com');
		assert.equal(assignment.status, 'assigned');
		assert.equal(typeof assignment.startedAt, 'string');
		assert.equal(typeof assignment.createdAt, 'string');
		assert.equal(input.ConditionExpression, 'attribute_not_exists(#quizId)');
		assert.deepEqual(input.ExpressionAttributeNames, { '#quizId': 'quizId' });
	});

	it('conditionally completes an assignment with aliased status and timestamps', async () => {
		documentClientMock.on(UpdateCommand).resolves({
			Attributes: { quizId: 'math-quiz', status: 'completed' },
		});

		assert.deepEqual(
			await quizAssignmentRepository.complete('math-quiz', 'student@example.com'),
			{ quizId: 'math-quiz', status: 'completed' },
		);
		const input = documentClientMock.commandCalls(UpdateCommand)[0].args[0].input;
		assert.equal(input.ConditionExpression, '#status = :assigned');
		assert.equal(input.ExpressionAttributeNames['#status'], 'status');
		assert.equal(input.ExpressionAttributeNames['#completedAt'], 'completedAt');
		assert.equal(input.ExpressionAttributeNames['#updatedAt'], 'updatedAt');
		assert.equal(input.ReturnValues, 'ALL_NEW');
	});

	it('queries assignments consistently by quiz key', async () => {
		documentClientMock.on(QueryCommand).resolves({ Count: 1 });

		assert.equal(await quizAssignmentRepository.existsByQuiz('math-quiz'), true);
		const input = documentClientMock.commandCalls(QueryCommand)[0].args[0].input;
		assert.equal(input.KeyConditionExpression, '#quizId = :quizId');
		assert.deepEqual(input.ExpressionAttributeNames, { '#quizId': 'quizId' });
		assert.equal(input.ConsistentRead, true);
		assert.equal(input.Select, 'COUNT');
	});
});
