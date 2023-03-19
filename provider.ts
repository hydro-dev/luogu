/* eslint-disable no-await-in-loop */
import { BasicFetcher } from '@hydrooj/vjudge/src/fetch';
import { IBasicProvider, RemoteAccount } from '@hydrooj/vjudge/src/interface';
import { Logger, sleep, STATUS } from 'hydrooj';

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

// TODO ?
const langMapping = {
    1: 'pas',
    2: 'c',
    3: 'cpp',
    4: 'c11',
    6: 'py2',
    7: 'py3',
    8: 'java8',
    9: 'node8',
    10: 'shell',
    11: 'c14',
    12: 'c17',
    13: 'ruby',
    14: 'go',
    15: 'rust',
    16: 'php',
    17: 'mono_cs',
    18: 'mono_vb',
    19: 'haskell',
    21: 'kotlin_jvm',
    22: 'scala',
    23: 'perl',
    24: 'pypy2',
    25: 'pypy3',
    27: 'c20',
    28: 'c14_gcc9',
    29: 'fsharp',
    30: 'ocaml',
    31: 'julia',
};

export default class LuoguProvider extends BasicFetcher implements IBasicProvider {
    constructor(public account: RemoteAccount, private save: (data: any) => Promise<void>) {
        super(account, 'https://open-v1.lgapi.cn', 'json', logger, {
            headers: {
                'User-Agent': UA,
                Authorization: `Basic ${Buffer.from(`${account.handle}:${account.password}`).toString('base64')}`,
            },
        });
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
        if (!lang.startsWith('luogu.')) {
            end({ status: STATUS.STATUS_COMPILE_ERROR, message: `Language not supported: ${lang}` });
            return null;
        }
        if (lang.endsWith('o2')) {
            o2 = true;
            lang = lang.slice(0, -2);
        }
        lang = langMapping[lang.split('luogu.')[1]];
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
                    }
                }
                if (cases.length) await next({ status: STATUS.STATUS_JUDGING, cases, progress });
                if (judge.status < 2) continue;
                logger.info('RecordID:', id, 'done');
                // TODO calc total status
                // TODO return subtask status
                return await end({
                    status: STATUS_MAP[judge.status],
                    score: judge.score,
                    time: judge.time,
                    memory: judge.memory,
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
