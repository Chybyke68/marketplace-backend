// ============================================================
// EngageAI Backend Server — Node.js / Express
// Full-stack API for AI Social Engagement Automation Platform
// ============================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

// ============================================================
// Configuration
// ============================================================
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// ============================================================
// Database Connections
// ============================================================
const pg = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/engageai',
    max: 20,
    idleTimeoutMillis: 30000,
});

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    db: 0,
});

redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.error('❌ Redis error:', err));

// ============================================================
// Services Import
// ============================================================
const AIEngine = require('./services/ai-engine');
const PlatformIntegrations = require('./services/platform-integrations');
const LeadTargeting = require('./services/lead-targeting');
const QueueSystem = require('./services/queue-system');
const MemoryService = require('./services/memory-service');

const aiEngine = new AIEngine();
const platforms = new PlatformIntegrations();
const leadTargeting = new LeadTargeting();
const queueSystem = new QueueSystem(redis, pg);
const memoryService = new MemoryService(pg, redis);

// ============================================================
// WebSocket Setup
// ============================================================
const http = require('http');
const server = http.createServer(app);
const { Server: SocketServer } = require('socket.io');

const io = new SocketServer(server, {
    cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', methods: ['GET', 'POST'] }
});

io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    socket.on('subscribe:conversations', () => socket.join('conversations'));
    socket.on('subscribe:queue', () => socket.join('queue'));
    socket.on('subscribe:leads', () => socket.join('leads'));

    socket.on('disconnect', () => console.log(`🔌 Client disconnected: ${socket.id}`));
});

// ============================================================
// Health Check
// ============================================================
app.get('/api/health', async (req, res) => {
    const pgOk = await pg.query('SELECT 1').then(() => true).catch(() => false);
    const redisOk = redis.status === 'ready';
    res.json({
        status: pgOk && redisOk ? 'healthy' : 'degraded',
        uptime: process.uptime(),
        postgres: pgOk,
        redis: redisOk,
        timestamp: new Date().toISOString(),
    });
});

// ============================================================
// AUTH ROUTES
// ============================================================
const jwt = require('jsonwebtoken');

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    // In production: verify against DB with bcrypt
    const user = await pg.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!user.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
        { id: user.rows[0].id, email, role: user.rows[0].role },
        process.env.JWT_SECRET || 'dev-secret-change-me',
        { expiresIn: '24h' }
    );
    res.json({ token, user: { id: user.rows[0].id, email, role: user.rows[0].role } });
});

// Auth middleware
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-change-me');
        next();
    } catch { return res.status(401).json({ error: 'Invalid token' }); }
};

// ============================================================
// CONVERSATION ROUTES
// ============================================================
app.get('/api/conversations', authMiddleware, async (req, res) => {
    const { platform, status, limit = 50, offset = 0 } = req.query;
    let query = `
        SELECT c.*, 
            COUNT(cm.id) as message_count,
            MAX(cm.created_at) as last_message_at
        FROM conversations c
        LEFT JOIN conversation_messages cm ON c.id = cm.conversation_id
        WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (platform) { query += ` AND c.platform = $${paramIdx++}`; params.push(platform); }
    if (status) { query += ` AND c.status = $${paramIdx++}`; params.push(status); }

    query += ` GROUP BY c.id ORDER BY c.updated_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(limit, offset);

    const result = await pg.query(query, params);
    res.json({ conversations: result.rows, total: result.rows.length });
});

app.get('/api/conversations/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const conv = await pg.query('SELECT * FROM conversations WHERE id = $1', [id]);
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversation not found' });

    const messages = await pg.query(
        'SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
        [id]
    );

    res.json({ conversation: conv.rows[0], messages: messages.rows });
});

app.post('/api/conversations/:id/reply', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { style, force_regenerate } = req.body;
    const userId = req.user.id;

    // Get conversation context
    const conv = await pg.query('SELECT * FROM conversations WHERE id = $1', [id]);
    if (!conv.rows.length) return res.status(404).json({ error: 'Conversation not found' });

    const messages = await pg.query(
        'SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
        [id]
    );

    // Check memory for previous interactions with this user
    const userMemory = await memoryService.getUserMemory(conv.rows[0].platform_user_id);

    // Generate AI reply
    const reply = await aiEngine.generateReply({
        conversation: conv.rows[0],
        messages: messages.rows,
        style: style || 'casual',
        userMemory,
        platform: conv.rows[0].platform,
    });

    // Store reply candidate
    const replyRecord = await pg.query(
        `INSERT INTO reply_candidates (id, conversation_id, content, style, confidence_score, model_used, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'generated', $7) RETURNING *`,
        [uuidv4(), id, reply.content, style || 'casual', reply.confidence, reply.model, userId]
    );

    // Check if manual approval mode is on
    const approvalMode = await redis.get('settings:approval_mode');

    if (approvalMode === 'true') {
        // Add to approval queue
        await queueSystem.addToQueue({
            candidateId: replyRecord.rows[0].id,
            conversationId: id,
            type: 'pending_approval',
        });
        io.to('queue').emit('queue:update', { type: 'new_pending', candidate: replyRecord.rows[0] });
    } else {
        // Auto-approve with safety checks
        const safetyCheck = await aiEngine.safetyCheck(reply.content, conv.rows[0].platform);
        if (safetyCheck.safe) {
            await queueSystem.addToQueue({
                candidateId: replyRecord.rows[0].id,
                conversationId: id,
                type: 'auto_approved',
                scheduledAt: new Date(Date.now() + aiEngine.getRandomDelay()),
            });
        } else {
            await pg.query('UPDATE reply_candidates SET status = $1 WHERE id = $2', ['flagged', replyRecord.rows[0].id]);
            io.to('queue').emit('queue:update', { type: 'flagged', reason: safetyCheck.reason });
        }
    }

    res.json({ reply: replyRecord.rows[0], confidence: reply.confidence });
});

