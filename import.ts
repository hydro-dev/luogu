/* eslint-disable consistent-return */
/* eslint-disable no-await-in-loop */
import { exec } from 'child_process';
import os from 'os';
import { createGunzip } from 'zlib';
import {
    DomainModel, fs, ProblemModel, randomstring, sleep, superagent, UserModel, yaml,
} from 'hydrooj';

let override = false;
let vscodeOpen = false;

const difficultyMap = {
    0: 0,
    1: 1,
    2: 3,
    3: 5,
    4: 6,
    5: 7,
    6: 8,
    7: 9,
};

export async function importProblem(path = '', domainId = 'system', owner = 1, prefix = 'luogu-') {
    if (!path) {
        console.log('Downloading latest.ndjson...');
        path = `${os.tmpdir()}/${randomstring(8)}.ndjson`;
        const stream = fs.createWriteStream(path);
        const unzip = createGunzip();
        unzip.pipe(stream);
        superagent.get('https://cdn.luogu.com.cn/problemset-open/latest.ndjson.gz').pipe(unzip);
        await new Promise((resolve, reject) => {
            unzip.on('end', resolve);
            unzip.on('error', reject);
            stream.on('end', resolve);
            stream.on('error', reject);
        });
        console.log('Downloaded');
    } else if (!fs.existsSync(path)) return console.log('File not found');
    if (!await DomainModel.get(domainId)) {
        await DomainModel.add(domainId, owner, 'Luogu', '');
    }
    const udoc = await UserModel.getById(domainId, owner);
    if (!udoc) return console.log('User not found');
    const file = fs.readFileSync(path, 'utf-8').replace(/\r/g, '').split('\n').filter((x) => x.trim());
    const n = file.length;
    const bar = require('fancy-progress').create('Progress', 'green');

    for (let i = 1; i <= n; i++) {
        // eslint-disable-next-line ts/no-loop-func
        async function promptMessage(message: string[], keyHandler: Function) {
            if (override) return keyHandler('Y');
            if (!process.stdin.isTTY) {
                console.log(message.join('\n'));
                process.exit(1);
            }
            const interval = setInterval(() => {
                bar.update(i / n, message.map((l) => `${l.replace(/\n/g, ' ')}`).join('\n'));
            }, 1000);
            await sleep(100);
            process.stdin.setRawMode(true);
            const e = await new Promise((resolve) => {
                const cb = async (key) => {
                    const op = key.toString().toUpperCase().trim();
                    const res = await keyHandler(op);
                    if (typeof res === 'undefined') process.stdin.once('data', cb);
                    else resolve(res);
                };
                process.stdin.once('data', cb);
            });
            clearInterval(interval);
            setImmediate(() => process.stdin.setRawMode(false));
            if (e) process.exit(1);
        }

        const {
            pid, title: _title, difficulty, background, description,
            inputFormat, outputFormat, samples, hint, limits, tags,
            translation,
        } = JSON.parse(file[i - 1]);
        const title = _title.replace(/\](?! )/g, '] ');
        bar.update(i / n, `(${i}/${n}) ${title}`);
        let content = '';
        if (background?.trim()) content += `## 题目背景\n${background}\n\n`;
        if (description?.trim()) content += `## 题目描述\n${description}\n\n`;
        if (inputFormat?.trim()) content += `## 输入格式\n${inputFormat}\n\n`;
        if (outputFormat?.trim()) content += `## 输出格式\n${outputFormat}\n\n`;
        if (translation?.trim()) content += `## 题目大意\n${translation}\n\n`;
        for (let t = 0; t < samples?.length || 0; t++) {
            content += `\`\`\`input${t + 1}\n${samples[t][0] || ''}\n\`\`\`\n\n`;
            content += `\`\`\`output${t + 1}\n${samples[t][1] || ''}\n\`\`\`\n\n`;
        }
        if (hint) content += `## 提示\n${hint}\n\n`;
        const target = prefix ? `${prefix}${pid}` : pid;
        const doc = await ProblemModel.get(domainId, target);
        if (doc) {
            if (doc.title !== title) {
                if (doc.title.replace(/ /g, '') === title.replace(/ /g, '')) {
                    await ProblemModel.edit(domainId, doc.docId, { title });
                    continue;
                }
                await promptMessage([
                    `题目ID 冲突：已经存在 ${target}，但题目标题不同 是否覆盖？ (Yes/No/Exit)`,
                    `当前 ${doc.title}`,
                    `传入 ${title}`,
                ], async (op) => {
                    if (op === 'E') return true;
                    if (op === 'Y') {
                        await ProblemModel.edit(domainId, doc.docId, { title });
                        return false;
                    }
                    if (op === 'N') return false;
                });
            }
            if (doc.content !== content) {
                fs.writeFileSync('__a.md', doc.content);
                fs.writeFileSync('__b.md', content);
                if (process.env.VSCODE_INJECTION && !vscodeOpen) {
                    exec('code --diff __a.md __b.md');
                    exec('cursor --diff __a.md __b.md');
                    vscodeOpen = true;
                }
                await promptMessage([
                    `题目内容冲突：已经存在 ${target}，但题目内容不同 是否覆盖？ (All/Yes/No/Exit)`,
                    'file: __a.md __b.md',
                    // eslint-disable-next-line ts/no-loop-func
                ], async (op) => {
                    if (op === 'A') override = true;
                    if (op === 'Y' || op === 'A') {
                        await ProblemModel.edit(domainId, doc.docId, { content });
                        return false;
                    }
                    if (op === 'N') return false;
                    if (op === 'E') return true;
                });
                fs.rmSync('__a.md');
                fs.rmSync('__b.md');
            }
        }
        let docId: number;
        if (!doc) {
            docId = await ProblemModel.add(domainId, target, title, content, owner, tags);
        } else {
            docId = doc.docId;
        }
        const shouldUpdate = !doc || typeof doc.config === 'string' ? true
            : (doc.config.timeMin !== Math.min(...limits.time) || doc.config.memoryMin !== Math.min(...limits.memory) / 1024
                || doc.config.timeMax !== Math.max(...limits.time) || doc.config.memoryMax !== Math.max(...limits.memory) / 1024);
        if (shouldUpdate) {
            await ProblemModel.addTestdata(domainId, doc?.docId || docId, 'config.yaml', Buffer.from(yaml.dump({
                type: 'remote_judge',
                subType: 'luogu',
                target: pid,
                subtasks: limits.time.map((_, index) => ({
                    id: index,
                    score: Math.floor(100 / limits.time.length),
                    time: `${limits.time[index]}ms`,
                    memory: `${limits.memory[index]}kb`,
                    cases: [{ input: '/dev/null', output: '/dev/null' }],
                })),
            })));
        }
        const actualDifficulty = difficultyMap[difficulty];
        if (doc?.difficulty !== actualDifficulty) await ProblemModel.edit(domainId, doc?.docId || docId, { difficulty: actualDifficulty });
    }
    console.log('导入全部完成。');
}
