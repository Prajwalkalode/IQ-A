const express = require('express');
const mongoose = require('mongoose');
const Submission = require('../models/Submission');
const verifyToken = require('../middleware/verifyToken');
const requireRole = require('../middleware/requireRole');
const quizClient = require('../clients/quizClient');
const questionClient = require('../clients/questionClient');

const router = express.Router();
const studentOnly = [verifyToken, requireRole('student')];
const quizManager = [verifyToken, requireRole('admin', 'teacher')];

function normalize(value) {
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function percentage(score, total) {
	return total === 0 ? null : Math.round((score / total) * 100);
}

function sendError(res, error, context) {
	if (error && error.upstream) {
		return res.status(502).json({ error: 'Upstream service unavailable' });
	}
	if (
		error instanceof mongoose.Error.ValidationError ||
		error instanceof mongoose.Error.CastError
	) {
		return res.status(400).json({ error: error.message });
	}

	console.error(context, error);
	return res.status(500).json({ error: 'Internal server error' });
}

function validateSubmissionBody(body) {
	if (typeof body.quizId !== 'string' || !normalize(body.quizId)) {
		return 'quizId is required';
	}
	if (!Array.isArray(body.answers) || body.answers.length > 100) {
		return 'answers must be an array with at most 100 items';
	}

	const questionIds = new Set();
	for (const answer of body.answers) {
		if (
			!answer ||
			typeof answer !== 'object' ||
			Array.isArray(answer) ||
			typeof answer.questionId !== 'string' ||
			answer.questionId.length === 0 ||
			!(
				answer.selectedIndex === null ||
				(Number.isInteger(answer.selectedIndex) &&
					answer.selectedIndex >= 0 &&
					answer.selectedIndex <= 5)
			)
		) {
			return 'Each answer must include a questionId and a selectedIndex from 0 to 5 or null';
		}
		if (questionIds.has(answer.questionId)) {
			return 'Duplicate questionIds are not allowed';
		}
		questionIds.add(answer.questionId);
	}

	return null;
}

router.post('/', ...studentOnly, async (req, res) => {
	try {
		const body = req.body || {};
		const validationError = validateSubmissionBody(body);
		if (validationError) {
			return res.status(400).json({ error: validationError });
		}

		const quizId = normalize(body.quizId);
		const studentEmail = normalize(req.user.email);
		const existingSubmission = await Submission.findOne({ quizId, studentEmail });
		if (existingSubmission) {
			return res.status(409).json({ error: 'Already submitted' });
		}

		const assignment = await quizClient.getAssignment(quizId, studentEmail);
		if (!assignment) {
			return res.status(404).json({ error: 'Quiz not started' });
		}
		if (assignment.status === 'completed') {
			return res.status(409).json({ error: 'Quiz already completed' });
		}

		const assignedIds = assignment.questionIds;
		const assignedIdSet = new Set(assignedIds);
		const offendingIds = body.answers
			.map(({ questionId }) => questionId)
			.filter((questionId) => !assignedIdSet.has(questionId));
		if (offendingIds.length) {
			return res.status(400).json({
				error: 'Answers include questions not assigned to this quiz',
				offendingIds,
			});
		}

		const answersById = new Map(
			body.answers.map(({ questionId, selectedIndex }) => [questionId, selectedIndex]),
		);
		const answerKey = await questionClient.getAnswers(assignedIds);
		const correctIndices = new Map(
			answerKey.map(({ _id, correctIndex }) => [String(_id), correctIndex]),
		);
		const results = [];
		let score = 0;
		let voided = 0;

		for (const questionId of assignedIds) {
			const correctIndex = correctIndices.get(questionId);
			if (correctIndex === undefined) {
				voided += 1;
				continue;
			}

			const selectedIndex = answersById.has(questionId)
				? answersById.get(questionId)
				: null;
			const isCorrect = selectedIndex === correctIndex;
			if (isCorrect) {
				score += 1;
			}
			results.push({ questionId, selectedIndex, correctIndex, isCorrect });
		}

		const submission = new Submission({
			quizId,
			studentEmail,
			results,
			score,
			total: results.length,
			voided,
		});

		try {
			await submission.save();
		} catch (error) {
			if (error && error.code === 11000) {
				return res.status(409).json({ error: 'Already submitted' });
			}
			throw error;
		}

		try {
			await quizClient.completeAssignment(quizId, studentEmail);
		} catch (error) {
			console.error('Failed to complete quiz assignment after submission', error);
		}

		const response = {
			message: 'Submitted',
			submittedAt: submission.submittedAt,
		};
		if (assignment.revealScore) {
			response.score = score;
			response.total = results.length;
			response.percentage = percentage(score, results.length);
		}

		return res.status(201).json(response);
	} catch (error) {
		return sendError(res, error, 'Failed to submit quiz answers');
	}
});

router.get('/quiz/:quizId/mine', ...studentOnly, async (req, res) => {
	try {
		const quizId = normalize(req.params.quizId);
		const studentEmail = normalize(req.user.email);
		const submission = await Submission.findOne({ quizId, studentEmail });
		if (!submission) {
			return res.status(404).json({ error: 'Submission not found' });
		}

		const assignment = await quizClient.getAssignment(quizId, studentEmail);
		const response = {
			quizId: submission.quizId,
			submittedAt: submission.submittedAt,
			status: 'submitted',
		};
		if (assignment && assignment.revealScore) {
			response.score = submission.score;
			response.total = submission.total;
			response.percentage = percentage(submission.score, submission.total);
		}

		return res.status(200).json(response);
	} catch (error) {
		return sendError(res, error, 'Failed to retrieve student submission');
	}
});

router.get('/quiz/:quizId', ...quizManager, async (req, res) => {
	try {
		const quizId = normalize(req.params.quizId);
		const session = await quizClient.getSession(quizId);
		if (!session) {
			return res.status(404).json({ error: 'Quiz not found' });
		}
		if (
			req.user.role !== 'admin' &&
			normalize(session.createdBy) !== normalize(req.user.email)
		) {
			return res.status(403).json({ error: 'Forbidden' });
		}

		const submissions = await Submission.find({ quizId })
			.sort({ submittedAt: -1 })
			.lean();
		const summaryPercentages = submissions
			.map(({ score, total }) => percentage(score, total))
			.filter((value) => value !== null);
		const averagePercentage = summaryPercentages.length
			? summaryPercentages.reduce((sum, value) => sum + value, 0) /
				summaryPercentages.length
			: null;

		return res.status(200).json({
			quizId,
			summary: {
				submissions: submissions.length,
				averagePercentage,
			},
			submissions: submissions.map((submission) => ({
				studentEmail: submission.studentEmail,
				score: submission.score,
				total: submission.total,
				percentage: percentage(submission.score, submission.total),
				voided: submission.voided,
				submittedAt: submission.submittedAt,
			})),
		});
	} catch (error) {
		return sendError(res, error, 'Failed to retrieve quiz submissions');
	}
});

module.exports = router;