// ============================================================
// LEAD ROUTES
// ============================================================
app.get('/api/leads', authMiddleware, async (req, res) => {
    const { platform, status, min_intent, limit = 50, offset = 0 } = req.query;
    let query = 'SELECT * FROM leads WHERE 1=1';
    const params = [];
    let idx = 1;

    if (platform) { query += ` AND platform = $${idx++}`; params.push(platform); }
    if (status) { query += ` AND status = $${idx++}`; params.push(status); }
    if (min_intent) { query += ` AND intent_score >= $${idx++}`; params.push(min_intent); }

    query += ` ORDER BY intent_score DESC, created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const result = await pg.query(query, params);
    res.json({ leads: result.rows });
});

app.post('/api/leads/:id/convert', authMiddleware, async (req, res) => {
    const { id } = req.params;
    await pg.query('UPDATE leads SET status = $1, converted_at = NOW() WHERE id = $2', ['converted', id]);
    await memoryService.updateLeadMemory(id, { converted: true, convertedAt: new Date() });
    io.to('leads').emit('lead:converted', { leadId: id });
    res.json({ success: true });
});

// ============================================================
// QUEUE ROUTES
// ============================================================
app.get('/api/queue', authMiddleware, async (req, res) => {
    const { status } = req.query;
    const items = await queueSystem.getQueueItems(status);
    res.json({ items });
});

app.post('/api/queue/:id/approve', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const scheduledAt = new Date(Date.now() + aiEngine.getRandomDelay());
    await queueSystem.approveQueueItem(id, scheduledAt);
    await pg.query('UPDATE reply_candidates SET status = $1 WHERE id = $2', ['approved', id]);
    io.to('queue').emit('queue:update', { type: 'approved', itemId: id });
    res.json({ success: true });
});

app.post('/api/queue/:id/reject', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    await queueSystem.rejectQueueItem(id, reason);
    await pg.query('UPDATE reply_candidates SET status = $1, rejection_reason = $2 WHERE id = $3', ['rejected', reason, id]);
    io.to('queue').emit('queue:update', { type: 'rejected', itemId: id });
    res.json({ success: true });
});

app.post('/api/queue/:id/edit', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    await pg.query('UPDATE reply_candidates SET content = $1, edited_at = NOW(), edited_by = $2 WHERE id = $3', [content, req.user.id, id]);
    res.json({ success: true });
});

// ============================================================
// ANALYTICS ROUTES
// ============================================================
app.get('/api/analytics/overview', authMiddleware, async (req, res) => {
    const { period = '7d' } = req.query;
    const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
    const days = daysMap[period] || 7;

    const [
        activeConversations,
        leadsGenerated,
        engagementRate,
        conversions,
    ] = await Promise.all([
        pg.query('SELECT COUNT(*) as count FROM conversations WHERE status = $1 AND updated_at > NOW() - INTERVAL \'1 day\'', ['active']),
        pg.query('SELECT COUNT(*) as count FROM leads WHERE created_at > NOW() - INTERVAL \'' + days + ' days\''),
        pg.query(`SELECT ROUND(AVG(CASE WHEN replied THEN 1.0 ELSE 0.0 END) * 100, 1) as rate 
                   FROM conversations WHERE created_at > NOW() - INTERVAL '${days} days'`),
        pg.query('SELECT COUNT(*) as count FROM leads WHERE status = $1 AND converted_at > NOW() - INTERVAL \'' + days + ' days\'', ['converted']),
    ]);

    res.json({
        activeConversations: parseInt(activeConversations.rows[0].count),
        leadsGenerated: parseInt(leadsGenerated.rows[0].count),
        engagementRate: parseFloat(engagementRate.rows[0].rate),
        conversions: parseInt(conversions.rows[0].count),
    });
});

// ============================================================
// Start Server
// ============================================================
server.listen(PORT, () => {
    console.log(`🚀 EngageAI Backend running in ${NODE_ENV} mode on port ${PORT}`);
});