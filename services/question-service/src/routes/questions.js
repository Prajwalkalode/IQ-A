const express = require('express');
const mongoose = require('mongoose');
const Question = require('../models/Question');
const internalOnly = require('../middleware/internalOnly');
const requireRole = require('../middleware/requireRole');
const verifyToken = require('../middleware/verifyToken');

const router = express.Router();
const questionManager = [verifyToken, requireRole('admin', 'teacher')];

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

		const match = {};
		if (typeof req.query.topic === 'string' && req.query.topic.trim()) {
			match.topic = req.query.topic.trim().toLowerCase();
		}

		const [available, questions] = await Promise.all([
			Question.countDocuments(match),
			Question.aggregate([
				...(Object.keys(match).length ? [{ $match: match }] : []),
				{ $sample: { size: count } },
				{ $project: { _id: 1, text: 1, options: 1 } },
			]),
		]);

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
		const filter = {};
		if (typeof req.query.topic === 'string' && req.query.topic.trim()) {
			filter.topic = req.query.topic.trim().toLowerCase();
		}

		const available = await Question.countDocuments(filter);
		return res.status(200).json({ available });
	} catch (error) {
		console.error('Failed to count questions', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.post('/internal/answers', internalOnly, async (req, res) => {
	try {
		const { ids } = req.body || {};
		if (
			!Array.isArray(ids) ||
			ids.some((id) => !mongoose.isObjectIdOrHexString(id))
		) {
			return res.status(400).json({ error: 'ids must be an array of valid question IDs' });
		}

		const questions = await Question.find({ _id: { $in: ids } })
			.select('_id correctIndex')
			.lean();
		return res.status(200).json(
			questions.map(({ _id, correctIndex }) => ({ _id, correctIndex })),
		);
	} catch (error) {
		console.error('Failed to retrieve question answers', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.post('/', ...questionManager, async (req, res) => {
	try {
		const { text, options, correctIndex, topic } = req.body || {};
		const question = await Question.create({
			text,
			options,
			correctIndex,
			topic,
			createdBy: req.user.email,
		});
		return res.status(201).json(question);
	} catch (error) {
		if (
			error instanceof mongoose.Error.ValidationError ||
			error instanceof mongoose.Error.CastError
		) {
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

		const filter = {};
		if (typeof req.query.topic === 'string' && req.query.topic.trim()) {
			filter.topic = req.query.topic.trim().toLowerCase();
		}

		const [questions, total] = await Promise.all([
			Question.find(filter)
				.sort({ createdAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit),
			Question.countDocuments(filter),
		]);

		return res.status(200).json({ questions, total, page, limit });
	} catch (error) {
		console.error('Failed to list questions', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.get('/:id', ...questionManager, async (req, res) => {
	try {
		if (!mongoose.isObjectIdOrHexString(req.params.id)) {
			return res.status(400).json({ error: 'Invalid question ID' });
		}

		const question = await Question.findById(req.params.id);
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
		if (!mongoose.isObjectIdOrHexString(req.params.id)) {
			return res.status(400).json({ error: 'Invalid question ID' });
		}

		const updates = {};
		for (const field of ['text', 'options', 'correctIndex', 'topic']) {
			if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
				updates[field] = req.body[field];
			}
		}

		const existingQuestion = await Question.findById(req.params.id);
		if (!existingQuestion) {
			return res.status(404).json({ error: 'Question not found' });
		}

		const values = {
			text: Object.prototype.hasOwnProperty.call(updates, 'text')
				? updates.text
				: existingQuestion.text,
			options: Object.prototype.hasOwnProperty.call(updates, 'options')
				? updates.options
				: existingQuestion.options,
			correctIndex: Object.prototype.hasOwnProperty.call(updates, 'correctIndex')
				? updates.correctIndex
				: existingQuestion.correctIndex,
		};
		if (Object.prototype.hasOwnProperty.call(updates, 'topic')) {
			values.topic = updates.topic;
		} else if (existingQuestion.topic !== undefined) {
			values.topic = existingQuestion.topic;
		}

		const question = await Question.findByIdAndUpdate(
			req.params.id,
			{ $set: values },
			{ new: true, runValidators: true },
		);
		if (!question) {
			return res.status(404).json({ error: 'Question not found' });
		}

		return res.status(200).json(question);
	} catch (error) {
		if (
			error instanceof mongoose.Error.ValidationError ||
			error instanceof mongoose.Error.CastError
		) {
			return res.status(400).json({ error: error.message });
		}

		console.error('Failed to update question', error);
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.delete('/:id', ...questionManager, async (req, res) => {
	try {
		if (!mongoose.isObjectIdOrHexString(req.params.id)) {
			return res.status(400).json({ error: 'Invalid question ID' });
		}

		const question = await Question.findByIdAndDelete(req.params.id);
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