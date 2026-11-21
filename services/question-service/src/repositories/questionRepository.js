const { randomInt, randomUUID } = require('node:crypto');
const {
	DeleteCommand,
	GetCommand,
	PutCommand,
	ScanCommand,
	UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const documentClient = require('./dynamoClient');
const { questionSchema } = require('../schemas/questionSchema');

function tableName() {
	const name = process.env.QUESTIONS_TABLE;
	if (!name) {
		throw new Error('QUESTIONS_TABLE is not configured');
	}
	return name;
}

function toQuestion(item) {
	if (!item) {
		return null;
	}
	const { questionId, ...question } = item;
	return { ...question, _id: item._id || questionId };
}

async function scanQuestions(topic) {
	const questions = [];
	let ExclusiveStartKey;
	do {
		const input = {
			TableName: tableName(),
			ConsistentRead: true,
			ExclusiveStartKey,
		};
		if (topic) {
			input.FilterExpression = '#topic = :topic';
			input.ExpressionAttributeNames = { '#topic': 'topic' };
			input.ExpressionAttributeValues = { ':topic': topic };
		}
		const result = await documentClient.send(new ScanCommand(input));
		questions.push(...(result.Items || []).map(toQuestion));
		ExclusiveStartKey = result.LastEvaluatedKey;
	} while (ExclusiveStartKey);
	return questions;
}

async function create(input) {
	const data = questionSchema.parse(input);
	const now = new Date().toISOString();
	const id = randomUUID().replaceAll('-', '').slice(0, 24);
	const question = {
		_id: id,
		questionId: id,
		__v: 0,
		...data,
		createdAt: now,
		updatedAt: now,
	};
	await documentClient.send(
		new PutCommand({
			TableName: tableName(),
			Item: question,
			ConditionExpression: 'attribute_not_exists(#questionId)',
			ExpressionAttributeNames: { '#questionId': 'questionId' },
		}),
	);
	return toQuestion(question);
}

async function countByTopic(topic) {
	return (await scanQuestions(topic)).length;
}

async function findRandomByTopic(topic, count) {
	const questions = await scanQuestions(topic);
	const sampleSize = Math.min(count, questions.length);
	for (let index = 0; index < sampleSize; index += 1) {
		const swapIndex = index + randomInt(questions.length - index);
		[questions[index], questions[swapIndex]] = [questions[swapIndex], questions[index]];
	}
	return {
		available: questions.length,
		questions: questions.slice(0, sampleSize).map(({ _id, text, options }) => ({
			_id,
			text,
			options,
		})),
	};
}

async function findAnswersByIds(ids) {
	if (ids.length === 0) {
		return [];
	}
	const questions = await scanQuestions();
	const idSet = new Set(ids.map((id) => id.toLowerCase()));
	return questions
		.filter((question) => idSet.has(question._id.toLowerCase()))
		.map(({ _id, correctIndex }) => ({ _id, correctIndex }));
}

async function list({ topic, page, limit }) {
	const questions = await scanQuestions(topic);
	questions.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	return {
		questions: questions.slice((page - 1) * limit, page * limit),
		total: questions.length,
	};
}

async function findById(id) {
	const result = await documentClient.send(
		new GetCommand({
			TableName: tableName(),
			Key: { questionId: id.toLowerCase() },
			ConsistentRead: true,
		}),
	);
	return toQuestion(result.Item);
}

async function update(id, updates) {
	const existing = await findById(id);
	if (!existing) {
		return null;
	}
	const validated = questionSchema.parse({
		text: Object.hasOwn(updates, 'text') ? updates.text : existing.text,
		options: Object.hasOwn(updates, 'options') ? updates.options : existing.options,
		correctIndex: Object.hasOwn(updates, 'correctIndex')
			? updates.correctIndex
			: existing.correctIndex,
		topic: Object.hasOwn(updates, 'topic') ? updates.topic : existing.topic,
		createdBy: existing.createdBy,
	});
	const entries = Object.entries(validated).filter(
		([key, value]) => key !== 'createdBy' && value !== undefined,
	);
	const ExpressionAttributeNames = { '#questionId': 'questionId' };
	const ExpressionAttributeValues = { ':updatedAt': new Date().toISOString(), ':one': 1 };
	const assignments = entries.map(([key, value], index) => {
		ExpressionAttributeNames[`#field${index}`] = key;
		ExpressionAttributeValues[`:value${index}`] = value;
		return `#field${index} = :value${index}`;
	});
	ExpressionAttributeNames['#updatedAt'] = 'updatedAt';
	ExpressionAttributeNames['#version'] = '__v';

	try {
		const result = await documentClient.send(
			new UpdateCommand({
				TableName: tableName(),
				Key: { questionId: id.toLowerCase() },
				UpdateExpression: `SET ${assignments.join(', ')}, #updatedAt = :updatedAt, #version = #version + :one`,
				ConditionExpression: 'attribute_exists(#questionId)',
				ExpressionAttributeNames,
				ExpressionAttributeValues,
				ReturnValues: 'ALL_NEW',
			}),
		);
		return toQuestion(result.Attributes);
	} catch (error) {
		if (error.name === 'ConditionalCheckFailedException') {
			return null;
		}
		throw error;
	}
}

async function deleteById(id) {
	try {
		const result = await documentClient.send(
			new DeleteCommand({
				TableName: tableName(),
				Key: { questionId: id.toLowerCase() },
				ConditionExpression: 'attribute_exists(#questionId)',
				ExpressionAttributeNames: { '#questionId': 'questionId' },
				ReturnValues: 'ALL_OLD',
			}),
		);
		return toQuestion(result.Attributes);
	} catch (error) {
		if (error.name === 'ConditionalCheckFailedException') {
			return null;
		}
		throw error;
	}
}

module.exports = {
	countByTopic,
	create,
	deleteById,
	findAnswersByIds,
	findById,
	findRandomByTopic,
	list,
	update,
};
