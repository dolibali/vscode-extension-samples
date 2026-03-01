import * as vscode from 'vscode';

// ─── 模拟数据 ────────────────────────────────────────────────────────────────

const MOCK_HISTORY = [
	{ id: 1, title: 'TypeScript 泛型详解', time: '今天 10:30' },
	{ id: 2, title: 'VS Code 插件开发入门', time: '今天 09:15' },
	{ id: 3, title: 'React 组件性能优化', time: '昨天 16:42' },
	{ id: 4, title: 'Node.js 异步编程', time: '昨天 11:20' },
	{ id: 5, title: 'Git 分支管理规范', time: '2天前' },
];

const MOCK_MESSAGES = [
	{ role: 'ai', content: '你好！我是 AI Coding 助手 👋\n有什么代码问题可以帮你解答？' },
	{ role: 'user', content: '帮我解释一下 TypeScript 中的泛型' },
	{
		role: 'ai',
		content:
			'泛型（Generics）允许你编写可复用、类型安全的代码。\n\n最简单的例子：\n\n```typescript\nfunction identity<T>(arg: T): T {\n    return arg;\n}\n\n// 使用时 T 会被推断为具体类型\nconst num = identity(42);      // T = number\nconst str = identity("hello"); // T = string\n```\n\n这样一个函数就能处理任意类型，又不丢失类型信息。',
	},
];

// ─── IDE 模式：侧边栏聊天视图 ────────────────────────────────────────────────

class ChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'aiCoding.chatView';
	private _view?: vscode.WebviewView;

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this._view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getChatSidebarHtml();
	}

	/** 聚焦到这个视图 */
	focus() {
		this._view?.show(true);
	}
}

// ─── 插件入口 ─────────────────────────────────────────────────────────────────

let soloPanel: vscode.WebviewPanel | undefined;

