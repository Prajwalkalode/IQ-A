const mongoose = require('mongoose');

const questionSnapshotSchema = new mongoose.Schema(
	{
		questionId: {
			type: String,
			required: true,
		},
		text: {
			type: String,
			required: true,
		},
		options: {
			type: [{ type: String }],
			required: true,
		},
	},
	{ _id: false },
);

const quizAssignmentSchema = new mongoose.Schema(
	{
		quizId: {
			type: String,
			required: true,
			lowercase: true,
		},
		studentEmail: {
			type: String,
			required: true,
			lowercase: true,
		},
		questions: {
			type: [questionSnapshotSchema],
			required: true,
		},
		status: {
			type: String,
			enum: ['assigned', 'completed'],
			default: 'assigned',
		},
		startedAt: {
			type: Date,
			default: Date.now,
		},
		completedAt: {
			type: Date,
		},
	},
	{ timestamps: true },
);

quizAssignmentSchema.index({ quizId: 1, studentEmail: 1 }, { unique: true });

module.exports = mongoose.model('QuizAssignment', quizAssignmentSchema);
