const { randomUUID } = require('node:crypto');
const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const documentClient = require('./dynamoClient');
const { userSchema } = require('../schemas/userSchema');

function tableName() {
	const name = process.env.USERS_TABLE;
	if (!name) {
		throw new Error('USERS_TABLE is not configured');
	}
	return name;
}

function toUser(item) {
	if (!item) {
		return null;
	}
	const { userId, ...user } = item;
	return { ...user, _id: item._id || userId };
}

async function create(input) {
	const data = userSchema.parse(input);
	const now = new Date().toISOString();
	const id = randomUUID().replaceAll('-', '').slice(0, 24);
	const user = {
		_id: id,
		userId: id,
		__v: 0,
		...data,
		createdAt: now,
		updatedAt: now,
	};
	await documentClient.send(
		new PutCommand({
			TableName: tableName(),
			Item: user,
			ConditionExpression: 'attribute_not_exists(#email)',
			ExpressionAttributeNames: { '#email': 'email' },
		}),
	);
	return toUser(user);
}

async function findByEmail(email) {
	const result = await documentClient.send(
		new GetCommand({
			TableName: tableName(),
			Key: { email: email.toLowerCase() },
			ConsistentRead: true,
		}),
	);
	return toUser(result.Item);
}

module.exports = {
	create,
	findByEmail,
};
