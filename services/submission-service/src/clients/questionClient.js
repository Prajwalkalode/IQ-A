const { resolveServiceUrl } = require('./serviceUrl');

class QuestionServiceError extends Error {
	constructor(message, cause) {
		super(message, { cause });
		this.name = 'QuestionServiceError';
		this.upstream = true;
	}
}

async function questionServiceUrl(path) {
	const baseUrl = await resolveServiceUrl(
		'QUESTION_SERVICE_URL',
		'QUESTION_SERVICE_URL_PARAMETER',
		QuestionServiceError,
	);
	return `${baseUrl}${path}`;
}

async function getAnswers(ids) {
	if (!process.env.INTERNAL_API_KEY) {
		throw new QuestionServiceError('INTERNAL_API_KEY is not configured');
	}

	let response;
	try {
		response = await fetch(await questionServiceUrl('/questions/internal/answers'), {
			method: 'POST',
			headers: {
				'x-internal-key': process.env.INTERNAL_API_KEY,
				'content-type': 'application/json',
			},
			body: JSON.stringify({ ids }),
			signal: AbortSignal.timeout(5000),
		});
	} catch (error) {
		throw new QuestionServiceError('Question service request failed', error);
	}

	if (!response.ok) {
		throw new QuestionServiceError(`Question service returned ${response.status}`);
	}

	let answers;
	try {
		answers = await response.json();
	} catch (error) {
		throw new QuestionServiceError('Question service returned an invalid response', error);
	}
	if (
		!Array.isArray(answers) ||
		answers.some(
			(answer) =>
				!answer ||
				typeof answer._id !== 'string' ||
				!Number.isInteger(answer.correctIndex),
		)
	) {
		throw new QuestionServiceError('Question service returned invalid answers');
	}

	return answers;
}

module.exports = { getAnswers };
