const socket = io();
const accountsDiv = document.getElementById('accounts');
const logDiv = document.getElementById('log');
const guardModal = document.getElementById('guardModal');
const guardUsernameDisplay = document.getElementById('guardUsernameDisplay');
const accountModal = document.getElementById('accountModal');
const accountModalTitle = document.getElementById('accountModalTitle');
const accountForm = document.getElementById('accountForm');
const addAccountBtn = document.getElementById('addAccountBtn');
const editUsernameInput = document.getElementById('editUsername');
const themeToggle = document.getElementById('theme-toggle');
const body = document.body;

document.getElementById('clearLogsBtn').addEventListener('click', async function() {
	if (confirm('Вы уверены, что хотите очистить логи? Это действие нельзя отменить.')) {
		try {
			await apiRequest('/api/clear-logs', 'POST');
			loadLogs();
			socket.emit('log', 'Логи очищены.\n');
		} catch (error) {
			console.error("Failed to clear logs:", error);
			alert('Не удалось очистить логи.');
		}
	}
});

let currentGuardUsername = null;
let accountsCache = [];
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
	body.classList.add('light-mode');
	themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
	themeToggle.setAttribute('aria-label', 'Переключить на темную тему');
} else {
	body.classList.remove('light-mode');
	themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
	themeToggle.setAttribute('aria-label', 'Переключить на светлую тему');
}
themeToggle.addEventListener('click', () => {
	if (body.classList.contains('light-mode')) {
		body.classList.remove('light-mode');
		localStorage.setItem('theme', 'dark');
		themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
		themeToggle.setAttribute('aria-label', 'Переключить на светлую тему');
	} else {
		body.classList.add('light-mode');
		localStorage.setItem('theme', 'light');
		themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
		themeToggle.setAttribute('aria-label', 'Переключить на темную тему');
	}
});
socket.on('connect', () => {
	console.log('Socket connected');
	loadAccounts();
	loadLogs();
});
socket.on('log', msg => {
	logDiv.textContent += msg;
	if (logDiv.scrollHeight - logDiv.scrollTop <= logDiv.clientHeight + 50) {
		logDiv.scrollTop = logDiv.scrollHeight;
	}
});
socket.on('steamGuardRequest', data => {
	currentGuardUsername = data.username;
	guardUsernameDisplay.textContent = `Аккаунт: ${data.username}`;
	openModal('guardModal');
});
socket.on('statusUpdate', loadAccounts);
async function apiRequest(url, method = 'GET', body = null) {
	try {
		const options = {
			method,
			headers: {}
		};
		if (body) {
			options.headers['Content-Type'] = 'application/json';
			options.body = JSON.stringify(body);
		}
		const response = await fetch(url, options);
		if (!response.ok) {
			const errorData = await response.json().catch(() => ({
				message: response.statusText
			}));
			throw new Error(errorData.message || `HTTP error ${response.status}`);
		}
		if (response.status === 204 || response.headers.get('content-length') === '0') {
			return null;
		}
		const contentType = response.headers.get("content-type");
		if (contentType && contentType.indexOf("application/json") !== -1) {
			return await response.json();
		} else {
			return await response.text();
		}
	} catch (error) {
		console.error(`API request failed: ${method} ${url}`, error);
		alert(`Ошибка API: ${error.message}`);
		throw error;
	}
}
async function loadAccounts() {
	try {
		accountsCache = await apiRequest('/api/accounts');
		renderAccounts(accountsCache);
	} catch (error) {
		accountsDiv.innerHTML = '<p style="color: var(--danger-color);">Не удалось загрузить аккаунты.</p>';
	}
}

function renderAccounts(accounts) {
	accountsDiv.innerHTML = '';
	if (!accounts || accounts.length === 0) {
		accountsDiv.innerHTML = '<p style="color: var(--secondary-color);">Нет добавленных аккаунтов.</p>';
		return;
	}
	accounts.forEach(acc => {
		const statusClass = acc.running ? 'running' : 'stopped';
		const statusText = acc.running ? '🟢 Работает' : '🔴 Остановлен';
		const gamesList = acc.gamesAndStatus && acc.gamesAndStatus.length > 0 ? acc.gamesAndStatus.map(id => `<code>${id}</code>`).join(', ') : 'Нет игр';
		const div = document.createElement('div');
		div.className = 'card account-card';
		div.innerHTML = `<div class="account-header">
				<div class="account-info">
					<span class="username">${acc.username}</span>
					<span class="status ${statusClass}">${statusText}</span>
				</div>
				<div class="account-actions">
					<button class="btn-start" onclick="start('${acc.username}')" ${acc.running ? 'disabled' : ''}><i class="fas fa-play"></i> Запустить</button>
					<button class="btn-stop" onclick="stop('${acc.username}')" ${!acc.running ? 'disabled' : ''}><i class="fas fa-stop"></i> Остановить</button>
					<button class="btn-edit" onclick="showEditModal('${acc.username}')"><i class="fas fa-pencil-alt"></i> Редактировать</button>
					<button class="btn-delete" onclick="deleteAccount('${acc.username}')"><i class="fas fa-trash-alt"></i> Удалить</button>
				</div>
			</div>
			<div class="account-games">
				Игры: ${gamesList}
			</div>`;
		accountsDiv.appendChild(div);
	});
}

