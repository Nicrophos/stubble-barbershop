'use strict';
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const pg = require('pg');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const multer = require('multer');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.startsWith('CHANGE_ME')) {
    console.error('Заполни DATABASE_URL и SESSION_SECRET (не менее 32 символов) в .env');
    process.exit(1);
}

const app = express();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const AVATARS = path.join(ROOT, 'data', 'avatars');
const PORT = Number(process.env.PORT) || 3000;
const production = process.env.NODE_ENV === 'production';

if (production) app.set('trust proxy', 1); // За доверенным HTTPS reverse proxy.
app.disable('x-powered-by');
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            frameSrc: ["'self'", 'https://www.google.com'],
            connectSrc: ["'self'"],
            'upgrade-insecure-requests': null // localhost при разработке может работать без HTTPS.
        }
    }
}));
app.use(express.json({ limit: '30kb' }));
app.use(express.urlencoded({ extended: false, limit: '30kb' }));

app.use(session({
    store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
    name: 'stubble.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        httpOnly: true,
        secure: production,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000
    }
}));

// CSRF-токен привязан к серверной сессии; чужой сайт не сможет отправить запрос с ним.
app.get('/api/auth/csrf', (req, res) => {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.json({ token: req.session.csrfToken });
});
function verifyCsrf(req, res, next) {
    const actual = req.get('x-csrf-token') || '';
    const expected = req.session.csrfToken || '';
    if (!actual || actual.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
        return res.status(403).json({ error: 'Недействительный токен формы. Обнови страницу.' });
    }
    next();
}
app.use('/api', (req, res, next) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return verifyCsrf(req, res, next);
    next();
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 15,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Слишком много попыток. Попробуй позже.' }
});

const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
            return cb(new Error('Допустимы только JPG, PNG или WEBP.'));
        }
        cb(null, true);
    }
});

function imageExtension(buffer) {
    if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    return null;
}
async function saveAvatar(file) {
    if (!file) return null;
    const ext = imageExtension(file.buffer);
    if (!ext) {
        const error = new Error('Содержимое файла не является JPG, PNG или WEBP.');
        error.status = 400;
        throw error;
    }
    await fs.mkdir(AVATARS, { recursive: true });
    const name = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(AVATARS, name), file.buffer, { flag: 'wx' });
    return name;
}
async function removeAvatar(name) {
    if (name && /^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(name)) {
        await fs.unlink(path.join(AVATARS, name)).catch(() => {});
    }
}
function validPassword(p) { return typeof p === 'string' && p.length >= 8 && Buffer.byteLength(p, 'utf8') <= 72; }
function validEmail(s) { return typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function validName(s) { return typeof s === 'string' && s.trim().length >= 2 && s.trim().length <= 120; }
function publicUser(user) {
    return { login: user.login, fullName: user.full_name, email: user.email, hasAvatar: Boolean(user.avatar_filename) };
}
function apiError(res, status, message) { return res.status(status).json({ error: message }); }
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

async function getUser(req) {
    if (!req.session.userId) return null;
    const { rows } = await pool.query('SELECT id, login, full_name, email, avatar_filename, password_hash FROM users WHERE id=$1', [req.session.userId]);
    return rows[0] || null;
}
const requireAuth = wrap(async (req, res, next) => {
    const user = await getUser(req);
    if (!user) return apiError(res, 401, 'Необходимо войти в аккаунт.');
    req.user = user;
    next();
});
function startSession(req, userId, res, next) {
    req.session.regenerate(err => {
        if (err) return next(err);
        req.session.userId = String(userId);
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        req.session.save(err => {
            if (err) return next(err);
            res.json({ ok: true, csrfToken: req.session.csrfToken });
        });
    });
}

app.post('/api/auth/register', authLimiter, imageUpload.single('avatar'), wrap(async (req, res, next) => {
    const login = String(req.body.login || '').trim().toLowerCase();
    const fullName = String(req.body.fullName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = req.body.password;
    if (!/^[a-z0-9_]{3,30}$/.test(login)) return apiError(res, 400, 'Логин: 3–30 символов, латинские буквы, цифры или _.');
    if (!validName(fullName)) return apiError(res, 400, 'Укажи ФИО от 2 до 120 символов.');
    if (!validEmail(email)) return apiError(res, 400, 'Укажи корректную электронную почту.');
    if (!validPassword(password)) return apiError(res, 400, 'Пароль: минимум 8 символов, максимум 72 байта.');

    let avatar = null;
    try {
        avatar = await saveAvatar(req.file);
        const hash = await bcrypt.hash(password, 12);
        const { rows } = await pool.query(
            'INSERT INTO users (login, full_name, email, password_hash, avatar_filename) VALUES ($1,$2,$3,$4,$5) RETURNING id',
            [login, fullName, email, hash, avatar]
        );
        startSession(req, rows[0].id, res, next);
    } catch (e) {
        await removeAvatar(avatar);
        if (e.code === '23505') return apiError(res, 409, 'Логин или электронная почта уже заняты.');
        throw e;
    }
}));

app.post('/api/auth/login', authLimiter, wrap(async (req, res, next) => {
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = req.body.password;
    if (login.length > 30 || typeof password !== 'string') return apiError(res, 400, 'Некорректные данные.');
    const { rows } = await pool.query('SELECT id, password_hash FROM users WHERE login=$1', [login]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return apiError(res, 401, 'Неправильный логин или пароль.');
    }
    startSession(req, user.id, res, next);
}));

app.post('/api/auth/logout', (req, res, next) => {
    req.session.destroy(err => {
        if (err) return next(err);
        res.clearCookie('stubble.sid', { path: '/' });
        res.json({ ok: true });
    });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
app.patch('/api/me', requireAuth, wrap(async (req, res) => {
    const fullName = String(req.body.fullName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!validName(fullName) || !validEmail(email)) return apiError(res, 400, 'Проверь ФИО и почту.');
    try {
        const { rows } = await pool.query(
            'UPDATE users SET full_name=$1, email=$2 WHERE id=$3 RETURNING login, full_name, email, avatar_filename',
            [fullName, email, req.user.id]
        );
        res.json({ user: publicUser(rows[0]) });
    } catch (e) {
        if (e.code === '23505') return apiError(res, 409, 'Эта электронная почта уже занята.');
        throw e;
    }
}));

app.post('/api/me/password', requireAuth, authLimiter, wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || !validPassword(newPassword)) {
        return apiError(res, 400, 'Новый пароль: минимум 8 символов, максимум 72 байта.');
    }
    if (!(await bcrypt.compare(currentPassword, req.user.password_hash))) {
        return apiError(res, 401, 'Текущий пароль введён неверно.');
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ ok: true });
}));

