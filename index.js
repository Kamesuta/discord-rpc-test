import { Client } from 'discord-rpc';
import { LocalStorage } from 'node-localstorage';
import fs from 'fs';

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

// 接続完了時のイベント
client.on('ready', async () => {
    // 接続に成功したら、アクセストークンをローカルストレージに保存する
    // これにより、次回以降は認可を要求することなく、アクセストークンを利用してRPCに接続できる
    localStorage.setItem('accessToken', client.accessToken);

    // 接続完了時のログを出力
    console.log('Logged in as', client.application.name);
    console.log('Authed for user', client.user.username);

    // コマンドライン引数からチャンネルIDを取得
    const channelId = process.argv[2];
    if (!channelId) {
        console.error('チャンネルIDを指定してください。');
        process.exit(1);
    }

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

    // ボイスチャンネルに接続する
    // const vc = await client.getChannel('1208210197689143337');
    const vc = await client.request('GET_SELECTED_VOICE_CHANNEL');
    console.log(vc);

    // ボリュームをいじる
    client.setUserVoiceSettings('922647793347207168', {
        volume: 100,
    });

    // 終了
    process.exit(0);
});

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
    // ログ出力
    console.error('Failed to login with access token, trying to login without access token');

    // ログインに失敗した場合は、アクセストークンなしでログインする
    await client.login({
        clientId,
        scopes,
    });
}
