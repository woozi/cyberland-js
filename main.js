const { Pool } = require('pg');
const express = require('express');
const https = require('https');
const { setupDb } = require('./db.js');

const boards = [
    { name: 'o', title: 'off-topic' },
    { name: 'n', title: 'news' },
    { name: 't', title: 'technology' },
    { name: 'i', title: 'images' },
];

const postLimitSecs = 60; // One IP can post once per 60 seconds
const lastPostTimes = {};
const ipBlacklist = new Set();

// PostgreSQL database
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL || 'postgresql://cyberland:cyberland@server:5432/cyberland', 
    ssl: process.env.USE_SSL 
});

// Port the web server will listen on
const webServerPort = process.env.PORT || 3000; 

const app = express();
app.use(express.urlencoded({ extended: true }));

// Index
app.get('/', async function (req, res) {
    res.sendFile('index.txt', { root: __dirname });
});

// Get endpoint
app.get('/:boardName/?', async function (req, res) {
    const params = [req.params.boardName];
    let sql = `select id, postedTime as time, bumpTime as "bumpTime", content, replyTo as "replyTo" 
                from post where boardName = $${params.length}`;
    if (req.query.thread !== undefined) {
        // This weird behavior is for compatibility with the other backends
        if (req.query.thread === '0' || req.query.thread === '') {
            sql += ` and replyTo is null`;
        } else {
            params.push(req.query.thread);
            sql += ` and replyTo = $${params.length}`;
        }
    }
    sql += ' order by time desc';
    if (req.query.offset) {
        params.push(req.query.offset);
        sql += ` offset $${params.length}`;
    }
    if (req.query.num) {
        params.push(req.query.num);
        sql += ` limit $${params.length}`;
    }
    const sqlRes = await pool.query(sql, params);
    res.json(sqlRes.rows);
});

// Post endpoint
app.post('/:boardName/?', async function (req, res) {
    // Blacklist check
    const clientIp = req.connection.remoteAddress;
    if (ipBlacklist.has(clientIp)) {
        res.sendStatus(403);
        return;
    }    

    // Time limit for posting from one IP
    const now = Date.now();
    if ((now - lastPostTimes[clientIp]) / 1000 < postLimitSecs) {
        res.sendStatus(403);
        return;
    }
    lastPostTimes[clientIp] = now;

    const replyTo = req.body.replyTo && req.body.replyTo !== '0' ? req.body.replyTo : null;
    await pool.query(
        'insert into post (boardName, content, replyTo) values ($1, $2, $3)',
        [req.params.boardName, req.body.content, replyTo]);
    res.sendStatus(200);
});

async function downloadTorIpList() {
    return new Promise((resolve, reject) => {
        https.get('https://check.torproject.org/torbulkexitlist', (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', (e) => reject(e));
    });
}

async function populateIpBlacklist() {
    try {
        const torList = await downloadTorIpList();
        torList.split('\n').forEach(ip => ipBlacklist.add(ip));
    } catch (e) {
        console.error(e);
        console.log('Downloading Tor list failed');
    }
    console.log(`Blacklist has ${ipBlacklist.size} IPs`);
}

async function main() {
    await populateIpBlacklist();
    await setupDb(pool, boards);
    app.listen(webServerPort, () => console.log(`Listening on :${webServerPort} ...`));
}

main();
