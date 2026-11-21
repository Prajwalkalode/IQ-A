const express = require('express');
const quizRoutes = require('./routes/quiz');

const app = express();

app.use(express.json());
app.use('/quiz', quizRoutes);

app.get('/health', (req, res) => {
	res.status(200).json({ status: 'quiz-service ok' });
});

app.use((error, req, res, next) => {
	if (res.headersSent) {
		return next(error);
	}

	if (error.status === 400 || error.statusCode === 400) {
		return res.status(400).json({ error: 'Invalid request body' });
	}

	console.error(error);
	return res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
