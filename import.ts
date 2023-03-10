/* eslint-disable consistent-return */
/* eslint-disable no-await-in-loop */
import { exec } from 'child_process';
import {
    DomainModel, fs, ProblemModel, sleep, SystemModel, UserModel, yaml,
} from 'hydrooj';
import Progress from './progress.cjs';

const langs = (domainId) => `
luogu:
  execute: none
  display: Luogu
  domain:
  - "${domainId}"
  hidden: true
  remote: luogu
luogu.1:
  highlight: pascal
  display: Pascal
  comment: //
  pretest: pas
luogu.2:
  highlight: cpp astyle-c
  display: C
  comment: //
  monaco: cpp
  pretest: c
luogu.2o2:
  highlight: cpp astyle-c
  display: C(O2)
  comment: //
  monaco: cpp
  pretest: cc
luogu.3:
  highlight: cpp astyle-c
  display: C++98
  comment: //
  monaco: cpp
  pretest: cc
luogu.3o2:
  highlight: cpp astyle-c
  display: C++98(O2)
  comment: //
  monaco: cpp
  pretest: cc
luogu.4:
  highlight: cpp astyle-c
  display: C++11
  comment: //
  monaco: cpp
  pretest: cc
luogu.4o2:
  highlight: cpp astyle-c
  display: C++11(O2)
  comment: //
  monaco: cpp
  pretest: cc
luogu.7:
  highlight: python
  display: Python 3
  comments: '#'
  pretest: py.py3
luogu.8:
  highlight: java astyle-java
  display: Java
  comments: //
luogu.9:
  highlight: js
  display: Node.js LTS
  comments: //
luogu.11:
  highlight: cpp astyle-c
  display: C++14
  comment: //
  monaco: cpp
  pretest: cc
luogu.11o2:
  highlight: cpp astyle-c
  display: C++14(O2)
  comment: //
  monaco: cpp
  pretest: cc
luogu.12:
  highlight: cpp astyle-c
  display: C++17
  comment: //
  monaco: cpp
  pretest: cc
luogu.12o2:
  highlight: cpp astyle-c
  display: C++17(O2)
  comment: //
  monaco: cpp
  pretest: cc
luogu.13:
  highlight: ruby
  display: Ruby
  comment: //
luogu.14:
  highlight: go
  display: Go
  comment: //
luogu.15:
  highlight: rust
  display: Rust
  comment: //
luogu.16:
  highlight: php
  display: PHP
luogu.17:
  highlight: csharp
  display: 'C#'
  comment: //
luogu.18:
  highlight: vb
  display: Visual Basic Mono
  comment: //
luogu.19:
  highlight: hs
  display: Haskell
  comment: //
luogu.21:
  highlight: kotlin
  display: Kotlin/JVM
  comment: //
luogu.22:
  highlight: scala
  display: Scala
  comment: //
luogu.23:
  highlight: perl
  display: Perl
  comment: //
luogu.25:
  highlight: python
  display: PyPy 3
  comments: '#'`;

function processContent(content: string) {
    return content.replace(/\r/g, '').replace(/\n+/g, '\n')
        .replace(/!\[[a-z.0-9A-z]*?\]\(https:\/\/cdn\.luogu\.com\.cn\/.+\)/g, '[image]')
        .replace(/!\[[a-z.0-9A-z]*?\]\(file:\/\/.+\)/g, '[image]');
}

const ignoreList: string[] = [];
let override = false;
let vscodeOpen = false;

export async function importProblem(path: string, domainId = 'luogu', owner = 1) {
    if (!fs.existsSync(path)) return console.log('File not found');
    if (!await DomainModel.get(domainId)) return console.log('Domain not found');
    const udoc = await UserModel.getById(domainId, owner);
    if (!udoc) return console.log('User not found');
    const file = fs.readFileSync(path, 'utf-8').replace(/\r/g, '').split('\n').filter((x) => x.trim());
    const n = file.length;
    const bar = new Progress({ name: 'Progress' });
    const current = SystemModel.get('hydrooj.langs');
    if (!current.includes('luogu')) {
        await SystemModel.set('hydrooj.langs', `${current}\n${langs(domainId)}`);
    }

    for (let i = 1; i <= n; i++) {
        // eslint-disable-next-line no-inner-declarations, @typescript-eslint/no-loop-func
        async function promptMessage(message: string[], keyHandler: Function) {
            if (override) return keyHandler('Y');
            if (!process.stdin.isTTY) {
                console.log(message.join('\n'));
                process.exit(1);
            }
            const interval = setInterval(() => {
                bar.updateProgress(i / n, '', message.map((l) => `\n${l.replace(/\n/g, '')}`));
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
        const title = _title.replace(/](?! )/g, '] ');
        bar.updateProgress(i / n, '', [`(${i}/${n}) ${title}`]);
        let content = '';
        if (background?.trim()) content += `## ????????????\n${background}\n\n`;
        if (description?.trim()) content += `## ????????????\n${description}\n\n`;
        if (inputFormat?.trim()) content += `## ????????????\n${inputFormat}\n\n`;
        if (outputFormat?.trim()) content += `## ????????????\n${outputFormat}\n\n`;
        if (translation?.trim()) content += `## ????????????\n${translation}\n\n`;
        for (let t = 0; t < samples?.length || 0; t++) {
            content += `\`\`\`input${t + 1}\n${samples[t][0] || ''}\n\`\`\`\n\n`;
            content += `\`\`\`output${t + 1}\n${samples[t][1] || ''}\n\`\`\`\n\n`;
        }
        if (hint) content += `## ??????\n${hint}\n\n`;
        const doc = await ProblemModel.get(domainId, pid);
        if (doc) {
            if (doc.title !== title) {
                if (doc.title.replace(/ /g, '') === title.replace(/ /g, '')) {
                    await ProblemModel.edit(domainId, doc.docId, { title });
                    continue;
                }
                await promptMessage([
                    `??????ID ????????????????????? ${pid}???????????????????????? ??????????????? (Yes/No/Exit)`,
                    `?????? ${doc.title}`,
                    `?????? ${title}`,
                ], async (op) => {
                    if (op === 'E') return true;
                    if (op === 'Y') {
                        await ProblemModel.edit(domainId, doc.docId, { title });
                        return false;
                    }
                    if (op === 'N') return false;
                });
            }
            if (processContent(doc.content) !== processContent(content) && !ignoreList.includes(`,${pid.split('P')[1]},`)) {
                fs.writeFileSync('__a.md', processContent(doc.content));
                fs.writeFileSync('__b.md', processContent(content));
                if (process.env.VSCODE_INJECTION && !vscodeOpen) {
                    exec('code --diff __a.md __b.md');
                    vscodeOpen = true;
                }
                await promptMessage([
                    `????????????????????????????????? ${pid}???????????????????????? ??????????????? (All/Yes/No/Exit)`,
                    `file: __a.md __b.md ${processContent(doc.content).includes('[image]') ? '?????????????????????' : ''}`,
                    // eslint-disable-next-line @typescript-eslint/no-loop-func
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
            docId = await ProblemModel.add(domainId, pid, title, content, owner, tags, false);
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
        if (doc?.difficulty !== difficulty) await ProblemModel.edit(domainId, doc?.docId || docId, { difficulty });
    }
}

declare module 'hydrooj' {
    interface Model {
        luogu: { importProblem: typeof importProblem };
    }
}

global.Hydro.model.luogu = {
    importProblem,
};