export async function activate(context: vscode.ExtensionContext) {
	// 注册侧边栏聊天视图
	const chatProvider = new ChatViewProvider();
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider),
	);

	// 等待 workbench 完全初始化后，打开视图并尝试移动到右侧辅助栏
	setTimeout(async () => {
		console.log('[AI Coding] 开始初始化视图...');
		
		try {
			// 步骤1: 先打开视图容器（确保它被加载）
			await vscode.commands.executeCommand('workbench.view.extension.ai-coding');
			console.log('[AI Coding] ✓ workbench.view.extension.ai-coding 执行成功');
			
			// 步骤2: 尝试移动视图容器到右侧辅助栏
			// 注意：这个命令可能在某些 VS Code 版本中不可用
			try {
				await vscode.commands.executeCommand('workbench.action.moveViewContainerToSecondarySideBar', 'ai-coding');
				console.log('[AI Coding] ✓ moveViewContainerToSecondarySideBar 执行成功');
			} catch (moveErr) {
				console.warn('[AI Coding] ⚠ moveViewContainerToSecondarySideBar 不可用:', moveErr);
				// 如果移动命令不可用，尝试直接打开辅助栏
				await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
				console.log('[AI Coding] ✓ focusAuxiliaryBar 执行成功（备用方案）');
			}
			
			// 步骤3: 聚焦聊天视图
			await vscode.commands.executeCommand('aiCoding.chatView.focus');
			console.log('[AI Coding] ✓ chatView.focus 执行成功');
			
		} catch (err) {
			console.error('[AI Coding] ✗ 命令执行失败:', err);
			vscode.window.showErrorMessage(`AI Coding: 视图初始化失败 - ${err}`);
		}
	}, 1500);

	// ── 状态栏按钮（始终可见，无需打开文件）────────────────────────────────────
	// VS Code 扩展无法在顶部标题栏（Command Center 那一行）添加按钮，
	// 这是平台限制，只有 fork VS Code 才能实现（如 Cursor）。
	// 状态栏是扩展能使用的唯一"始终可见"位置，放在左侧最醒目的位置。
	const ideBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	ideBtn.text = '$(layout-sidebar-right) IDE';
	ideBtn.command = 'aiCoding.ideMode';
	ideBtn.tooltip = '切换到 IDE 模式（侧边栏聊天）';
	ideBtn.show();
	context.subscriptions.push(ideBtn);

	const soloBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	soloBtn.text = '$(screen-full) SOLO';
	soloBtn.command = 'aiCoding.soloMode';
	soloBtn.tooltip = '切换到 SOLO 模式（全屏聊天）';
	soloBtn.show();
	context.subscriptions.push(soloBtn);

	// 记住活动栏和侧边栏是否已被隐藏（用于恢复）
	let activityBarHiddenByUs = false;
	let sidebarHiddenByUs = false;

	/** 切换状态栏高亮，表示当前所处模式 */
	function setMode(mode: 'ide' | 'solo') {
		const active = new vscode.ThemeColor('statusBarItem.warningBackground');
		ideBtn.backgroundColor  = mode === 'ide'  ? active : undefined;
		soloBtn.backgroundColor = mode === 'solo' ? active : undefined;
	}
	setMode('ide'); // 默认 IDE 模式高亮

	// ── IDE 模式命令 ──────────────────────────────────────────────────────────
	// 关闭 SOLO 全屏面板，打开右侧辅助栏聊天视图
	context.subscriptions.push(
		vscode.commands.registerCommand('aiCoding.ideMode', async () => {
			setMode('ide');
			// 关闭 SOLO 面板
			soloPanel?.dispose();
			soloPanel = undefined;

			// 恢复活动栏显示（如果我们之前隐藏了它）
			if (activityBarHiddenByUs) {
				try {
					await vscode.commands.executeCommand('workbench.action.toggleActivityBarVisibility');
					console.log('[AI Coding] ✓ 恢复活动栏显示');
					activityBarHiddenByUs = false;
				} catch (e) {
					console.warn('[AI Coding] ⚠ 恢复活动栏失败:', e);
				}
			}

			// 恢复侧边栏显示（如果我们之前隐藏了它，使用 toggle 保持视图状态）
			if (sidebarHiddenByUs) {
				try {
					await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
					console.log('[AI Coding] ✓ 恢复侧边栏显示');
					sidebarHiddenByUs = false;
				} catch (e) {
					console.warn('[AI Coding] ⚠ 恢复侧边栏失败:', e);
				}
			}

			// 打开右侧辅助栏并聚焦聊天视图
			await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
			await vscode.commands.executeCommand('aiCoding.chatView.focus');
		}),
	);

	// ── SOLO 模式命令 ─────────────────────────────────────────────────────────
	// 打开全屏 Webview 面板，包含历史对话列表 + 聊天区
	context.subscriptions.push(
		vscode.commands.registerCommand('aiCoding.soloMode', async () => {
			// 如果面板已存在，直接聚焦，不重复执行隐藏命令
			if (soloPanel) {
				soloPanel.reveal(vscode.ViewColumn.One, true);
				return;
			}

			setMode('solo');
			
			// 隐藏活动栏（使用 toggle 命令）
			const config = vscode.workspace.getConfiguration('workbench');
			const activityBarVisible = config.get<boolean>('activityBar.visible');
			if (activityBarVisible !== false) {
				try {
					await vscode.commands.executeCommand('workbench.action.toggleActivityBarVisibility');
					activityBarHiddenByUs = true;
					console.log('[AI Coding] ✓ 隐藏活动栏');
				} catch (e) {
					console.warn('[AI Coding] ⚠ 隐藏活动栏失败:', e);
				}
			}
			
			// 隐藏侧边栏（使用 toggle 命令，保持视图状态）
			try {
				await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
				sidebarHiddenByUs = true;
				console.log('[AI Coding] ✓ 隐藏侧边栏');
			} catch (e) {
				console.warn('[AI Coding] ⚠ 隐藏侧边栏失败:', e);
			}
			
			// 关闭底部面板
			try {
				await vscode.commands.executeCommand('workbench.action.closePanel');
				console.log('[AI Coding] ✓ 关闭面板');
			} catch (e) {
				console.warn('[AI Coding] ⚠ 关闭面板失败:', e);
			}
			
			// 关闭右侧辅助栏
			try {
				await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
				console.log('[AI Coding] ✓ 关闭辅助栏');
			} catch (e) {
				console.warn('[AI Coding] ⚠ 关闭辅助栏失败:', e);
			}

			// 创建全屏 Webview 面板
			soloPanel = vscode.window.createWebviewPanel(
				'aiCoding.soloView',
				'AI Coding',
				vscode.ViewColumn.One,
				{ enableScripts: true, retainContextWhenHidden: true },
			);
			soloPanel.webview.html = getSoloHtml();
			soloPanel.onDidDispose(async () => {
				soloPanel = undefined;
				// 用户关闭面板时，切换回 IDE 模式
				setMode('ide');
				// 恢复活动栏显示（如果我们之前隐藏了它）
				if (activityBarHiddenByUs) {
					try {
						await vscode.commands.executeCommand('workbench.action.toggleActivityBarVisibility');
						console.log('[AI Coding] ✓ 恢复活动栏显示');
						activityBarHiddenByUs = false;
					} catch (e) {
						console.warn('[AI Coding] ⚠ 恢复活动栏失败:', e);
					}
				}
				// 恢复侧边栏显示（如果我们之前隐藏了它）
				if (sidebarHiddenByUs) {
					try {
						await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
						console.log('[AI Coding] ✓ 恢复侧边栏显示');
						sidebarHiddenByUs = false;
					} catch (e) {
						console.warn('[AI Coding] ⚠ 恢复侧边栏失败:', e);
					}
				}
			});
		}),
	);
}

