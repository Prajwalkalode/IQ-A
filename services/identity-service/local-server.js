require('dotenv').config();

const app = require('./src/app');
const connectDB = require('./src/db');

const port = Number(process.env.PORT) || 4001;

async function startServer() {
	try {
		await connectDB();
		app.listen(port, () => {
			console.log(`identity-service listening on port ${port}`);
		});
	} catch (error) {
		console.error('Failed to connect to MongoDB', error);
		process.exit(1);
	}
}

startServer();
