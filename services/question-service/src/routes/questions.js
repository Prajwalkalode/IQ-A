const express = require('express');
const { ZodError } = require('zod');
const questionRepository = require('../repositories/questionRepository');
const { questionSchema } = require('../schemas/questionSchema');
const internalOnly = require('../middleware/internalOnly');
const requireRole = require('../middleware/requireRole');
const verifyToken = require('../middleware/verifyToken');

const router = express.Router();
const questionManager = [verifyToken, requireRole('admin', 'teacher')];
const questionIdPattern = /^[a-f\d]{24}$/i;

function isQuestionId(value) {
	return typeof value === 'string' && questionIdPattern.test(value);
}

function parsePositiveInteger(value) {
	if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
		return null;
	}

	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

router.get('/internal/random', internalOnly, async (req, res) => {
	try {
		const count = parsePositiveInteger(req.query.count);
		if (!count) {
			return res.status(400).json({ error: 'count must be a positive integer' });
		}

		const topic =
			typeof req.query.topic === 'string' && req.query.topic.trim()
				? req.query.topic.trim().toLowerCase()
				: undefined;
		const { available, questions } = await questionRepository.findRandomByTopic(
			topic,
			count,
		);

		const response = { questions };
		if (available < count) {
			response.available = available;
		}

		return res.status(200).json(response);
	} catch (error) {
		console.error('Failed to select random questions', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.get('/internal/count', internalOnly, async (req, res) => {
	try {
		const topic =
			typeof req.query.topic === 'string' && req.query.topic.trim()
				? req.query.topic.trim().toLowerCase()
				: undefined;
		const available = await questionRepository.countByTopic(topic);
		return res.status(200).json({ available });
	} catch (error) {
		console.error('Failed to count questions', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.post('/internal/answers', internalOnly, async (req, res) => {
	try {
		const { ids } = req.body || {};
		if (!Array.isArray(ids) || ids.some((id) => !isQuestionId(id))) {
			return res.status(400).json({ error: 'ids must be an array of valid question IDs' });
		}

		const questions = await questionRepository.findAnswersByIds(ids);
		return res.status(200).json(questions);
	} catch (error) {
		console.error('Failed to retrieve question answers', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.post('/', ...questionManager, async (req, res) => {
	try {
		const body = req.body || {};
		const questionInput = questionSchema.parse({
			text: body.text,
			options: body.options,
			correctIndex: body.correctIndex,
			topic: body.topic,
			createdBy: req.user.email,
		});
		const question = await questionRepository.create(questionInput);
		return res.status(201).json(question);
	} catch (error) {
		if (error instanceof ZodError) {
			return res.status(400).json({ error: error.message });
		}

		console.error('Failed to create question', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.get('/', ...questionManager, async (req, res) => {
	try {
		const page = req.query.page === undefined ? 1 : parsePositiveInteger(req.query.page);
		const requestedLimit =
			req.query.limit === undefined ? 20 : parsePositiveInteger(req.query.limit);
		if (!page || !requestedLimit) {
			return res.status(400).json({ error: 'page and limit must be positive integers' });
		}

		const limit = Math.min(requestedLimit, 100);
		if (!Number.isSafeInteger((page - 1) * limit)) {
			return res.status(400).json({ error: 'page and limit must be positive integers' });
		}

		const topic =
			typeof req.query.topic === 'string' && req.query.topic.trim()
				? req.query.topic.trim().toLowerCase()
				: undefined;
		const { questions, total } = await questionRepository.list({
			topic,
			page,
			limit,
		});

		return res.status(200).json({ questions, total, page, limit });
	} catch (error) {
		console.error('Failed to list questions', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.get('/:id', ...questionManager, async (req, res) => {
	try {
		if (!isQuestionId(req.params.id)) {
			return res.status(400).json({ error: 'Invalid question ID' });
		}

		const question = await questionRepository.findById(req.params.id);
		if (!question) {
			return res.status(404).json({ error: 'Question not found' });
		}

		return res.status(200).json(question);
	} catch (error) {
		console.error('Failed to retrieve question', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.put('/:id', ...questionManager, async (req, res) => {
	try {
		if (!isQuestionId(req.params.id)) {
			return res.status(400).json({ error: 'Invalid question ID' });
		}

		const updates = {};
		for (const field of ['text', 'options', 'correctIndex', 'topic']) {
			if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
				updates[field] = req.body[field];
			}
		}

		const existingQuestion = await questionRepository.findById(req.params.id);
		if (!existingQuestion) {
			return res.status(404).json({ error: 'Question not found' });
		}

		const validatedQuestion = questionSchema.parse({
			text: Object.hasOwn(updates, 'text') ? updates.text : existingQuestion.text,
			options: Object.hasOwn(updates, 'options')
				? updates.options
				: existingQuestion.options,
			correctIndex: Object.hasOwn(updates, 'correctIndex')
				? updates.correctIndex
				: existingQuestion.correctIndex,
			topic: Object.hasOwn(updates, 'topic') ? updates.topic : existingQuestion.topic,
			createdBy: existingQuestion.createdBy,
		});

		const question = await questionRepository.update(req.params.id, validatedQuestion);
		if (!question) {
			return res.status(404).json({ error: 'Question not found' });
		}

		return res.status(200).json(question);
	} catch (error) {
		if (error instanceof ZodError) {
			return res.status(400).json({ error: error.message });
		}

		console.error('Failed to update question', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.delete('/:id', ...questionManager, async (req, res) => {
	try {
		if (!isQuestionId(req.params.id)) {
			return res.status(400).json({ error: 'Invalid question ID' });
		}

		const question = await questionRepository.deleteById(req.params.id);
		if (!question) {
			return res.status(404).json({ error: 'Question not found' });
		}

		return res.status(200).json({ message: 'Question deleted' });
	} catch (error) {
		console.error('Failed to delete question', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

module.exports = router;