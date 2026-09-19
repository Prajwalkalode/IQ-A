const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
	{
		email: {
			type: String,
			required: true,
			unique: true,
			lowercase: true,
		},
		passwordHash: {
			type: String,
			required: true,
		},
		name: {
			type: String,
			required: true,
		},
		role: {
			type: String,
			enum: ['admin', 'teacher', 'student'],
			default: 'student',
		},
	},
	{ timestamps: true },
);

module.exports = mongoose.model('User', userSchema);
