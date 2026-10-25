const { z } = require('zod');

const schemaBoolean = z.preprocess((value) => {
	if (value === true || value === false) {
		return value;
	}
	if (value === 1 || value === '1' || value === 'true' || value === 'yes') {
		return true;
	}
	if (value === 0 || value === '0' || value === 'false' || value === 'no') {
		return false;
	}
	return value;
}, z.boolean());

const quizSessionSchema = z.object({
	quizId: z
		.string()
		.trim()
		.toLowerCase()
		.min(3)
		.max(40)
		.refine(
			(value) => value !== 'internal' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value),
			'quizId must be a valid non-reserved quiz ID',
		),
	questionCount: z.coerce.number().int().min(1).max(100),
	revealScore: schemaBoolean.default(false),
	topic: z.string().trim().toLowerCase().optional(),
	createdBy: z.string().min(1),
});

const quizSessionUpdateSchema = z.object({
	revealScore: schemaBoolean.optional(),
	isActive: schemaBoolean.optional(),
});

const quizAssignmentSchema = z.object({
	quizId: z.string().min(1).toLowerCase(),
	studentEmail: z.string().min(1).toLowerCase(),
	questions: z
		.array(
			z.object({
				questionId: z.string().min(1),
				text: z.string().min(1),
				options: z.array(z.string()).min(1),
			}),
		)
		.min(1),
	status: z.enum(['assigned', 'completed']).default('assigned'),
	startedAt: z.coerce.date().optional(),
	completedAt: z.coerce.date().optional(),
});

module.exports = {
	quizAssignmentSchema,
	quizSessionSchema,
	quizSessionUpdateSchema,
};
