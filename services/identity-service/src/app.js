const express = require('express');
const authRoutes = require('./routes/auth');

const app = express();

app.use(express.json());
app.use('/auth', authRoutes);

app.get('/health', (req, res) => {
	res.status(200).json({ status: 'identity-service ok' });
});

app.use((error, req, res, next) => {
	console.error(error);
	res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
