const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({
	region: process.env.AWS_REGION,
});

const documentClient = DynamoDBDocumentClient.from(dynamoClient, {
	marshallOptions: {
		removeUndefinedValues: true,
	},
});

module.exports = documentClient;
