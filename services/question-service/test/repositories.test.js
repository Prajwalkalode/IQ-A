const assert = require('node:assert/strict');
const { after, beforeEach, describe, it } = require('node:test');
const {
	DeleteCommand,
	DynamoDBDocumentClient,
	GetCommand,
	PutCommand,
	ScanCommand,
	UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');

process.env.AWS_REGION = 'ap-south-1';
process.env.QUESTIONS_TABLE = 'questions-test';

const documentClientMock = mockClient(DynamoDBDocumentClient);
const questionRepository = require('../src/repositories/questionRepository');

beforeEach(() => {
	documentClientMock.reset();
});

after(() => {
	documentClientMock.restore();
});

describe('question repository', () => {
	it('conditionally creates normalized questions with ISO timestamps', async () => {
		documentClientMock.on(PutCommand).resolves({});

		const question = await questionRepository.create({
			text: '  Question? ',
			options: [' A ', 'B'],
			correctIndex: '0',
			topic: ' Math ',
			createdBy: 'teacher@example.com',
		});
		const input = documentClientMock.commandCalls(PutCommand)[0].args[0].input;

		assert.equal(question.text, 'Question?');
		assert.deepEqual(question.options, ['A', 'B']);
		assert.equal(question.correctIndex, 0);
		assert.equal(question.topic, 'math');
		assert.equal(question._id, input.Item.questionId);
		assert.equal(typeof question.createdAt, 'string');
		assert.equal(question.createdAt, question.updatedAt);
		assert.equal(input.TableName, 'questions-test');
		assert.equal(input.ConditionExpression, 'attribute_not_exists(#questionId)');
		assert.deepEqual(input.ExpressionAttributeNames, {
			'#questionId': 'questionId',
		});
	});

	it('rejects invalid question data', async () => {
		await assert.rejects(
			questionRepository.create({
				text: ' ',
				options: ['A'],
				correctIndex: 3,
				createdBy: 'teacher@example.com',
			}),
		);
		assert.equal(documentClientMock.commandCalls(PutCommand).length, 0);
	});

	it('reads by id consistently and maps the DynamoDB key to the API id', async () => {
		documentClientMock
			.on(GetCommand)
			.resolves({ Item: { questionId: 'a'.repeat(24), text: 'Question' } });

		assert.deepEqual(await questionRepository.findById('A'.repeat(24)), {
			_id: 'a'.repeat(24),
			text: 'Question',
		});
		assert.deepEqual(documentClientMock.commandCalls(GetCommand)[0].args[0].input, {
			TableName: 'questions-test',
			Key: { questionId: 'a'.repeat(24) },
			ConsistentRead: true,
		});
	});

	it('consistently scans with aliased topic filtering and paginates results', async () => {
		documentClientMock
			.on(ScanCommand)
			.resolvesOnce({
				Items: [{ questionId: '1', text: 'One', createdAt: '2025-01-01' }],
				LastEvaluatedKey: { questionId: '1' },
			})
			.resolves({
				Items: [{ questionId: '2', text: 'Two', createdAt: '2025-01-02' }],
			});

		const result = await questionRepository.list({ topic: 'math', page: 1, limit: 1 });
		const calls = documentClientMock.commandCalls(ScanCommand);

		assert.equal(calls.length, 2);
		assert.equal(calls[0].args[0].input.ConsistentRead, true);
		assert.equal(calls[0].args[0].input.FilterExpression, '#topic = :topic');
		assert.deepEqual(calls[0].args[0].input.ExpressionAttributeNames, {
			'#topic': 'topic',
		});
		assert.deepEqual(result, {
			questions: [{ _id: '2', text: 'Two', createdAt: '2025-01-02' }],
			total: 2,
		});
	});

	it('randomly samples questions and returns the available count', async () => {
		documentClientMock.on(ScanCommand).resolves({
			Items: [
				{ questionId: '1', text: 'One', options: ['A', 'B'] },
				{ questionId: '2', text: 'Two', options: ['A', 'B'] },
			],
		});

		const result = await questionRepository.findRandomByTopic('math', 1);
		assert.equal(result.available, 2);
		assert.equal(result.questions.length, 1);
		assert.ok(['1', '2'].includes(result.questions[0]._id));
		assert.deepEqual(result.questions[0].options, ['A', 'B']);
		assert.equal('correctIndex' in result.questions[0], false);
	});

	it('uses aliased attributes in updates and returns the updated question', async () => {
		documentClientMock.on(GetCommand).resolves({
			Item: {
				questionId: 'a'.repeat(24),
				_id: 'a'.repeat(24),
				text: 'Old question',
				options: ['A', 'B'],
				correctIndex: 0,
				topic: 'math',
				createdBy: 'teacher@example.com',
				createdAt: '2025-01-01T00:00:00.000Z',
				__v: 0,
			},
		});
		documentClientMock.on(UpdateCommand).resolves({
			Attributes: { questionId: 'a'.repeat(24), text: 'New question' },
		});

		assert.deepEqual(
			await questionRepository.update('a'.repeat(24), {
				text: 'New question',
				options: ['A', 'B'],
				correctIndex: 0,
				topic: 'math',
				createdBy: 'teacher@example.com',
			}),
			{ _id: 'a'.repeat(24), text: 'New question' },
		);
		const input = documentClientMock.commandCalls(UpdateCommand)[0].args[0].input;
		assert.equal(input.ConditionExpression, 'attribute_exists(#questionId)');
		assert.equal(input.ExpressionAttributeNames['#field0'], 'text');
		assert.equal(input.ExpressionAttributeNames['#field1'], 'options');
		assert.equal(input.ExpressionAttributeNames['#field2'], 'correctIndex');
		assert.equal(input.ExpressionAttributeNames['#field3'], 'topic');
		assert.equal(input.ExpressionAttributeNames['#updatedAt'], 'updatedAt');
		assert.equal(input.ExpressionAttributeNames['#version'], '__v');
	});

	it('conditionally deletes a question and returns the removed item', async () => {
		documentClientMock.on(DeleteCommand).resolves({
			Attributes: { questionId: 'a'.repeat(24), text: 'Question' },
		});

		assert.deepEqual(await questionRepository.deleteById('a'.repeat(24)), {
			_id: 'a'.repeat(24),
			text: 'Question',
		});
		const input = documentClientMock.commandCalls(DeleteCommand)[0].args[0].input;
		assert.equal(input.ConditionExpression, 'attribute_exists(#questionId)');
		assert.deepEqual(input.ExpressionAttributeNames, {
			'#questionId': 'questionId',
		});
	});
});
