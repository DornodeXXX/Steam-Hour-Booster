const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const bodyParser = require('body-parser');
const SteamUser = require('steam-user');
const botFactory = require('../src/hourBooster');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const CONFIG_PATH = path.join(__dirname, '../config/accounts.json');
const LOG_FILE = path.join(__dirname, '../logs/log.txt');
const LOG_DIR = path.dirname(LOG_FILE);

async function ensureLogDir() {
    try {
        await fs.mkdir(LOG_DIR, { recursive: true });
    } catch (error) {
        console.error("Failed to create log directory:", error);
    }
}
ensureLogDir();

app.use(express.static(path.join(__dirname, '../public')));
app.use(bodyParser.json());

let bots = {};
let configsArray = [];

async function loadConfig() {
    try {
        const data = await fs.readFile(CONFIG_PATH, 'utf8');
        configsArray = JSON.parse(data);
        console.log(`[Config] Loaded ${configsArray.length} accounts.`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn('[Config] accounts.json not found. Creating empty file.');
            configsArray = [];
            await saveConfig();
        } else {
            console.error('[Config] Error loading config:', error);
            configsArray = [];
        }
    }
}

async function saveConfig() {
    try {
        await fs.writeFile(CONFIG_PATH, JSON.stringify(configsArray, null, 2), 'utf8');
        console.log('[Config] Configuration saved.');
    } catch (error) {
        console.error('[Config] Error saving config:', error);
    }
}

async function writeLog(message) {
    const logLine = `[${new Date().toLocaleString()}] ${message}\n`;
    try {
        await fs.appendFile(LOG_FILE, logLine);
        io.emit('log', logLine);
    } catch (error) {
        console.error("Failed to write log:", error);
        console.log(logLine.trim());
    }
}

function startBot(config) {
    if (bots[config.username]) {
        writeLog(`[${config.username}] Bot is already running.`);
        return;
    }

    writeLog(`[${config.username}] Starting bot...`);
    const bot = botFactory.buildBot(config);

    bot.on('loggedOn', () => {
        if (!bots[config.username]) {
            bots[config.username] = bot;
        }
        writeLog(`[${config.username}] Logged in successfully.`);
        io.emit('statusUpdate');
    });

    bot.on('fatalError', async (err) => {
        if (err.eresult === SteamUser.EResult.InvalidPassword) {
            writeLog(`[${config.username}] Invalid password - removing account.`);
            
            const index = configsArray.findIndex(a => a.username === config.username);
            if (index !== -1) {
                configsArray.splice(index, 1);
                await saveConfig();
            }
            
            if (bot.destroy) bot.destroy();
            delete bots[config.username];
            io.emit('statusUpdate');
        }
    });

    bot.on('error', (err) => {
        const isLoggedInElsewhere = err.message && err.message.includes('LoggedInElsewhere');
        if (!isLoggedInElsewhere) {
            writeLog(`[${config.username}] Error: ${err.message || err}`);
        }
    });

	bot.on('steamGuardRequested', () => {
		io.emit('steamGuardRequest', { 
			username: config.username,
			timestamp: Date.now()
		});
		writeLog(`[${config.username}] Требуется код Steam Guard`);
	});

    bot.on('disconnected', (eresult, msg) => {
        writeLog(`[${config.username}] Disconnected: ${msg} (Result: ${eresult})`);
        if (!bot._isDestroyed) {
            delete bots[config.username];
            io.emit('statusUpdate');
        }
    });

    bot.doLogin();
    bots[config.username] = bot;
    io.emit('statusUpdate');
}

function stopBot(username) {
    const bot = bots[username];
    if (!bot) {
        writeLog(`[${username}] Bot is not running.`);
        return;
    }

    writeLog(`[${username}] Stopping bot...`);
    try {
        if (bot.destroy) {
            bot.destroy();
        } else {
            bot.logOff();
        }
    } catch (e) {
        writeLog(`[${username}] Error during stop: ${e.message}`);
    } finally {
        delete bots[username];
        io.emit('statusUpdate');
        writeLog(`[${username}] Bot stopped.`);
    }
}

// API
app.get('/api/accounts', (req, res) => {
    const accountList = configsArray.map(config => ({
        username: config.username,
        enableStatus: config.enableStatus,
        gamesAndStatus: config.gamesAndStatus,
        replyMessage: config.replyMessage,
        receiveMessages: config.receiveMessages,
        saveMessages: config.saveMessages,
        running: Boolean(bots[config.username]),
    }));
    res.json(accountList);
});

