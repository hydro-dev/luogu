import './import.ts';

import { } from '@hydrooj/vjudge';
import { Context } from 'hydrooj';
import LuoguProvider from './provider';

export async function apply(ctx: Context) {
    ctx.using(['vjudge'], (c) => {
        c.vjudge.addProvider('luogu', LuoguProvider);
    });
}
