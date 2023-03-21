import { } from '@hydrooj/vjudge';
import { Context, db } from 'hydrooj';
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
    // TODO check validity
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
    ctx.using(['vjudge'], (c) => {
        c.vjudge.addProvider('luogu', LuoguProvider);
    });
}
