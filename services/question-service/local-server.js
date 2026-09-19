require('dotenv').config();

const app = require('./src/app');

const port = Number(process.env.PORT) || 4002;

app.listen(port, () => {
	console.log(`question-service listening on port ${port}`);
});
