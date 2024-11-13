import { } from '@hydrooj/vjudge';
import {
    Context, db, Logger, MessageModel, moment, SystemModel, yaml,
} from 'hydrooj';
import { importProblem } from './import';

declare module 'hydrooj' {
    interface Model {
        luogu: {
            importProblem: typeof importProblem;
            addAccount: typeof addAccount;
        };
    }
}

async function addAccount(token: string) {
    await db.collection('vjudge').insertOne({
        _id: String.random(8),
        handle: token.split(':')[0],
        password: token.split(':')[1],
        type: 'luogu',
    });
    return 'success';
}

global.Hydro.model.luogu = {
    importProblem,
    addAccount,
};

const logger = new Logger('vjudge/luogu');

function checkIsSupportedVersion(name: string, min: string) {
    let version;
    try {
        ({ version } = require(`${name}/package.json`));
    } catch (e) {
        logger.error(`洛谷 VJudge 功能需要安装 ${name}，但没有找到该插件。`);
        return false;
    }
    const [major, minor, patch] = version.split('.').map(Number);
    const [minMajor, minMinor, minPatch] = min.split('.').map(Number);
    if (major < minMajor || (major === minMajor && minor < minMinor) || (major === minMajor && minor === minMinor && patch < minPatch)) {
        logger.error(`洛谷 VJudge 功能需要 ${name} 的版本至少为 ${min}，当前版本为 ${version}。`);
        return false;
    }
    return true;
}

export async function apply(ctx: Context) {
    checkIsSupportedVersion('hydrooj', '4.14.1');
    checkIsSupportedVersion('@hydrooj/vjudge', '1.9.10');

    const { default: LuoguProvider } = require('./provider');

    ctx.inject(['migration'], (c) => {
        c.migration.registerChannel('vjudge-luogu', [
            async () => {
                const langs = await SystemModel.get('hydrooj.langs');
                if (!langs.includes('luogu')) return;
                const parsed = yaml.load(langs) as any;
                for (const key in parsed) {
                    if (key.startsWith('luogu.') || key === 'luogu') {
                        delete parsed[key];
                    }
                }
                await SystemModel.set('hydrooj.langs', yaml.dump(parsed));
            },
        ]);
    });

    ctx.inject(['vjudge'], (c) => {
        c.vjudge.addProvider('luogu', LuoguProvider);
        c.on('task/daily', async () => {
            const status = await c.vjudge.checkStatus();
            const id = Object.keys(status).find((k) => k.startsWith('luogu/'));
            const quota = status[id].status;
            const info = `${quota.orgName} 剩余点数: ${quota.availablePoints}
(点数有效期: ${moment(quota.createTime).format('YYYY/MM/DD')}-${moment(quota.expireTime).format('YYYY/MM/DD')})`;
            if (moment(quota.expireTime).diff(moment(), 'days') <= 3) {
                MessageModel.sendNotification(['Hydro & 洛谷开放平台提醒：', info, '点数有效期已不足3天，请及时联系Hydro开发组或洛谷官方进行充值或续费。'].join('\n'));
            }
            if (quota.availablePoints > 0 && quota.availablePoints < 1000) {
                MessageModel.sendNotification(['Hydro & 洛谷开放平台提醒：', info, '点数已不足1000，请及时联系Hydro开发组或洛谷官方进行充值或续费。'].join('\n'));
            }
        });
    });
}
