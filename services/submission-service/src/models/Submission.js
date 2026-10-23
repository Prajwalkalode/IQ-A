const mongoose = require('mongoose');

const resultSchema = new mongoose.Schema(
	{
		questionId: {
			type: String,
			required: true,
		},
		selectedIndex: {
			type: Number,
			default: null,
		},
		correctIndex: {
			type: Number,
			required: true,
		},
		isCorrect: {
			type: Boolean,
			required: true,
		},
	},
	{ _id: false },
);

const submissionSchema = new mongoose.Schema(
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
		results: {
			type: [resultSchema],
			required: true,
		},
		score: {
			type: Number,
			required: true,
		},
		total: {
			type: Number,
			required: true,
		},
		voided: {
			type: Number,
			default: 0,
		},
		submittedAt: {
			type: Date,
			default: Date.now,
		},
	},
	{ timestamps: true },
);

submissionSchema.index({ quizId: 1, studentEmail: 1 }, { unique: true });

module.exports = mongoose.model('Submission', submissionSchema);