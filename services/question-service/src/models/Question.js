const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema(
	{
		text: {
			type: String,
			required: true,
			trim: true,
		},
		options: {
			type: [
				{
					type: String,
					trim: true,
					validate: {
						validator: (option) => typeof option === 'string' && option.length > 0,
						message: 'Options must not be empty',
					},
				},
			],
			required: true,
			validate: {
				validator: (options) =>
					Array.isArray(options) && options.length >= 2 && options.length <= 6,
				message: 'A question must have between 2 and 6 options',
			},
		},
		correctIndex: {
			type: Number,
			required: true,
			validate: {
				validator(value) {
					const options = this.get('options');
					return (
						Number.isInteger(value) &&
						Array.isArray(options) &&
						value >= 0 &&
						value < options.length
					);
				},
				message: 'correctIndex must be a valid index into options',
			},
		},
		topic: {
			type: String,
			trim: true,
			lowercase: true,
		},
		createdBy: {
			type: String,
			required: true,
		},
	},
	{ timestamps: true },
);

module.exports = mongoose.model('Question', questionSchema);