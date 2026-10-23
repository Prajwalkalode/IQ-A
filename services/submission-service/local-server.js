require('dotenv').config();

const app = require('./src/app');
const connectDB = require('./src/db');
const Submission = require('./src/models/Submission');

const port = Number(process.env.PORT) || 4004;

async function startServer() {
	try {
		await connectDB();
		await Submission.init();
		app.listen(port, () => {
			console.log(`submission-service listening on port ${port}`);
		});
	} catch (error) {
		console.error('Failed to initialize submission-service', error);
		process.exit(1);
	}
}

startServer();
