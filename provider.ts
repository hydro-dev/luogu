/* eslint-disable no-await-in-loop */
import { JSDOM } from 'jsdom';
import { BasicFetcher } from '@hydrooj/vjudge/src/fetch';
import { IBasicProvider, RemoteAccount } from '@hydrooj/vjudge/src/interface';
import {
    _, Logger, SettingModel, sleep, STATUS, superagent,
} from 'hydrooj';

const logger = new Logger('remote/luogu');

const STATUS_MAP = [
    STATUS.STATUS_WAITING,
    STATUS.STATUS_JUDGING,
    STATUS.STATUS_COMPILE_ERROR,
    STATUS.STATUS_OUTPUT_LIMIT_EXCEEDED,
    STATUS.STATUS_MEMORY_LIMIT_EXCEEDED,
    STATUS.STATUS_TIME_LIMIT_EXCEEDED,
    STATUS.STATUS_WRONG_ANSWER,
    STATUS.STATUS_RUNTIME_ERROR,
    0,
    0,
    0,
    STATUS.STATUS_SYSTEM_ERROR,
    STATUS.STATUS_ACCEPTED,
    0,
    STATUS.STATUS_WRONG_ANSWER,
];

const UA = [
    `Hydro/${global.Hydro.version.hydrooj}`,
    `Vjudge/${global.Hydro.version.vjudge}`,
].join(' ');

export default class LuoguProvider extends BasicFetcher implements IBasicProvider {
    constructor(public account: RemoteAccount, private save: (data: any) => Promise<void>) {
        super(account, 'https://www.luogu.com.cn', 'form', logger, {
            headers: { 'User-Agent': UA },
            post: {
                headers: {
                    'x-requested-with': 'XMLHttpRequest',
                    origin: 'https://www.luogu.com.cn',
                },
            },
        });
        setInterval(() => this.getCsrfToken('/user/setting'), 5 * 60 * 1000);
    }

    csrf: string;

    post(url: string) {
        logger.debug('post', url, this.cookie);
        if (!url.includes('//')) url = `${this.account.endpoint || 'https://www.luogu.com.cn'}${url}`;
        const req = superagent.post(url)
            .set('Cookie', this.cookie)
            .set('x-csrf-token', this.csrf)
            .set('User-Agent', UA)
            .set('x-requested-with', 'XMLHttpRequest')
            .set('origin', 'https://www.luogu.com.cn');
        return req;
    }

    async getCsrfToken(url: string) {
        const { text: html } = await this.get(url);
        const $dom = new JSDOM(html);
        this.csrf = $dom.window.document.querySelector('meta[name="csrf-token"]')!.getAttribute('content')!;
        logger.info('csrf-token=', this.csrf);
    }

    get loggedIn() {
        return this.get('/user/setting?_contentOnly=1').then(({ body }) => body.currentTemplate !== 'AuthLogin');
    }

    async ensureLogin() {
        if (await this.loggedIn) {
            await this.getCsrfToken('/user/setting');
            return true;
        }
        logger.info('retry login');
        // TODO login;
        return false;
    }

    async getProblem(id: string) {
        return {
            title: id,
            data: {},
            files: {},
            tag: [],
            content: '',
        };
    }

    async listProblem() {
        return [];
    }

    async submitProblem(id: string, lang: string, code: string, info, next, end) {
        let enableO2 = 0;
        const comment = SettingModel.langs[lang]?.comment;
        if (code.length < 10) {
            end({ status: STATUS.STATUS_COMPILE_ERROR, message: 'Code too short' });
            return null;
        }
        if (!lang.startsWith('luogu.')) {
            end({ status: STATUS.STATUS_COMPILE_ERROR, message: `Language not supported: ${lang}` });
        }
        if (comment) {
            const msg = `Hydro submission #${info.rid}@${new Date().toLocaleString()}`;
            if (typeof comment === 'string') code = `${comment} ${msg}\n${code}`;
            else if (comment instanceof Array) code = `${comment[0]} ${msg} ${comment[1]}\n${code}`;
        }
        if (lang.endsWith('o2')) {
            enableO2 = 1;
            lang = lang.slice(0, -2);
        }
        lang = lang.split('luogu.')[1];
        const result = await this.post(`/fe/api/problem/submit/${id}${this.account.query || ''}`)
            .set('referer', `https://www.luogu.com.cn/problem/${id}`)
            .send({
                code,
                lang: +lang,
                enableO2,
            });
        logger.info('RecordID:', result.body.rid);
        return result.body.rid;
    }

    async waitForSubmission(id: string, next, end) {
        const done = {};
        let fail = 0;
        let count = 0;
        let finished = 0;
        next({ progress: 5 });
        while (count < 120 && fail < 5) {
            await sleep(1500);
            count++;
            try {
                const { body } = await this.get(`/record/${id}?_contentOnly=1`);
                const data = body.currentData.record;
                if (data.detail.compileResult && data.detail.compileResult.success === false) {
                    await next({ compilerText: data.detail.compileResult.message });
                    return await end({
                        status: STATUS.STATUS_COMPILE_ERROR, score: 0, time: 0, memory: 0,
                    });
                }
                logger.info('Fetched with length', JSON.stringify(body).length);
                const total = _.flattenDeep(body.currentData.testCaseGroup).length;
                if (!data.detail.judgeResult?.subtasks) continue;
                for (const key in data.detail.judgeResult.subtasks) {
                    const subtask = data.detail.judgeResult.subtasks[key];
                    for (const cid in subtask.testCases || {}) {
                        if (done[`${subtask.id}.${cid}`]) continue;
                        finished++;
                        done[`${subtask.id}.${cid}`] = true;
                        const testcase = subtask.testCases[cid];
                        await next({
                            status: STATUS.STATUS_JUDGING,
                            case: {
                                id: +cid || 0,
                                subtaskId: +subtask.id || 0,
                                status: STATUS_MAP[testcase.status],
                                time: testcase.time,
                                memory: testcase.memory,
                                message: testcase.description,
                            },
                            progress: (finished / total) * 100,
                        });
                    }
                }
                if (data.status < 2) continue;
                logger.info('RecordID:', id, 'done');
                // TODO calc total status
                return await end({
                    status: STATUS_MAP[data.status],
                    score: data.score,
                    time: data.time,
                    memory: data.memory,
                });
            } catch (e) {
                logger.error(e);
                fail++;
            }
        }
        return await end({
            status: STATUS.STATUS_SYSTEM_ERROR,
            score: 0,
            time: 0,
            memory: 0,
        });
    }
}