app.get('/api/logs', async (req, res) => {
    try {
        const logs = await fs.readFile(LOG_FILE, 'utf8');
        res.type('text/plain').send(logs);
    } catch (error) {
        if (error.code === 'ENOENT') {
            res.type('text/plain').send('');
        } else {
            console.error("Failed to read logs:", error);
            res.status(500).send('Error reading logs');
        }
    }
});

app.post('/api/start', (req, res) => {
    const { username } = req.body;
    const config = configsArray.find(cfg => cfg.username === username);

    if (!config) {
        return res.status(404).json({ message: 'Account not found' });
    }
    if (bots[username]) {
        return res.status(400).json({ message: 'Bot already running' });
    }

    startBot(config);
    res.json({ message: 'Start command received' });
});

app.post('/api/stop', (req, res) => {
    const { username } = req.body;
    if (!bots[username]) {
        return res.status(400).json({ message: 'Bot not running' });
    }

    stopBot(username);
    res.json({ message: 'Stop command received' });
});

app.post('/api/submit-guard', (req, res) => {
    const { username, code } = req.body;
    const bot = bots[username];

    if (!bot || !bot._waitingForGuard) {
        return res.status(400).json({ message: 'Нет активного запроса Steam Guard' });
    }

    if (!code || code.length !== 5) {
        return res.status(400).json({ message: 'Неверный формат кода' });
    }

    try {
        bot.submitSteamGuardCode(code);
        writeLog(`[${username}] Код Steam Guard принят`);
        res.json({ success: true, message: 'Код принят' });
    } catch (error) {
        writeLog(`[${username}] Ошибка при обработке кода: ${error}`);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});


app.post('/api/add-account', async (req, res) => {
    const newAccount = req.body;

    if (!newAccount.username || !newAccount.password) {
        return res.status(400).json({ message: 'Username and password are required' });
    }
    if (configsArray.some(acc => acc.username === newAccount.username)) {
        return res.status(409).json({ message: 'Account already exists' });
    }

    newAccount.sharedSecret = newAccount.sharedSecret || '';
    newAccount.enableStatus = newAccount.enableStatus !== false;
    newAccount.gamesAndStatus = newAccount.gamesAndStatus || [];
    newAccount.replyMessage = newAccount.replyMessage || '';
    newAccount.receiveMessages = newAccount.receiveMessages || false;
    newAccount.saveMessages = newAccount.saveMessages || false;

    configsArray.push(newAccount);
    await saveConfig();
    writeLog(`[${newAccount.username}] Account added.`);
    io.emit('statusUpdate');
    res.status(201).json({ message: 'Account added successfully' });
});

app.post('/api/clear-logs', async (req, res) => {
    try {
        await fs.writeFile(LOG_FILE, '');
        writeLog('Logs cleared by user');
        res.status(200).json({ success: true, message: 'Logs cleared successfully' });
    } catch (error) {
        console.error('Error clearing logs:', error);
        writeLog(`Error clearing logs: ${error.message}`);
        res.status(500).json({ success: false, message: 'Error clearing logs' });
    }
});


app.put('/api/edit-account/:username', async (req, res) => {
    const username = req.params.username;
    const updatedData = req.body;
    const accountIndex = configsArray.findIndex(acc => acc.username === username);

    if (accountIndex === -1) {
        return res.status(404).json({ message: 'Account not found' });
    }

    configsArray[accountIndex] = {
        ...configsArray[accountIndex],
        ...updatedData,
        username: username
    };

    if (bots[username]) {
        writeLog(`[${username}] Account edited. Stopping bot to apply changes.`);
        stopBot(username);
    }

    await saveConfig();
    io.emit('statusUpdate');
    res.json({ message: 'Account updated successfully' });
});

app.delete('/api/delete-account/:username', async (req, res) => {
    const username = req.params.username;
    const accountIndex = configsArray.findIndex(acc => acc.username === username);

    if (accountIndex === -1) {
        return res.status(404).json({ message: 'Account not found' });
    }

    if (bots[username]) {
        stopBot(username);
    }

    configsArray.splice(accountIndex, 1);
    await saveConfig();
    writeLog(`[${username}] Account deleted.`);
    io.emit('statusUpdate');
    res.json({ message: 'Account deleted successfully' });
});

io.on('connection', socket => {
    console.log('[SocketIO] Client connected');
    socket.on('disconnect', () => {
        console.log('[SocketIO] Client disconnected');
    });
});

// Запуск сервера
const PORT = 3000;
server.listen(PORT, async () => {
    await loadConfig();
    console.log(`[Server] Web panel running at http://localhost:${PORT}`);
	// Опционально: автоматически запускать ботов при старте сервера
    // configsArray.forEach(config => startBot(config));
});