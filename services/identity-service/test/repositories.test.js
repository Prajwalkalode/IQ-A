const assert = require('node:assert/strict');
const { after, beforeEach, describe, it } = require('node:test');
const {
	DynamoDBDocumentClient,
	GetCommand,
	PutCommand,
} = require('@aws-sdk/lib-dynamodb');
const { mockClient } = require('aws-sdk-client-mock');

process.env.AWS_REGION = 'ap-south-1';
process.env.USERS_TABLE = 'users-test';

const documentClientMock = mockClient(DynamoDBDocumentClient);
const userRepository = require('../src/repositories/userRepository');

beforeEach(() => {
	documentClientMock.reset();
});

after(() => {
	documentClientMock.restore();
});

describe('user repository', () => {
	it('conditionally creates normalized users with ISO timestamps', async () => {
		documentClientMock.on(PutCommand).resolves({});

		const user = await userRepository.create({
			email: 'Teacher@Example.com',
			passwordHash: 'hashed-password',
			name: 'Teacher',
			role: 'teacher',
		});
		const input = documentClientMock.commandCalls(PutCommand)[0].args[0].input;

		assert.equal(user.email, 'teacher@example.com');
		assert.equal(user.name, 'Teacher');
		assert.equal(user.role, 'teacher');
		assert.equal(typeof user.createdAt, 'string');
		assert.equal(user.createdAt, user.updatedAt);
		assert.equal(input.TableName, 'users-test');
		assert.equal(input.ConditionExpression, 'attribute_not_exists(#email)');
		assert.deepEqual(input.ExpressionAttributeNames, { '#email': 'email' });
	});

	it('defaults users to student and rejects unsupported roles', async () => {
		documentClientMock.on(PutCommand).resolves({});
		const user = await userRepository.create({
			email: 'student@example.com',
			passwordHash: 'hashed-password',
			name: 'Student',
		});
		assert.equal(user.role, 'student');

		await assert.rejects(
			userRepository.create({
				email: 'admin@example.com',
				passwordHash: 'hashed-password',
				name: 'Admin',
				role: 'owner',
			}),
		);
		assert.equal(documentClientMock.commandCalls(PutCommand).length, 1);
	});

	it('reads users by normalized email with a consistent read', async () => {
		documentClientMock
			.on(GetCommand)
			.resolves({
				Item: {
					userId: 'a'.repeat(24),
					email: 'teacher@example.com',
					role: 'teacher',
				},
			});

		assert.deepEqual(await userRepository.findByEmail('TEACHER@EXAMPLE.COM'), {
			email: 'teacher@example.com',
			role: 'teacher',
			_id: 'a'.repeat(24),
		});
		assert.deepEqual(documentClientMock.commandCalls(GetCommand)[0].args[0].input, {
			TableName: 'users-test',
			Key: { email: 'teacher@example.com' },
			ConsistentRead: true,
		});
	});
});
