import { Client } from 'discord-rpc';
import { LocalStorage } from 'node-localstorage';
import fs from 'fs';
import inquirer from 'inquirer';

// DiscordアプリケーションのクライアントID
const clientId = '207646673902501888';
// Discordアプリケーションのスコープ
const scopes = ['rpc', 'messages.read'];

// ローカルストレージの初期化 (アクセストークン保存用)
const localStorage = new LocalStorage('./saves');

// Discord RPC Client の初期化
const client = new Client({
    transport: 'ipc',
    origin: 'https://streamkit.discord.com',
});

/**
 * Discord StreamKit のAPIを利用してアクセストークンを取得します。
 * (本来は自分で作ったアプリケーションのAPIを利用するべきですが、まだAPIが公開されていないため、StreamKitのAPIを利用しています)
 * 
 * StreamKitのAPIを利用するために、discord-rpcの内部関数を上書きしています。
 * 
 * @param {Object} options options
 * @returns {Promise}
 * @private
 */
client.authorize = async function ({ scopes, rpcToken, prompt } = {}) {
    // Discordデスクトップアプリに認可を要求する
    // この時点で、Discordデスクトップアプリに、認可を要求するダイアログが表示されます。
    const { code } = await this.request('AUTHORIZE', {
        scopes,
        client_id: this.clientId,
        prompt,
        rpc_token: rpcToken,
    });

    // StreamKitのAPIを利用してアクセストークンを取得する
    const fetchStreamKit = ({ data } = {}) =>
        fetch("https://streamkit.discord.com/overlay/token", {
            "body": JSON.stringify(data),
            "method": "POST",
        }).then(async (r) => {
            const body = await r.json();
            if (!r.ok) {
                const e = new Error(r.status);
                e.body = body;
                throw e;
            }
            return body;
        });

    // APIを叩いて、トークンを取得し、返す
    const { access_token } = await fetchStreamKit({
        data: { code },
    });
    return access_token;
}

// メッセージを取得して保存する関数
async function fetchAndSaveMessages(channelId) {
    try {
        // チャンネルを取得
        const channel = await client.getChannel(channelId);
        console.log('チャンネルを取得しました:', channel.name);

        // メッセージを取得
        const messages = channel.messages;
        console.log(`${messages.length}件のメッセージを取得しました。`);

        // メッセージをテキストファイルとして保存
        const outputPath = `messages_${channelId}.txt`;
        const messageTexts = messages.map(msg => {
            const timestamp = new Date(msg.timestamp).toLocaleString();
            return `[${timestamp}] ${msg.author.username}: ${msg.content}`;
        }).join('\n');
        
        fs.writeFileSync(outputPath, messageTexts);
        console.log(`メッセージを ${outputPath} に保存しました。`);
    } catch (error) {
        console.error('エラーが発生しました:', error);
    }
}

// 接続完了時のイベント
client.on('ready', async () => {
    localStorage.setItem('accessToken', client.accessToken);
    console.log('Logged in as', client.application.name);
    console.log('Authed for user', client.user.username);

    let lastChannelId = null;

    while (true) {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'channelId',
                message: 'チャンネルIDを入力してください:',
                default: lastChannelId,
                validate: input => input.length > 0 ? true : 'チャンネルIDは必須です'
            }
        ]);

        lastChannelId = answers.channelId;
        await fetchAndSaveMessages(lastChannelId);
    }
});

// メインの処理
async function main() {
    try {
        // アクセストークンが保存されている場合は、それを利用してログインする
        const accessToken = localStorage.getItem('accessToken');
        if (accessToken) {
            await client.login({
                clientId,
                scopes,
                accessToken,
            });
        } else {
            throw new Error('Access token not found');
        }
    } catch (error) {
        console.error('Failed to login with access token, trying to login without access token');
        await client.login({
            clientId,
            scopes,
        });
    }
}

// プログラムの実行
main().catch(console.error);
