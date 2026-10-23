class QuizServiceError extends Error {
	constructor(message, cause) {
		super(message, { cause });
		this.name = 'QuizServiceError';
		this.upstream = true;
	}
}

function quizServiceUrl(path) {
	const baseUrl = process.env.QUIZ_SERVICE_URL;
	if (!baseUrl) {
		throw new QuizServiceError('QUIZ_SERVICE_URL is not configured');
	}

	return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

async function requestQuizService(path, options = {}, acceptedStatuses = []) {
	if (!process.env.INTERNAL_API_KEY) {
		throw new QuizServiceError('INTERNAL_API_KEY is not configured');
	}

	let response;
	try {
		response = await fetch(quizServiceUrl(path), {
			...options,
			headers: {
				'x-internal-key': process.env.INTERNAL_API_KEY,
				...(options.body ? { 'content-type': 'application/json' } : {}),
				...options.headers,
			},
			signal: AbortSignal.timeout(5000),
		});
	} catch (error) {
		throw new QuizServiceError('Quiz service request failed', error);
	}

	if (acceptedStatuses.includes(response.status)) {
		return { status: response.status, body: null };
	}
	if (!response.ok) {
		throw new QuizServiceError(`Quiz service returned ${response.status}`);
	}

	try {
		return { status: response.status, body: await response.json() };
	} catch (error) {
		throw new QuizServiceError('Quiz service returned an invalid response', error);
	}
}

function validateAssignment(assignment) {
	if (
		!assignment ||
		typeof assignment.quizId !== 'string' ||
		typeof assignment.studentEmail !== 'string' ||
		!['assigned', 'completed'].includes(assignment.status) ||
		!Array.isArray(assignment.questionIds) ||
		typeof assignment.revealScore !== 'boolean' ||
		assignment.questionIds.some((id) => typeof id !== 'string')
	) {
		throw new QuizServiceError('Quiz service returned an invalid assignment');
	}

	return assignment;
}

function validateSession(session) {
	if (
		!session ||
		typeof session.quizId !== 'string' ||
		typeof session.createdBy !== 'string' ||
		!Number.isSafeInteger(session.questionCount) ||
		typeof session.revealScore !== 'boolean' ||
		typeof session.isActive !== 'boolean'
	) {
		throw new QuizServiceError('Quiz service returned an invalid session');
	}

	return session;
}

async function getAssignment(quizId, studentEmail) {
	const query = new URLSearchParams({ quizId, studentEmail });
	const response = await requestQuizService(
		`/quiz/internal/assignment?${query.toString()}`,
		{},
		[404],
	);
	if (response.status === 404) {
		return null;
	}

	return validateAssignment(response.body);
}

async function completeAssignment(quizId, studentEmail) {
	await requestQuizService(
		'/quiz/internal/assignment/complete',
		{
			method: 'POST',
			body: JSON.stringify({ quizId, studentEmail }),
		},
		[409],
	);
}

async function getSession(quizId) {
	const query = new URLSearchParams({ quizId });
	const response = await requestQuizService(
		`/quiz/internal/session?${query.toString()}`,
		{},
		[404],
	);
	if (response.status === 404) {
		return null;
	}

	return validateSession(response.body);
}

module.exports = { getAssignment, completeAssignment, getSession };
