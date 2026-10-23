const express = require('express');
const mongoose = require('mongoose');
const QuizAssignment = require('../models/QuizAssignment');
const QuizSession = require('../models/QuizSession');
const internalOnly = require('../middleware/internalOnly');
const requireRole = require('../middleware/requireRole');
const verifyToken = require('../middleware/verifyToken');
const { countQuestions, getRandomQuestions } = require('../clients/questionClient');

const router = express.Router();
const quizManager = [verifyToken, requireRole('admin', 'teacher')];
const studentOnly = [verifyToken, requireRole('student')];

function normalize(value) {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isDuplicateKeyError(error) {
	return error && error.code === 11000;
}

function isValidationError(error) {
	return (
		error instanceof mongoose.Error.ValidationError ||
		error instanceof mongoose.Error.CastError
	);
}

function sendRouteError(res, error, context) {
	if (error && error.upstream) {
		return res.status(502).json({ error: 'Question service unavailable' });
	}
	if (isValidationError(error)) {
		return res.status(400).json({ error: error.message });
	}

	console.error(context, error);
	return res.status(500).json({ error: 'Internal server error' });
}

function assignmentResponse(assignment) {
	return {
		quizId: assignment.quizId,
		questionCount: assignment.questions.length,
		status: assignment.status,
		questions: assignment.questions.map(({ questionId, text, options }) => ({
			questionId,
			text,
			options,
		})),
	};
}

router.get('/internal/assignment', internalOnly, async (req, res) => {
	try {
		const quizId = normalize(req.query.quizId);
		const studentEmail = normalize(req.query.studentEmail);
		if (!quizId || !studentEmail) {
			return res.status(400).json({ error: 'quizId and studentEmail are required' });
		}

		const assignment = await QuizAssignment.findOne({ quizId, studentEmail });
		if (!assignment) {
			return res.status(404).json({ error: 'Assignment not found' });
		}

		const session = await QuizSession.findOne({ quizId }).select('revealScore').lean();
		if (!session) {
			return res.status(404).json({ error: 'Assignment not found' });
		}

		return res.status(200).json({
			quizId: assignment.quizId,
			studentEmail: assignment.studentEmail,
			status: assignment.status,
			questionIds: assignment.questions.map(({ questionId }) => questionId),
			revealScore: session.revealScore,
		});
	} catch (error) {
		return sendRouteError(res, error, 'Failed to retrieve quiz assignment');
	}
});

router.post('/internal/assignment/complete', internalOnly, async (req, res) => {
	try {
		const quizId = normalize(req.body && req.body.quizId);
		const studentEmail = normalize(req.body && req.body.studentEmail);
		if (!quizId || !studentEmail) {
			return res.status(400).json({ error: 'quizId and studentEmail are required' });
		}

		const assignment = await QuizAssignment.findOneAndUpdate(
			{ quizId, studentEmail, status: 'assigned' },
			{ $set: { status: 'completed', completedAt: new Date() } },
			{ new: true, runValidators: true },
		);
		if (!assignment) {
			return res.status(409).json({
				error: 'Assignment not found or already completed',
			});
		}

		return res.status(200).json({ quizId: assignment.quizId, status: assignment.status });
	} catch (error) {
		return sendRouteError(res, error, 'Failed to complete quiz assignment');
	}
});

router.post('/', ...quizManager, async (req, res) => {
	try {
		const body = req.body || {};
		const session = new QuizSession({
			quizId: normalize(body.quizId),
			questionCount: body.questionCount,
			revealScore: body.revealScore,
			topic: normalize(body.topic) || undefined,
			createdBy: req.user.email,
		});
		await session.validate();

		const available = await countQuestions(session.topic);
		if (available < session.questionCount) {
			return res.status(422).json({
				error: 'Not enough questions available',
				requested: session.questionCount,
				available,
			});
		}

		await session.save();
		return res.status(201).json(session);
	} catch (error) {
		if (isDuplicateKeyError(error)) {
			return res.status(409).json({ error: 'Quiz ID already exists' });
		}

		return sendRouteError(res, error, 'Failed to create quiz');
	}
});

router.get('/', ...quizManager, async (req, res) => {
	try {
		const filter = req.user.role === 'admin' ? {} : { createdBy: req.user.email };
		const sessions = await QuizSession.find(filter).sort({ createdAt: -1 });
		return res.status(200).json(sessions);
	} catch (error) {
		return sendRouteError(res, error, 'Failed to list quizzes');
	}
});

router.post('/:quizId/start', ...studentOnly, async (req, res) => {
	try {
		const quizId = normalize(req.params.quizId);
		const session = await QuizSession.findOne({ quizId });
		if (!session) {
			return res.status(404).json({ error: 'Quiz not found' });
		}
		if (!session.isActive) {
			return res.status(403).json({ error: 'Quiz is not active' });
		}

		const studentEmail = normalize(req.user.email);
		const existingAssignment = await QuizAssignment.findOne({ quizId, studentEmail });
		if (existingAssignment) {
			if (existingAssignment.status === 'completed') {
				return res.status(409).json({ error: 'Quiz already completed' });
			}

			return res.status(200).json(assignmentResponse(existingAssignment));
		}

		const randomResult = await getRandomQuestions(session.questionCount, session.topic);
		if (Object.prototype.hasOwnProperty.call(randomResult, 'available')) {
			return res.status(409).json({
				error: 'Not enough questions available right now',
			});
		}

		const questions = randomResult.questions.map(({ _id, text, options }) => ({
			questionId: String(_id),
			text,
			options,
		}));
		const assignment = new QuizAssignment({
			quizId,
			studentEmail,
			questions,
		});

		try {
			await assignment.save();
			return res.status(201).json(assignmentResponse(assignment));
		} catch (error) {
			if (!isDuplicateKeyError(error)) {
				throw error;
			}

			const concurrentAssignment = await QuizAssignment.findOne({ quizId, studentEmail });
			if (!concurrentAssignment) {
				throw error;
			}
			if (concurrentAssignment.status === 'completed') {
				return res.status(409).json({ error: 'Quiz already completed' });
			}

			return res.status(200).json(assignmentResponse(concurrentAssignment));
		}
	} catch (error) {
		return sendRouteError(res, error, 'Failed to start quiz');
	}
});

router.get('/:quizId', ...quizManager, async (req, res) => {
	try {
		const filter = { quizId: normalize(req.params.quizId) };
		if (req.user.role !== 'admin') {
			filter.createdBy = req.user.email;
		}

		const session = await QuizSession.findOne(filter);
		if (!session) {
			return res.status(404).json({ error: 'Quiz not found' });
		}

		return res.status(200).json(session);
	} catch (error) {
		return sendRouteError(res, error, 'Failed to retrieve quiz');
	}
});

router.patch('/:quizId', ...quizManager, async (req, res) => {
	try {
		const quizId = normalize(req.params.quizId);
		const session = await QuizSession.findOne({ quizId });
		if (!session) {
			return res.status(404).json({ error: 'Quiz not found' });
		}
		if (req.user.role !== 'admin' && session.createdBy !== req.user.email) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		const updates = {};
		for (const field of ['revealScore', 'isActive']) {
			if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
				updates[field] = req.body[field];
			}
		}

		if (Object.keys(updates).length) {
			session.set(updates);
			await session.save();
		}
		return res.status(200).json(session);
	} catch (error) {
		return sendRouteError(res, error, 'Failed to update quiz');
	}
});

router.delete('/:quizId', ...quizManager, async (req, res) => {
	try {
		const quizId = normalize(req.params.quizId);
		const session = await QuizSession.findOne({ quizId });
		if (!session) {
			return res.status(404).json({ error: 'Quiz not found' });
		}
		if (req.user.role !== 'admin' && session.createdBy !== req.user.email) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		const hasAssignments = await QuizAssignment.exists({ quizId });
		if (hasAssignments) {
			return res.status(409).json({
				error: 'Quiz has student attempts; deactivate it instead',
			});
		}

		await QuizSession.deleteOne({ _id: session._id });
		return res.status(200).json({ message: 'Quiz deleted' });
	} catch (error) {
		return sendRouteError(res, error, 'Failed to delete quiz');
	}
});

module.exports = router;
