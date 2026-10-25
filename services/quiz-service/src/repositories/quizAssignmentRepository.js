const { randomUUID } = require('node:crypto');
const {
	GetCommand,
	PutCommand,
	QueryCommand,
	UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const documentClient = require('./dynamoClient');
const { quizAssignmentSchema } = require('../schemas/quizSchemas');

const TABLE_NAME = () => {
	const tableName = process.env.QUIZ_ASSIGNMENTS_TABLE;
	if (!tableName) {
		throw new Error('QUIZ_ASSIGNMENTS_TABLE is not configured');
	}
	return tableName;
};

async function findByQuizAndStudent(quizId, studentEmail) {
	const result = await documentClient.send(
		new GetCommand({
			TableName: TABLE_NAME(),
			Key: { quizId, studentEmail },
			ConsistentRead: true,
		}),
	);
	return result.Item || null;
}

async function create(input) {
	const data = quizAssignmentSchema.parse(input);
	const now = new Date().toISOString();
	const assignment = {
		_id: randomUUID().replaceAll('-', '').slice(0, 24),
		__v: 0,
		...data,
		startedAt: (data.startedAt || new Date(now)).toISOString(),
		createdAt: now,
		updatedAt: now,
	};
	if (data.completedAt) {
		assignment.completedAt = data.completedAt.toISOString();
	}
	await documentClient.send(
		new PutCommand({
			TableName: TABLE_NAME(),
			Item: assignment,
			ConditionExpression: 'attribute_not_exists(#quizId)',
			ExpressionAttributeNames: { '#quizId': 'quizId' },
		}),
	);
	return assignment;
}

async function complete(quizId, studentEmail) {
	const now = new Date().toISOString();
	try {
		const result = await documentClient.send(
			new UpdateCommand({
				TableName: TABLE_NAME(),
				Key: { quizId, studentEmail },
				UpdateExpression:
					'SET #status = :completed, #completedAt = :completedAt, #updatedAt = :updatedAt, #version = #version + :one',
				ConditionExpression: '#status = :assigned',
				ExpressionAttributeNames: {
					'#status': 'status',
					'#completedAt': 'completedAt',
					'#updatedAt': 'updatedAt',
					'#version': '__v',
				},
				ExpressionAttributeValues: {
					':completed': 'completed',
					':assigned': 'assigned',
					':completedAt': now,
					':updatedAt': now,
					':one': 1,
				},
				ReturnValues: 'ALL_NEW',
			}),
		);
		return result.Attributes || null;
	} catch (error) {
		if (error.name === 'ConditionalCheckFailedException') {
			return null;
		}
		throw error;
	}
}

async function existsByQuiz(quizId) {
	const result = await documentClient.send(
		new QueryCommand({
			TableName: TABLE_NAME(),
			KeyConditionExpression: '#quizId = :quizId',
			ExpressionAttributeNames: {
				'#quizId': 'quizId',
			},
			ExpressionAttributeValues: {
				':quizId': quizId,
			},
			Limit: 1,
			Select: 'COUNT',
			ConsistentRead: true,
		}),
	);
	return result.Count > 0;
}

module.exports = {
	complete,
	create,
	existsByQuiz,
	findByQuizAndStudent,
};