export function deactivate() {}

// ─── HTML：侧边栏聊天视图（IDE 模式）────────────────────────────────────────

function getChatSidebarHtml(): string {
	const messages = MOCK_MESSAGES.map(
		(m) => `
		<div class="message ${m.role}">
			<div class="avatar">${m.role === 'ai' ? '🤖' : '👤'}</div>
			<div class="bubble">${renderContent(m.content)}</div>
		</div>`,
	).join('');

	return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
	* { box-sizing: border-box; margin: 0; padding: 0; }

	body {
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size, 13px);
		color: var(--vscode-foreground);
		background: var(--vscode-sideBar-background);
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
	}

	/* 消息列表 */
	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 12px 10px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.message { display: flex; gap: 8px; align-items: flex-start; }
	.message.user { flex-direction: row-reverse; }
	.avatar { font-size: 15px; flex-shrink: 0; margin-top: 2px; }
	.bubble {
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, transparent);
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 12px;
		line-height: 1.6;
		max-width: 88%;
		word-break: break-word;
	}
	.message.user .bubble {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}
	pre {
		background: rgba(0,0,0,0.25);
		border-radius: 4px;
		padding: 8px;
		margin: 6px 0;
		overflow-x: auto;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 11px;
		white-space: pre;
	}

	/* 输入区 */
	.input-area {
		padding: 8px;
		border-top: 1px solid var(--vscode-panel-border);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	textarea {
		width: 100%;
		height: 58px;
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, transparent);
		border-radius: 5px;
		padding: 6px 8px;
		font-family: var(--vscode-font-family);
		font-size: 12px;
		resize: none;
		outline: none;
	}
	textarea:focus { border-color: var(--vscode-focusBorder); }
	.send-row { display: flex; justify-content: flex-end; }
	button {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border: none;
		border-radius: 4px;
		padding: 4px 14px;
		font-size: 12px;
		cursor: pointer;
	}
	button:hover { background: var(--vscode-button-hoverBackground); }

	::-webkit-scrollbar { width: 3px; }
	::-webkit-scrollbar-thumb {
		background: var(--vscode-scrollbarSlider-background);
		border-radius: 2px;
	}
</style>
</head>
<body>
	<div class="messages" id="messages">${messages}</div>
	<div class="input-area">
		<textarea id="input" placeholder="输入问题... （Enter 发送，Shift+Enter 换行）"></textarea>
		<div class="send-row"><button onclick="send()">发送</button></div>
	</div>
