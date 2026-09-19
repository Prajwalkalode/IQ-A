const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const verifyToken = require('../middleware/verifyToken');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

async function createUser({ email, password, name, role }) {
	const passwordHash = await bcrypt.hash(password, 10);
	return User.create({ email, passwordHash, name, role });
}

function isDuplicateEmailError(error) {
	return error && error.code === 11000;
}

router.post('/signup', async (req, res) => {
	const { email, password, name } = req.body;

	if (!email || !password || !name) {
		return res.status(400).json({ error: 'Email, password, and name are required' });
	}

	try {
		await createUser({ email, password, name, role: 'student' });
		return res.status(201).json({ message: 'Signup successful' });
	} catch (error) {
		if (isDuplicateEmailError(error)) {
			return res.status(409).json({ error: 'Email already exists' });
		}

		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.post('/login', async (req, res) => {
	const { email, password } = req.body;
    console.log(email);

	if (!email || !password) {
		return res.status(401).json({ error: 'Invalid credentials' });
	}

	try {
		const user = await User.findOne({ email });
		const validPassword = user ? await bcrypt.compare(password, user.passwordHash) : false;

		if (!validPassword) {
			return res.status(401).json({ error: 'Invalid credentials' });
		}

		if (!process.env.JWT_SECRET) {
			return res.status(500).json({ error: 'Internal server error' });
		}

		const token = jwt.sign(
			{ email: user.email, role: user.role },
			process.env.JWT_SECRET,
			{ expiresIn: '1h' },
		);

		return res.status(200).json({ token });
	} catch (error) {
		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.post('/teachers', verifyToken, requireRole('admin'), async (req, res) => {
	const { email, password, name } = req.body;

	if (!email || !password || !name) {
		return res.status(400).json({ error: 'Email, password, and name are required' });
	}

	try {
		await createUser({ email, password, name, role: 'teacher' });
		return res.status(201).json({ message: 'Teacher account created' });
	} catch (error) {
		if (isDuplicateEmailError(error)) {
			return res.status(409).json({ error: 'Email already exists' });
		}

		return res.status(500).json({ error: 'Internal server error' });
	}
});

router.get('/me', verifyToken, (req, res) => {
	return res.status(200).json({ email: req.user.email, role: req.user.role });
});

module.exports = router;
