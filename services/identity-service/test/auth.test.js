const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { after, before, beforeEach, describe, it } = require('node:test');

process.env.JWT_SECRET = 'identity-service-test-secret';

const User = require('../src/models/User');
const app = require('../src/app');
const { request, startServer } = require('../http-helper');

const users = [];
let server;
let failFindOne = false;

User.create = async (data) => {
	const email = data.email.toLowerCase();
	if (users.some((user) => user.email === email)) {
		const error = new Error('Duplicate email');
		error.code = 11000;
		throw error;
	}

	const user = new User({ ...data, email });
	await user.validate();
	users.push(user);
	return user;
};
User.findOne = async ({ email }) => {
	if (failFindOne) {
		throw new Error('Database unavailable');
	}
	return users.find((user) => user.email === email.toLowerCase()) || null;
};

describe('identity-service HTTP routes', () => {
	before(async () => {
		server = await startServer(app);
	});

	after(async () => {
		await server.close();
	});

	beforeEach(() => {
		users.length = 0;
		failFindOne = false;
	});

	it('health check and student signup keep role server-controlled', async () => {
		assert.deepEqual(await request(server.baseUrl, '/health'), {
			status: 200,
			body: { status: 'identity-service ok' },
		});

		const missing = await request(server.baseUrl, '/auth/signup', {
			method: 'POST',
			body: { email: 'student@example.com', password: 'Pass12345' },
		});
		assert.equal(missing.status, 400);

		const signup = await request(server.baseUrl, '/auth/signup', {
			method: 'POST',
			body: {
				email: 'Student@Example.com',
				password: 'Pass12345',
				name: 'Student',
				role: 'admin',
			},
		});
		assert.equal(signup.status, 201);
		assert.deepEqual(signup.body, { message: 'Signup successful' });
		assert.equal(users[0].role, 'student');
		assert.equal(users[0].email, 'student@example.com');
		assert.ok(!('passwordHash' in signup.body));

		const duplicate = await request(server.baseUrl, '/auth/signup', {
			method: 'POST',
			body: { email: 'student@example.com', password: 'Pass12345', name: 'Again' },
		});
		assert.equal(duplicate.status, 409);
	});

	it('login issues role claims and /me requires a valid bearer token', async () => {
		const passwordHash = await bcrypt.hash('TeacherPass123', 10);
		users.push(new User({
			email: 'teacher@example.com',
			passwordHash,
			name: 'Teacher',
			role: 'teacher',
		}));

		assert.equal((await request(server.baseUrl, '/auth/login', {
			method: 'POST',
			body: { email: 'teacher@example.com', password: 'wrong' },
		})).status, 401);
		assert.equal((await request(server.baseUrl, '/auth/login', {
			method: 'POST',
			body: { email: 'missing@example.com', password: 'wrong' },
		})).body.error, 'Invalid credentials');

		const login = await request(server.baseUrl, '/auth/login', {
			method: 'POST',
			body: { email: 'teacher@example.com', password: 'TeacherPass123' },
		});
		assert.equal(login.status, 200);
		const claims = jwt.verify(login.body.token, process.env.JWT_SECRET);
		assert.equal(claims.email, 'teacher@example.com');
		assert.equal(claims.role, 'teacher');
		assert.equal(typeof claims.exp, 'number');
		assert.equal((await request(server.baseUrl, '/auth/me')).status, 401);
		assert.deepEqual(await request(server.baseUrl, '/auth/me', { token: login.body.token }), {
			status: 200,
			body: { email: 'teacher@example.com', role: 'teacher' },
		});
		assert.equal((await request(server.baseUrl, '/auth/me', { token: 'invalid' })).status, 401);
	});

	it('admin alone can create teacher accounts and errors stay sanitized', async () => {
		const studentToken = jwt.sign(
			{ email: 'student@example.com', role: 'student' },
			process.env.JWT_SECRET,
		);
		const adminToken = jwt.sign(
			{ email: 'admin@example.com', role: 'admin' },
			process.env.JWT_SECRET,
		);
		assert.equal((await request(server.baseUrl, '/auth/teachers', {
			method: 'POST',
			token: studentToken,
			body: { email: 'teacher@example.com', password: 'Pass12345', name: 'Teacher' },
		})).status, 403);

		const created = await request(server.baseUrl, '/auth/teachers', {
			method: 'POST',
			token: adminToken,
			body: { email: 'teacher@example.com', password: 'Pass12345', name: 'Teacher' },
		});
		assert.equal(created.status, 201);
		assert.equal(users[0].role, 'teacher');

		failFindOne = true;
		const failedLogin = await request(server.baseUrl, '/auth/login', {
			method: 'POST',
			body: { email: 'teacher@example.com', password: 'Pass12345' },
		});
		assert.deepEqual(failedLogin, {
			status: 500,
			body: { error: 'Internal server error' },
		});
	});
});
