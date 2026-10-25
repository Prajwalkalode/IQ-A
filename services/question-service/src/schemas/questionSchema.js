const { z } = require('zod');

const questionSchema = z.object({
	text: z.string().trim().min(1),
	options: z
		.array(z.string().trim().min(1, 'Options must not be empty'))
		.min(2, 'A question must have between 2 and 6 options')
		.max(6, 'A question must have between 2 and 6 options'),
	correctIndex: z.preprocess(
		(value) => (typeof value === 'string' && value.trim() ? Number(value) : value),
		z.number().int(),
	),
	topic: z.string().trim().toLowerCase().optional(),
	createdBy: z.string().min(1),
}).superRefine((question, context) => {
	if (question.correctIndex < 0 || question.correctIndex >= question.options.length) {
		context.addIssue({
			code: 'custom',
			path: ['correctIndex'],
			message: 'correctIndex must be a valid index into options',
		});
	}
});

module.exports = { questionSchema };
