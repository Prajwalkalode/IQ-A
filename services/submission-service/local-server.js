require('dotenv').config();

const app = require('./src/app');

const port = Number(process.env.PORT) || 4004;

app.listen(port, () => {
	console.log(`submission-service listening on port ${port}`);
});
