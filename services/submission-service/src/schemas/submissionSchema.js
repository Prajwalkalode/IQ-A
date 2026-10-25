const { z } = require('zod');

const submissionSchema = z.object({
	quizId: z.string().min(1).toLowerCase(),
	studentEmail: z.string().min(1).toLowerCase(),
	results: z.array(
		z.object({
			questionId: z.string().min(1),
			selectedIndex: z.number().int().nullable(),
			correctIndex: z.number().int(),
			isCorrect: z.boolean(),
		}),
	),
	score: z.number().int().nonnegative(),
	total: z.number().int().nonnegative(),
	voided: z.number().int().nonnegative().default(0),
});

module.exports = { submissionSchema };
