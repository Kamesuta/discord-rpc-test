import { Client } from 'discord-rpc';
import { LocalStorage } from 'node-localstorage';
import 'dotenv/config';
import fs from 'fs';
import inquirer from 'inquirer';

// DiscordアプリケーションのクライアントID
const clientId = process.env.DISCORD_CLIENT_ID;
if (!clientId) {
    console.error('DISCORD_CLIENT_IDが設定されていません。.envファイルを確認してください。');
    process.exit(1);
}

// Discordアプリケーションのクライアントシークレット
const clientSecret = process.env.DISCORD_CLIENT_SECRET;
if (!clientSecret) {
    console.error('DISCORD_CLIENT_SECRETが設定されていません。.envファイルを確認してください。');
    process.exit(1);
}

// Discordアプリケーションのスコープ
const scopes = ['rpc', 'messages.read'];

// ローカルストレージの初期化 (アクセストークン保存用)
const localStorage = new LocalStorage('./saves');

// Discord RPC Client の初期化
const client = new Client({
    transport: 'ipc',
});

// メッセージを取得して保存する関数
async function fetchAndSaveMessages(channelId) {
    try {
        // チャンネルを取得
        const channel = await client.getChannel(channelId);

        // チャンネル名を取得
        let channelName = channelId;
        if (channel.name) {
            channelName += `_${channel.name}`;
        }
        console.log('チャンネルを取得しました:', channelName);

        // メッセージを取得
        const messages = channel.messages;
        console.log(`${messages.length}件のメッセージを取得しました。`);

        // メッセージをテキストファイルとして保存
        const outputPath = `./saves/messages_${channelName}.txt`;
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
    console.log('アプリケーション名:', client.application.name);
    console.log('連携ユーザー名:', client.user.username);

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
            }).catch(error => {
                console.error('保存されたアクセストークンでのログインに失敗しました。新規認証が必要です。');
                throw error;
            });
        } else {
            console.error('保存されたアクセストークンがありません。新規認証が必要です。');
            throw new Error('新規認証が必要です。');
        }
    } catch (error) {
        console.error('Discordデスクトップアプリを開き、認証を行ってください。');
        await client.login({
            clientId,
            clientSecret,
            redirectUri: 'http://localhost',
            scopes,
        });
    }
}

// プログラムの実行
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
