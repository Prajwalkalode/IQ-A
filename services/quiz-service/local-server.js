require('dotenv').config();

const app = require('./src/app');

const port = Number(process.env.PORT) || 4003;

app.listen(port, () => {
	console.log(`quiz-service listening on port ${port}`);
});
