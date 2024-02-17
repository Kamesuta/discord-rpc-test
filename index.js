import { Client } from 'discord-rpc';
import { LocalStorage } from 'node-localstorage';

// DiscordアプリケーションのクライアントID
const clientId = '207646673902501888';
// Discordアプリケーションのスコープ
const scopes = ['rpc', 'messages.read'];

// ローカルストレージの初期化 (アクセストークン保存用)
const localStorage = new LocalStorage('./saves');

// Discord RPC Client の初期化
const client = new Client({
    transport: 'websocket',
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

    // ボイスチャンネルに接続する
    // const vc = await client.getChannel('1208210197689143337');
    const vc = await client.request('GET_SELECTED_VOICE_CHANNEL');
    console.log(vc);

    // client.setUserVoiceSettings('655572647777796097', {
    //     volume: 0.5,
    //     pan: {
    //         left: 0.9,
    //         right: 0.1,
    //     }
    // });
});

/**
 * Discord/Discord PTB/Discord Canary/Discord Developmentにログインして、入出中のボイスチャンネルを取得します。
 * ボイスチャンネルに入っているクライアントがいない場合は、nullを返します。
 */
async function loginAndGetVoiceChannel(accessToken, tries = 0) {
    try {
        // TransportがWebSocketかIPCかを判定する
        if (client.transport.tries !== undefined) {
            // 接続を試みる
            await new Promise((resolve, reject) => {
                // WebSocketの場合
                client.transport.tries = tries + 20; // 20以上に設定することで、内部で再接続を試みないようにする
                // 20以上に設定することで、必ずエラーが発生するため、エラー時の処理が実行される
                client.transport.on('error', () => reject(new Error('クライアントが見つかりません (WebSocket)')));
                // 接続を試みる
                client.connect(clientId)
                    .then(() => resolve())
                    .catch(() => reject(new Error('接続に失敗しました (WebSocket)')));
            });
        } else {
            // IPCの場合
            const endpoint = `http://127.0.0.1:${6463 + (tries % 10)}`;
            const success = await fetch(endpoint)
                .then((r) => r.status === 404)
                .catch(() => false);

            if (!success) {
                throw new Error('接続に失敗しました (IPC)');
            }
        }

        // Discord/Discord PTB/Discord Canary/Discord Developmentのどれかにログインする
        await client.login({
            clientId,
            scopes,
            accessToken,
            redirectUri: 'https://streamkit.discord.com/',
        }).catch(() => new Error('ログインに失敗しました'));

        // ボイスチャンネルに接続する
        const vc = await client.request('GET_SELECTED_VOICE_CHANNEL');

        if (vc) {
            // ボイスチャンネルに接続できた場合は、そのボイスチャンネルを返す
            return vc;
        } else {
            // ボイスチャンネルに接続できなかった場合は、次のポートを再試行する
            console.warn('接続したDiscordクライアントはボイスチャンネルに接続していません。');
        }
    } catch (error) {
        // ログインに失敗した場合は、次のポートを再試行する
        console.error(error.message);
    }

    // ポートを変えて再試行する
    if (tries >= 10) {
        // ボイスチャンネルに接続できなかった場合は、エラーを投げる
        throw new Error('すべてのDiscordクライアントがボイスチャンネルに接続していません');
    }

    // ボイスチャンネルに接続できなかった場合は、次のポートを再試行する
    console.warn(`次のポートを試します。(${tries + 1}回目)`);

    // Clientをリセットする
    try {
        await client.destroy();
        client._connectPromise = undefined;
    } catch (error) {
        throw new Error('クライアントの破棄に失敗しました');
    }

    // ポートを変えて再試行する
    return await loginAndGetVoiceChannel(accessToken, tries + 1);
}

try {
    // アクセストークンが保存されている場合は、それを利用してログインする
    const accessToken = localStorage.getItem('accessToken');
    if (accessToken) {
        await loginAndGetVoiceChannel(accessToken);
    } else {
        throw new Error('アクセストークンが見つかりません');
    }
} catch (error) {
    // ログ出力
    console.error('アクセストークンでのログインに失敗しました。アクセストークンなしでログインを試みます。');

    // ログインに失敗した場合は、アクセストークンなしでログインする
    await client.login({
        clientId,
        scopes,
        redirectUri: 'https://streamkit.discord.com/',
    });
}
