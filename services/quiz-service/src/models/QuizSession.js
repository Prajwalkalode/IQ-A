const mongoose = require('mongoose');

const quizSessionSchema = new mongoose.Schema(
	{
		quizId: {
			type: String,
			required: true,
			unique: true,
			trim: true,
			lowercase: true,
			minlength: 3,
			maxlength: 40,
			validate: {
				validator(value) {
					return value !== 'internal' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
				},
				message: 'quizId must be a valid non-reserved quiz ID',
			},
		},
		questionCount: {
			type: Number,
			required: true,
			min: 1,
			max: 100,
			validate: {
				validator: Number.isInteger,
				message: 'questionCount must be an integer',
			},
		},
		revealScore: {
			type: Boolean,
			default: false,
		},
		topic: {
			type: String,
			trim: true,
			lowercase: true,
		},
		isActive: {
			type: Boolean,
			default: true,
		},
		createdBy: {
			type: String,
			required: true,
		},
	},
	{ timestamps: true },
);

module.exports = mongoose.model('QuizSession', quizSessionSchema);
