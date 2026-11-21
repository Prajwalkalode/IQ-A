const { randomUUID } = require('node:crypto');
const {
	GetCommand,
	PutCommand,
	QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const documentClient = require('./dynamoClient');
const { submissionSchema } = require('../schemas/submissionSchema');

function tableName() {
	const name = process.env.SUBMISSIONS_TABLE;
	if (!name) {
		throw new Error('SUBMISSIONS_TABLE is not configured');
	}
	return name;
}

function toSubmission(item) {
	if (!item) {
		return null;
	}
	const { submissionId, ...submission } = item;
	return { ...submission, _id: item._id || submissionId };
}

async function findByQuizAndStudent(quizId, studentEmail) {
	const result = await documentClient.send(
		new GetCommand({
			TableName: tableName(),
			Key: { quizId, studentEmail },
			ConsistentRead: true,
		}),
	);
	return toSubmission(result.Item);
}

async function create(input) {
	const data = submissionSchema.parse(input);
	const now = new Date().toISOString();
	const id = randomUUID().replaceAll('-', '').slice(0, 24);
	const submission = {
		submissionId: id,
		_id: id,
		__v: 0,
		...data,
		submittedAt: now,
		createdAt: now,
		updatedAt: now,
	};

	await documentClient.send(
		new PutCommand({
			TableName: tableName(),
			Item: submission,
			ConditionExpression: 'attribute_not_exists(#quizId)',
			ExpressionAttributeNames: { '#quizId': 'quizId' },
		}),
	);

	return toSubmission(submission);
}

async function listByQuiz(quizId) {
	const submissions = [];
	let ExclusiveStartKey;
	do {
		const result = await documentClient.send(
			new QueryCommand({
				TableName: tableName(),
				KeyConditionExpression: '#quizId = :quizId',
				ExpressionAttributeNames: { '#quizId': 'quizId' },
				ExpressionAttributeValues: { ':quizId': quizId },
				ConsistentRead: true,
				ExclusiveStartKey,
			}),
		);
		submissions.push(...(result.Items || []).map(toSubmission));
		ExclusiveStartKey = result.LastEvaluatedKey;
	} while (ExclusiveStartKey);
	return submissions.sort(
		(left, right) => right.submittedAt.localeCompare(left.submittedAt),
	);
}

module.exports = {
	create,
	findByQuizAndStudent,
	listByQuiz,
};
