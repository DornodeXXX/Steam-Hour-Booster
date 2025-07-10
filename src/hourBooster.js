const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const fs = require('fs');
const path = require('path');

const botFactory = {};

botFactory.buildBot = function(config) {
    const loginKeysPath = path.join(__dirname, '../login_keys');
    const loginKeyFile = path.join(loginKeysPath, `${config.username}.txt`);

    if (!fs.existsSync(loginKeysPath)) {
        fs.mkdirSync(loginKeysPath, { recursive: true });
    }

	const bot = new SteamUser({
		autoRelogin: true,
		promptSteamGuardCode: false,
		rememberPassword: true,
		enablePicsCache: true,
		picsCacheAll: true,
		dataDirectory: path.join(__dirname, '../accounts_data')
	});

    bot.username = config.username;
    bot.password = config.password;
    bot.sharedSecret = config.sharedSecret;
    bot.games = config.gamesAndStatus;
    bot.enableStatus = config.enableStatus;
    bot.autoMessage = config.replyMessage;
    bot.receiveMessages = config.receiveMessages;
    bot.saveMessages = config.saveMessages;
    bot.messageReceived = {};
    bot.loginKeyPath = loginKeyFile;
    bot._isDestroyed = false;
    bot._reconnectTimer = null;

	bot.doLogin = function() {
		if (this._isDestroyed) return;

		const loginOptions = {
			accountName: this.username,
			rememberPassword: true,
			machineName: 'hourBooster'
		};

		if (fs.existsSync(this.loginKeyPath)) {
			loginOptions.loginKey = fs.readFileSync(this.loginKeyPath, 'utf8').trim();
			console.log(`[${this.username}] Используется сохраненный loginKey`);
		} else {
			loginOptions.password = this.password;
			console.log(`[${this.username}] Используется пароль`);
		}

		this.logOn(loginOptions);
	};

    bot.destroy = function() {
        if (this._isDestroyed) return;
        
        this._isDestroyed = true;
        clearTimeout(this._reconnectTimer);
        this.removeAllListeners();
        this.logOff();
        
        console.log(`[${this.username}] Account remove`);
    };

    bot.on('loggedOn', () => {
        console.log(`[${bot.username}] Successful login to Steam`);
        bot.setPersona(bot.enableStatus ? SteamUser.EPersonaState.Online : SteamUser.EPersonaState.Invisible);
        bot.gamesPlayed(bot.games);
    });

	bot.on('loginKey', (key) => {
		fs.writeFileSync(bot.loginKeyPath, key);
		console.log(`[${bot.username}] LoginKey сохранен в ${bot.loginKeyPath}`);
	});
    bot.on('error', (err) => {
        console.log(`[${bot.username}] Ошибка:`, err.message || err);
        
        clearTimeout(bot._reconnectTimer);
        
        if (err.message && err.message.includes('LoggedInElsewhere')) {
            console.log(`[${bot.username}] Login from another device, repeat after 60 seconds`);
            bot._reconnectTimer = setTimeout(() => bot.doLogin(), 60000);
        }
        else if (err.eresult === SteamUser.EResult.InvalidPassword) {
            if (fs.existsSync(bot.loginKeyPath)) {
                fs.unlinkSync(bot.loginKeyPath);
            }
            bot.emit('fatalError', err);
        }
        else {
            bot._reconnectTimer = setTimeout(() => bot.doLogin(), 60000);
        }
    });

	bot.on('steamGuard', (domain, callback) => {
		if (bot.sharedSecret) {
			const code = SteamTotp.generateAuthCode(bot.sharedSecret);
			console.log(`[${bot.username}] Автокод Steam Guard: ${code}`);
			callback(code);
		} else {
			console.log(`[${bot.username}] Требуется ручной ввод Steam Guard`);
			bot._waitingForGuard = true;
			bot._steamGuardCallback = callback;
			bot.emit('steamGuardRequested');
		}
	});

    bot.submitSteamGuardCode = function(code) {
        if (this._waitingForGuard && this._steamGuardCallback) {
            this._steamGuardCallback(code);
            this._waitingForGuard = false;
            delete this._steamGuardCallback;
        }
    };

    bot.on('friendMessage', (steamID, message) => {
        if (bot.receiveMessages) {
            console.log(`[${bot.username}] Сообщение от ${steamID}: ${message}`);
        }
        if (bot.saveMessages) {
            const dir = path.join(__dirname, `../messages/${bot.username}`);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(path.join(dir, `${steamID}.log`), `${message}\n`);
        }
        if (bot.autoMessage && !bot.messageReceived[steamID]) {
            bot.chatMessage(steamID, bot.autoMessage);
            bot.messageReceived[steamID] = true;
        }
    });

    return bot;
};

module.exports = botFactory;