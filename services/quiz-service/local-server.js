require('dotenv').config();

const app = require('./src/app');
const connectDB = require('./src/db');
const QuizAssignment = require('./src/models/QuizAssignment');
const QuizSession = require('./src/models/QuizSession');

const port = Number(process.env.PORT) || 4003;

async function startServer() {
	try {
		await connectDB();
		await Promise.all([QuizSession.init(), QuizAssignment.init()]);
		app.listen(port, () => {
			console.log(`quiz-service listening on port ${port}`);
		});
	} catch (error) {
		console.error('Failed to initialize quiz-service', error);
		process.exit(1);
	}
}

startServer();
