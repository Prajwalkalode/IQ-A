const { randomUUID } = require('node:crypto');
const {
	DeleteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const documentClient = require('./dynamoClient');
const { quizSessionSchema } = require('../schemas/quizSchemas');

const TABLE_NAME = () => {
	const tableName = process.env.QUIZ_SESSIONS_TABLE;
	if (!tableName) {
		throw new Error('QUIZ_SESSIONS_TABLE is not configured');
	}
	return tableName;
};

function toSession(item) {
	return item || null;
}

async function findByQuizId(quizId) {
	const result = await documentClient.send(
		new GetCommand({
			TableName: TABLE_NAME(),
			Key: { quizId },
			ConsistentRead: true,
		}),
	);
	return toSession(result.Item);
}

async function create(input) {
	const data = quizSessionSchema.parse(input);
	const now = new Date().toISOString();
	const session = {
		_id: randomUUID().replaceAll('-', '').slice(0, 24),
		__v: 0,
		...data,
		isActive: true,
		createdAt: now,
		updatedAt: now,
	};
	await documentClient.send(
		new PutCommand({
			TableName: TABLE_NAME(),
			Item: session,
			ConditionExpression: 'attribute_not_exists(#quizId)',
			ExpressionAttributeNames: { '#quizId': 'quizId' },
		}),
	);
	return session;
}

async function scanAll() {
	const sessions = [];
	let ExclusiveStartKey;
	do {
		const result = await documentClient.send(
			new ScanCommand({
				TableName: TABLE_NAME(),
				ConsistentRead: true,
				ExclusiveStartKey,
			}),
		);
		sessions.push(...(result.Items || []));
		ExclusiveStartKey = result.LastEvaluatedKey;
	} while (ExclusiveStartKey);
	return sessions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function listByCreator(createdBy) {
	const sessions = [];
	let ExclusiveStartKey;
	do {
		const result = await documentClient.send(
			new QueryCommand({
				TableName: TABLE_NAME(),
				IndexName: 'createdBy-createdAt-index',
				KeyConditionExpression: '#createdBy = :createdBy',
				ExpressionAttributeNames: {
					'#createdBy': 'createdBy',
				},
				ExpressionAttributeValues: {
					':createdBy': createdBy,
				},
				ScanIndexForward: false,
				ExclusiveStartKey,
			}),
		);
		sessions.push(...(result.Items || []));
		ExclusiveStartKey = result.LastEvaluatedKey;
	} while (ExclusiveStartKey);
	return sessions;
}

async function update(quizId, updates) {
	const now = new Date().toISOString();
	const updateEntries = Object.entries({ ...updates, updatedAt: now });
	const ExpressionAttributeNames = {};
	const ExpressionAttributeValues = {};
	const UpdateExpression = `SET ${updateEntries
		.map(([key], index) => {
			ExpressionAttributeNames[`#field${index}`] = key;
			ExpressionAttributeValues[`:value${index}`] = updateEntries[index][1];
			return `#field${index} = :value${index}`;
		})
		.join(', ')}, #version = #version + :one`;
	ExpressionAttributeNames['#quizId'] = 'quizId';
	ExpressionAttributeNames['#version'] = '__v';
	ExpressionAttributeValues[':one'] = 1;

	try {
		const result = await documentClient.send(
			new UpdateCommand({
				TableName: TABLE_NAME(),
				Key: { quizId },
				UpdateExpression,
				ConditionExpression: 'attribute_exists(#quizId)',
				ExpressionAttributeNames,
				ExpressionAttributeValues,
				ReturnValues: 'ALL_NEW',
			}),
		);
		return result.Attributes;
	} catch (error) {
		if (error.name === 'ConditionalCheckFailedException') {
			return null;
		}
		throw error;
	}
}

async function deleteByQuizId(quizId) {
	await documentClient.send(
		new DeleteCommand({
			TableName: TABLE_NAME(),
			Key: { quizId },
		}),
	);
}

module.exports = {
	create,
	deleteByQuizId,
	findByQuizId,
	listAll: scanAll,
	listByCreator,
	update,
};
