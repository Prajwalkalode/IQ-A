const { z } = require('zod');

const userSchema = z.object({
	email: z.string().min(1).toLowerCase(),
	passwordHash: z.string().min(1),
	name: z.string().min(1),
	role: z.enum(['admin', 'teacher', 'student']).default('student'),
});

module.exports = { userSchema };
