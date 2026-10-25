require('dotenv').config();

const app = require('./src/app');

const port = Number(process.env.PORT) || 4001;

app.listen(port, () => {
	console.log(`identity-service listening on port ${port}`);
});
