/* eslint-disable no-await-in-loop */
import { BasicFetcher } from '@hydrooj/vjudge/src/fetch';
import { IBasicProvider, RemoteAccount } from '@hydrooj/vjudge/src/interface';
import {
    Logger, moment, sleep, STATUS, SystemModel, Time,
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

// TODO ?
const langMapping = {
    1: 'pascal/fpc',
    2: 'c/99/gcc',
    3: 'cxx/98/gcc',
    4: 'cxx/11/gcc',
    7: 'python3/c',
    8: 'java/8',
    9: 'js/node/lts',
    11: 'cxx/14/gcc',
    12: 'cxx/17/gcc',
    13: 'ruby',
    14: 'go',
    15: 'rust/rustc',
    16: 'php',
    17: 'mono_cs',
    18: 'mono_vb',
    19: 'haskell/ghc',
    21: 'kotlin/jvm',
    22: 'scala',
    23: 'perl',
    25: 'python3/py',
    27: 'cxx/20/gcc',
    28: 'cxx/noi/202107',
    29: 'fsharp',
    30: 'ocaml',
    31: 'julia',
};
const supportedLangs = Object.values(langMapping);

export default class LuoguProvider extends BasicFetcher implements IBasicProvider {
    quota: any = null;
    overrideScore: number = 0;

    constructor(public account: RemoteAccount, private save: (data: any) => Promise<void>) {
        const UA = [
            `Hydro/${global.Hydro.version.hydrooj}`,
            `(Instance Id ${SystemModel.get('installid').substring(0, 16)})`,
            `Vjudge/${global.Hydro.version.vjudge}`,
        ].join(' ');
        super(account, 'https://open-v1.lgapi.cn', 'json', logger, {
            headers: {
                'User-Agent': UA,
                Authorization: `Basic ${Buffer.from(`${account.handle}:${account.password}`).toString('base64')}`,
            },
        });
        if (account.cookie) {
            const score = +account.cookie[0].split('score=')[1].split(';')[0];
            if (score > 0) this.overrideScore = score;
        }
    }

    async ensureLogin() {
        return true;
    }

    async getProblem() {
        return null;
    }

    async listProblem() {
        return [];
    }

    async submitProblem(id: string, lang: string, code: string, info, next, end) {
        let o2 = false;
        if (code.length < 10) {
            end({ status: STATUS.STATUS_COMPILE_ERROR, message: 'Code too short' });
            return null;
        }
        if (!lang.startsWith('luogu.') && !supportedLangs.includes(lang)) {
            end({ status: STATUS.STATUS_COMPILE_ERROR, message: `Language not supported: ${lang}` });
            return null;
        }
        if (lang.endsWith('o2')) {
            o2 = true;
            lang = lang.slice(0, -2);
        }
        if (!supportedLangs.includes(lang)) {
            lang = Number.isNaN(+lang.split('luogu.')[1]) ? lang.split('luogu.')[1] : langMapping[lang.split('luogu.')[1]];
        }
        try {
            const { body } = await this.post('/judge/problem')
                .send({
                    pid: id,
                    code,
                    lang,
                    o2,
                    trackId: '1',
                });
            logger.debug(body);
            logger.info('RecordID:', body.id || body.resultId || body.requestId);
            return body.id || body.resultId || body.requestId;
        } catch (e) {
            // TODO error handling
            let parsed = e;
            if (e.text) {
                try {
                    const message = JSON.parse(e.text).errorMessage;
                    if (!message) throw e;
                    parsed = new Error(message);
                    parsed.stack = e.stack;
                } catch (err) {
                    throw e;
                }
            }
            throw parsed;
        }
    }

    async waitForSubmission(id: string, next, end) {
        const done = {};
        let fail = 0;
        let count = 0;
        let finished = 0;
        let compiled = false;
        next({ progress: 5 });
        while (count < 120 && fail < 5) {
            await sleep(1500);
            count++;
            try {
                const { body, noContent } = await this.get(`/judge/result?id=${id}`)
                    .ok((res) => [200, 204].includes(res.status)).retry(5);
                if (noContent || !body.data) continue;
                logger.debug(body);
                if (!compiled && body.data && body.data.compile) {
                    compiled = true;
                    next({ compilerText: body.data.compile.message });
                    if (body.data.compile.success === false) {
                        return await end({
                            status: STATUS.STATUS_COMPILE_ERROR, score: 0, time: 0, memory: 0,
                        });
                    }
                }
                logger.info('Fetched with length', JSON.stringify(body).length);
                if (!body.data.judge) continue;
                const judge = body.data.judge;
                const total = judge.subtasks.flatMap((i) => i.cases).length;
                const cases = [];
                const subtasks: Record<string, { score: number; status: number }> = {};
                let progress = (finished / total) * 100;
                for (const subtask of judge.subtasks) {
                    for (const c of subtask.cases) {
                        if (done[`${subtask.id}.${c.id}`]) continue;
                        finished++;
                        done[`${subtask.id}.${c.id}`] = true;
                        cases.push({
                            id: +c.id || 0,
                            subtaskId: +subtask.id || 0,
                            status: STATUS_MAP[c.status],
                            time: c.time,
                            memory: c.memory,
                            message: c.description,
                        });
                        progress = (finished / total) * 100;
                        subtasks[subtask.id] ||= { status: STATUS_MAP[c.status], score: STATUS_MAP[c.status] === STATUS.STATUS_ACCEPTED ? 100 : 0 };
                        if (STATUS_MAP[c.status] > subtasks[subtask.id].status) {
                            subtasks[subtask.id].status = STATUS_MAP[c.status];
                            subtasks[subtask.id].score = STATUS_MAP[c.status] === STATUS.STATUS_ACCEPTED ? 100 : 0;
                        }
                    }
                }
                if (cases.length) await next({ status: STATUS.STATUS_JUDGING, cases, progress });
                if (judge.status < 2) continue;
                logger.info('RecordID:', id, 'done');
                // TODO return real score
                const status = Math.min(...Object.values(subtasks).map((i) => i.status));
                return await end({
                    status,
                    score: status === STATUS.STATUS_ACCEPTED && this.overrideScore ? this.overrideScore : judge.score,
                    time: judge.time,
                    memory: judge.memory,
                    subtasks,
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

    async checkStatus(onCheckFunc) {
        if (!onCheckFunc || !this.quota || this.quota.updateAt < Date.now() - Time.day) {
            const { body } = await this.get('/judge/quotaAvailable');
            this.quota = {
                orgName: body.quotas[0].org.name,
                availablePoints: body.quotas[0].availablePoints ?? -1,
                createTime: body.quotas[0].createTime * 1000,
                expireTime: body.quotas[0].expireTime * 1000,
                updateAt: Date.now(),
            };
            logger.info(`${this.quota.orgName} available: ${this.quota.availablePoints} expire: ${this.quota.expireTime}`);
        }
        return onCheckFunc ? `${this.quota.orgName} 剩余点数: ${this.quota.availablePoints}
(点数有效期: ${moment(this.quota.createTime).format('YYYY/MM/DD')}-${moment(this.quota.expireTime).format('YYYY/MM/DD')})
更新于: ${moment(this.quota.updateAt).format('YYYY/MM/DD HH:mm:ss')}` : this.quota;
    }
}
