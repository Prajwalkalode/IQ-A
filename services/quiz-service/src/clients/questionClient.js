class QuestionServiceError extends Error {
	constructor(message, cause) {
		super(message, { cause });
		this.name = 'QuestionServiceError';
		this.upstream = true;
	}
}

function questionServiceUrl(path) {
	const baseUrl = process.env.QUESTION_SERVICE_URL;
	if (!baseUrl) {
		throw new QuestionServiceError('QUESTION_SERVICE_URL is not configured');
	}

	return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

async function requestQuestionService(path) {
	if (!process.env.INTERNAL_API_KEY) {
		throw new QuestionServiceError('INTERNAL_API_KEY is not configured');
	}

	let response;
	try {
		response = await fetch(questionServiceUrl(path), {
			headers: { 'x-internal-key': process.env.INTERNAL_API_KEY },
			signal: AbortSignal.timeout(5000),
		});
	} catch (error) {
		throw new QuestionServiceError('Question service request failed', error);
	}

	if (!response.ok) {
		throw new QuestionServiceError(`Question service returned ${response.status}`);
	}

	try {
		return await response.json();
	} catch (error) {
		throw new QuestionServiceError('Question service returned an invalid response', error);
	}
}

function topicQuery(topic) {
	return typeof topic === 'string' && topic.trim()
		? `&topic=${encodeURIComponent(topic.trim().toLowerCase())}`
		: '';
}

async function countQuestions(topic) {
	const query =
		typeof topic === 'string' && topic.trim()
			? `?topic=${encodeURIComponent(topic.trim().toLowerCase())}`
			: '';
	const response = await requestQuestionService(`/questions/internal/count${query}`);
	if (
		!response ||
		!Number.isSafeInteger(response.available) ||
		response.available < 0
	) {
		throw new QuestionServiceError('Question service returned an invalid count');
	}

	return response.available;
}

async function getRandomQuestions(count, topic) {
	const response = await requestQuestionService(
		`/questions/internal/random?count=${encodeURIComponent(count)}${topicQuery(topic)}`,
	);
	if (!response || !Array.isArray(response.questions)) {
		throw new QuestionServiceError('Question service returned invalid questions');
	}
	if (
		Object.prototype.hasOwnProperty.call(response, 'available') &&
		(!Number.isSafeInteger(response.available) || response.available < 0)
	) {
		throw new QuestionServiceError('Question service returned an invalid count');
	}
	if (
		response.questions.some(
			(question) =>
				!question ||
				typeof question._id !== 'string' ||
				typeof question.text !== 'string' ||
				!Array.isArray(question.options) ||
				question.options.some((option) => typeof option !== 'string'),
		)
	) {
		throw new QuestionServiceError('Question service returned invalid questions');
	}

	return response;
}

module.exports = { countQuestions, getRandomQuestions };