async function manageAccount(action, username) {
	const endpoints = {
		start: { method: 'POST', url: '/api/start' },
		stop: { method: 'POST', url: '/api/stop' },
		delete: { method: 'DELETE', url: `/api/delete-account/${username}` }
	};

	if (action === 'delete') {
		const message = `Вы уверены, что хотите удалить аккаунт ${username}? Это действие необратимо.`;
		if (!confirm(message)) return;
	}

	try {
		const { method, url } = endpoints[action];
		await apiRequest(url, method, action !== 'delete' ? { username } : null);
	} catch (error) {
		console.debug(`Account ${action} error:`, error);
	}
}
const start = username => manageAccount('start', username);
const stop = username => manageAccount('stop', username);
const deleteAccount = username => manageAccount('delete', username);

function openModal(modalId) {
	document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modalId) {
	document.getElementById(modalId).style.display = 'none';
	if (modalId === 'accountModal') {
		accountForm.reset();
		editUsernameInput.value = '';
		document.getElementById('username').disabled = false;
		document.getElementById('password').required = true;
	}
	if (modalId === 'guardModal') {
		document.getElementById('guardCode').value = '';
	}
}
addAccountBtn.onclick = () => {
	accountModalTitle.textContent = 'Добавить Аккаунт';
	accountForm.reset();
	editUsernameInput.value = '';
	document.getElementById('username').disabled = false;
	document.getElementById('password').required = true;
	document.getElementById('enableStatus').checked = true;
	document.getElementById('receiveMessages').checked = false;
	document.getElementById('saveMessages').checked = false;
	openModal('accountModal');
};

function showEditModal(username) {
	const account = accountsCache.find(acc => acc.username === username);
	if (!account) {
		alert('Не удалось найти данные аккаунта для редактирования.');
		return;
	}
	accountModalTitle.textContent = `Редактировать Аккаунт: ${username}`;
	editUsernameInput.value = username;
	document.getElementById('username').value = account.username;
	document.getElementById('username').disabled = true;
	document.getElementById('password').value = '';
	document.getElementById('password').required = false;
	document.getElementById('sharedSecret').value = account.sharedSecret || '';
	document.getElementById('games').value = account.gamesAndStatus ? account.gamesAndStatus.join(', ') : '';
	document.getElementById('replyMessage').value = account.replyMessage || '';
	document.getElementById('enableStatus').checked = account.enableStatus;
	document.getElementById('receiveMessages').checked = account.receiveMessages;
	document.getElementById('saveMessages').checked = account.saveMessages;
	openModal('accountModal');
}
async function submitAccountForm(event) {
	event.preventDefault();
	const isEditing = !!editUsernameInput.value;
	const username = isEditing ? editUsernameInput.value : document.getElementById('username').value.trim();
	const password = document.getElementById('password').value;
	if (!isEditing && !password) {
		alert('Пароль обязателен при добавлении нового аккаунта.');
		return;
	}
	const gamesValue = document.getElementById('games').value.trim();
	const gamesArray = gamesValue ? gamesValue.split(',').map(id => parseInt(id.trim(), 10)).filter(Number.isFinite) : [];
	const accountData = {
		password: password,
		sharedSecret: document.getElementById('sharedSecret').value.trim(),
		gamesAndStatus: gamesArray,
		enableStatus: document.getElementById('enableStatus').checked,
		replyMessage: document.getElementById('replyMessage').value.trim(),
		receiveMessages: document.getElementById('receiveMessages').checked,
		saveMessages: document.getElementById('saveMessages').checked
	};
	if (isEditing && !accountData.password) {
		delete accountData.password;
	}
	try {
		if (isEditing) {
			await apiRequest(`/api/edit-account/${username}`, 'PUT', accountData);
		} else {
			accountData.username = username;
			await apiRequest('/api/add-account', 'POST', accountData);
		}
		closeModal('accountModal');
	} catch (error) {
		console.error("Failed to save account:", error);
	} finally {
		document.getElementById('password').required = true;
	}
}
async function submitGuard(event) {
	event.preventDefault();
	const code = document.getElementById('guardCode').value;
	if (!currentGuardUsername || !code) return;
	try {
		await apiRequest('/api/submit-guard', 'POST', {
			username: currentGuardUsername,
			code
		});
		closeModal('guardModal');
	} catch (error) {
		document.getElementById('guardCode').value = '';
	}
}
async function loadLogs() {
	try {
		const logs = await apiRequest('/api/logs');
		logDiv.textContent = logs || 'Логи пусты.';
		logDiv.scrollTop = logDiv.scrollHeight;
	} catch (error) {
		logDiv.textContent = 'Не удалось загрузить логи.';
	}
}
loadAccounts();
loadLogs();
// Периодическое обновление статусов (на всякий случай, если WebSocket отвалится)
// setInterval(loadAccounts, 15000); // каждые 15 секунд
// Закрытие модалок по клику вне контента (необязательно, но удобно)
window.onclick = function(event) {
	if (event.target.classList.contains('modal')) {
		closeModal(event.target.id);
	}
}