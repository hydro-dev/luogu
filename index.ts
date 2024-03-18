import { } from '@hydrooj/vjudge';
import {
    Context, db, MessageModel, moment,
} from 'hydrooj';
import { importProblem } from './import';
import LuoguProvider from './provider';

declare module 'hydrooj' {
    interface Model {
        luogu: {
            importProblem: typeof importProblem;
            addAccount: typeof addAccount;
        };
    }
}

async function addAccount(token: string) {
    const newProvider = new LuoguProvider({
        _id: 'test', type: 'luogu', handle: token.split(':')[0], password: token.split(':')[1],
    }, async () => {});
    try {
        const info = await newProvider.checkStatus(true);
        console.log(info);
    } catch (e) {
        throw new Error('Invalid account');
    }
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

export async function apply(ctx: Context) {
    ctx.inject(['vjudge'], (c) => {
        c.vjudge.addProvider('luogu', LuoguProvider);
    });

    ctx.on('task/daily', async () => {
        const status = await ctx.vjudge.checkStatus();
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
}