app.post('/api/me/avatar', requireAuth, imageUpload.single('avatar'), wrap(async (req, res) => {
    if (!req.file) return apiError(res, 400, 'Выбери изображение.');
    const avatar = await saveAvatar(req.file);
    try {
        await pool.query('UPDATE users SET avatar_filename=$1 WHERE id=$2', [avatar, req.user.id]);
    } catch (e) {
        await removeAvatar(avatar);
        throw e;
    }
    await removeAvatar(req.user.avatar_filename);
    res.json({ ok: true });
}));
app.delete('/api/me/avatar', requireAuth, wrap(async (req, res) => {
    await pool.query('UPDATE users SET avatar_filename=NULL WHERE id=$1', [req.user.id]);
    await removeAvatar(req.user.avatar_filename);
    res.json({ ok: true });
}));
app.get('/api/me/avatar', requireAuth, wrap(async (req, res) => {
    if (!req.user.avatar_filename) return res.status(404).end();
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.join(AVATARS, req.user.avatar_filename));
}));

const sha256 = token => crypto.createHash('sha256').update(token).digest('hex');
app.post('/api/auth/forgot', authLimiter, wrap(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!validEmail(email)) return apiError(res, 400, 'Укажи корректную почту.');
    const { rows } = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    let resetUrl = null;
    if (rows.length) {
        const token = crypto.randomBytes(32).toString('hex');
        await pool.query('DELETE FROM password_resets WHERE user_id=$1', [rows[0].id]);
        await pool.query("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2,NOW() + INTERVAL '20 minutes')", [rows[0].id, sha256(token)]);
        if (!production && process.env.DEMO_RESET_LINK === 'true') {
            resetUrl = `/reset-password.html?token=${token}`;
        }
    }
    res.json({ message: 'Если аккаунт существует, создана ссылка восстановления.', resetUrl });
}));

app.post('/api/auth/reset', authLimiter, wrap(async (req, res) => {
    const token = String(req.body.token || '');
    const password = req.body.password;
    if (!/^[0-9a-f]{64}$/.test(token) || !validPassword(password)) {
        return apiError(res, 400, 'Недействительная ссылка или неподходящий пароль.');
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            "UPDATE password_resets SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() RETURNING user_id",
            [sha256(token)]
        );
        if (!rows.length) {
            await client.query('ROLLBACK');
            return apiError(res, 400, 'Ссылка недействительна или срок её действия истёк.');
        }
        const hash = await bcrypt.hash(password, 12);
        await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, rows[0].user_id]);
        // Сброс ранее созданных авторизованных сессий пользователя.
        await client.query('DELETE FROM user_sessions WHERE sess->>\'userId\'=$1', [String(rows[0].user_id)]);
        await client.query('COMMIT');
        res.json({ ok: true, message: 'Пароль обновлён. Теперь можно войти.' });
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}));

// Личный кабинет защищён на сервере. В public/ этот HTML не лежит.
app.get('/profile', wrap(async (req, res) => {
    if (!await getUser(req)) return res.redirect('/?auth=login');
    res.sendFile(path.join(ROOT, 'private', 'profile.html'));
}));

// Статические страницы и изображения STUBBLE.
app.use(express.static(PUBLIC, { index: 'index.html', dotfiles: 'deny', extensions: ['html'] }));

// В продакшене защищаем от попыток открыть внутренние файлы по URL.
app.use((req, res) => res.status(404).send('Страница не найдена.'));
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return apiError(res, 400, 'Файл слишком большой (максимум 2 МБ).');
    if (err.message && err.message.startsWith('Допустимы только')) return apiError(res, 400, err.message);
    if (err.status && err.status < 500) return apiError(res, err.status, err.message);
    console.error(err);
    if (req.path.startsWith('/api/')) return apiError(res, 500, 'Ошибка сервера. Проверь консоль Node.js.');
    res.status(500).send('Ошибка сервера.');
});

async function main() {
    // Без PostgreSQL приложение не может корректно работать.
    await pool.query('SELECT 1');
    await fs.mkdir(AVATARS, { recursive: true });
    app.listen(PORT, () => console.log(`STUBBLE работает: http://localhost:${PORT}`));
}
main().catch(err => { console.error('Не удалось запустить STUBBLE:', err.message); process.exit(1); });