<script>
	const messagesEl = document.getElementById('messages');
	const inputEl    = document.getElementById('input');
	messagesEl.scrollTop = messagesEl.scrollHeight;

	inputEl.addEventListener('keydown', e => {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
	});

	function send() {
		const text = inputEl.value.trim();
		if (!text) return;
		appendMsg('user', text);
		inputEl.value = '';
		setTimeout(() => appendMsg('ai', '正在思考中...\n\n（真实插件中此处调用大模型 API 并流式返回结果）'), 800);
	}

	function appendMsg(role, content) {
		const div = document.createElement('div');
		div.className = 'message ' + role;
		div.innerHTML = \`<div class="avatar">\${role==='ai'?'🤖':'👤'}</div>
			<div class="bubble">\${escHtml(content).replace(/\\n/g,'<br>')}</div>\`;
		messagesEl.appendChild(div);
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	function escHtml(s) {
		return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
	}
</script>
</body>
</html>`;
}

// ─── HTML：SOLO 全屏视图 ──────────────────────────────────────────────────────

function getSoloHtml(): string {
	const historyItems = MOCK_HISTORY.map(
		(h, i) => `
		<div class="hist-item${i === 0 ? ' active' : ''}" onclick="selectConv(this)">
			<div class="hist-title">${h.title}</div>
			<div class="hist-time">${h.time}</div>
		</div>`,
	).join('');

	const messages = MOCK_MESSAGES.map(
		(m) => `
		<div class="message ${m.role}">
			<div class="avatar">${m.role === 'ai' ? '🤖' : '👤'}</div>
			<div class="bubble">${renderContent(m.content)}</div>
		</div>`,
	).join('');

	return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
	* { box-sizing: border-box; margin: 0; padding: 0; }

	body {
		font-family: var(--vscode-font-family);
		font-size: 13px;
		color: var(--vscode-foreground);
		background: var(--vscode-editor-background);
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
	}

	/* ── 顶部标题栏 ── */
	.titlebar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 20px;
		background: var(--vscode-titleBar-activeBackground, #1e1e1e);
		border-bottom: 1px solid var(--vscode-panel-border);
		flex-shrink: 0;
		user-select: none;
	}
	.titlebar h1 { font-size: 15px; font-weight: 600; }
	.badge {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		font-size: 10px;
		font-weight: 700;
		padding: 2px 7px;
		border-radius: 10px;
		letter-spacing: 0.5px;
	}

	/* ── 主体：左栏 + 右栏 ── */
	.main {
		display: flex;
		flex: 1;
		overflow: hidden;
	}

	/* ── 左侧历史对话栏 ── */
	.history {
		width: 220px;
		flex-shrink: 0;
		background: var(--vscode-sideBar-background);
		border-right: 1px solid var(--vscode-panel-border);
		display: flex;
		flex-direction: column;
	}
	.history-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 14px 8px;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--vscode-sideBarSectionHeader-foreground);
		flex-shrink: 0;
	}
	.new-btn {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border: none;
		border-radius: 3px;
		padding: 2px 8px;
		font-size: 11px;
		cursor: pointer;
		font-weight: normal;
		text-transform: none;
		letter-spacing: 0;
	}
	.new-btn:hover { background: var(--vscode-button-hoverBackground); }
	.history-list { flex: 1; overflow-y: auto; padding: 4px 6px; }
	.hist-item {
		padding: 8px 10px;
		border-radius: 5px;
		cursor: pointer;
		margin-bottom: 2px;
	}
	.hist-item:hover { background: var(--vscode-list-hoverBackground); }
	.hist-item.active {
		background: var(--vscode-list-activeSelectionBackground);
		color: var(--vscode-list-activeSelectionForeground);
	}
	.hist-title {
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hist-time { font-size: 11px; opacity: 0.55; margin-top: 2px; }

	/* ── 右侧聊天区 ── */
	.chat {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 24px 20px;
		display: flex;
		flex-direction: column;
		gap: 18px;
		max-width: 820px;
		width: 100%;
		margin: 0 auto;
		align-self: center;
	}
	.message { display: flex; gap: 12px; align-items: flex-start; }
	.message.user { flex-direction: row-reverse; }
	.avatar { font-size: 20px; flex-shrink: 0; margin-top: 2px; }
	.bubble {
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.08));
		border-radius: 10px;
		padding: 10px 14px;
		line-height: 1.65;
		max-width: 76%;
		word-break: break-word;
	}
	.message.user .bubble {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}
	pre {
		background: rgba(0,0,0,0.3);
		border-radius: 6px;
		padding: 10px 12px;
		margin: 8px 0;
		overflow-x: auto;
		font-family: var(--vscode-editor-font-family, monospace);
		font-size: 12px;
		white-space: pre;
	}

	/* ── 底部输入区 ── */
	.input-wrapper {
		padding: 14px 20px;
		border-top: 1px solid var(--vscode-panel-border);
		display: flex;
		justify-content: center;
	}
	.input-box {
		display: flex;
		gap: 8px;
		align-items: flex-end;
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, transparent);
		border-radius: 8px;
		padding: 8px 10px;
		width: 100%;
		max-width: 780px;
	}
	.input-box:focus-within { border-color: var(--vscode-focusBorder); }
	textarea {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--vscode-input-foreground);
		font-family: var(--vscode-font-family);
		font-size: 13px;
		resize: none;
		min-height: 22px;
		max-height: 130px;
		line-height: 1.5;
	}
	.send-btn {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border: none;
		border-radius: 6px;
		width: 34px;
		height: 34px;
		font-size: 16px;
		cursor: pointer;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.send-btn:hover { background: var(--vscode-button-hoverBackground); }

	::-webkit-scrollbar { width: 4px; height: 4px; }
	::-webkit-scrollbar-thumb {
		background: var(--vscode-scrollbarSlider-background);
		border-radius: 2px;
	}
</style>
</head>
<body>
	<!-- 标题栏 -->
	<div class="titlebar">
		<span style="font-size:20px">🤖</span>
		<h1>AI Coding</h1>
		<span class="badge">SOLO</span>
	</div>

	<div class="main">
		<!-- 左侧：历史对话 -->
		<div class="history">
			<div class="history-header">
				历史对话
				<button class="new-btn">＋ 新建</button>
			</div>
			<div class="history-list">${historyItems}</div>
		</div>

		<!-- 右侧：聊天区 -->
		<div class="chat">
			<div class="messages" id="messages">${messages}</div>
			<div class="input-wrapper">
				<div class="input-box">
					<textarea id="input" rows="1"
						placeholder="输入你的问题...（Enter 发送，Shift+Enter 换行）">
					</textarea>
					<button class="send-btn" onclick="send()" title="发送">↑</button>
				</div>
			</div>
		</div>
	</div>

<script>
	const messagesEl = document.getElementById('messages');
	const inputEl    = document.getElementById('input');
	messagesEl.scrollTop = messagesEl.scrollHeight;

	// 自动撑高输入框
	inputEl.addEventListener('input', function () {
		this.style.height = 'auto';
		this.style.height = Math.min(this.scrollHeight, 130) + 'px';
	});
	inputEl.addEventListener('keydown', e => {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
	});

	function send() {
		const text = inputEl.value.trim();
		if (!text) return;
		appendMsg('user', text);
		inputEl.value = '';
		inputEl.style.height = 'auto';
		setTimeout(() => {
			appendMsg('ai', '正在思考中...\n\n（真实插件中此处调用大模型 API 并流式返回结果）');
		}, 800);
	}

	function appendMsg(role, content) {
		const div = document.createElement('div');
		div.className = 'message ' + role;
		div.innerHTML = \`
			<div class="avatar">\${role === 'ai' ? '🤖' : '👤'}</div>
			<div class="bubble">\${escHtml(content).replace(/\\n/g, '<br>')}</div>\`;
		messagesEl.appendChild(div);
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	function selectConv(el) {
		document.querySelectorAll('.hist-item').forEach(e => e.classList.remove('active'));
		el.classList.add('active');
	}

	function escHtml(s) {
		return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
	}
</script>
</body>
</html>`;
}

// ─── 工具函数：渲染消息内容（代码块 → <pre>，换行 → <br>）──────────────────

function renderContent(content: string): string {
	// 将 ```lang\n...\n``` 转为 <pre><code>...</code></pre>
	const withCode = content.replace(
		/```(?:\w+)?\n([\s\S]*?)```/g,
		(_match, code) =>
			`</p><pre><code>${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre><p>`,
	);
	// 转义剩余 HTML，换行转 <br>
	return withCode
		.split(/(<pre>[\s\S]*?<\/pre>)/g)
		.map((part) => {
			if (part.startsWith('<pre>')) return part;
			return part
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/\n/g, '<br>');
		})
		.join('');
}
