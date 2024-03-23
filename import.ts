/* eslint-disable consistent-return */
/* eslint-disable no-await-in-loop */
import { exec } from 'child_process';
import os from 'os';
import { createGunzip } from 'zlib';
import { create } from 'fancy-progress';
import {
    DomainModel, fs, ProblemModel, sleep, superagent, SystemModel, UserModel, yaml,
} from 'hydrooj';

const langs = `
luogu:
  execute: none
  display: Luogu
  hidden: true
  remote: luogu
luogu.pascal/fpc:
  highlight: pascal
  display: Pascal
  comment: //
  pretest: pas
luogu.c/99/gcc:
  highlight: cpp astyle-c
  display: C
  comment: //
  monaco: cpp
  pretest: c
luogu.c/99/gcco2:
  highlight: cpp astyle-c
  display: C(O2)
  comment: //
  monaco: cpp
  pretest: c
luogu.cxx/98/gcc:
  highlight: cpp astyle-c
  display: C++98
  comment: //
  monaco: cpp
  pretest: cc.cc98
luogu.cxx/98/gcco2:
  highlight: cpp astyle-c
  display: C++98(O2)
  comment: //
  monaco: cpp
  pretest: cc.cc98o2
luogu.cxx/11/gcc:
  highlight: cpp astyle-c
  display: C++11
  comment: //
  monaco: cpp
  pretest: cc.cc11
luogu.cxx/11/gcco2:
  highlight: cpp astyle-c
  display: C++11(O2)
  comment: //
  monaco: cpp
  pretest: cc.cc11o2
luogu.python3/c:
  highlight: python
  display: Python 3
  comments: '#'
  pretest: py.py3
luogu.java/8:
  highlight: java astyle-java
  display: Java
  comments: //
luogu.js/node/lts:
  highlight: js
  display: Node.js LTS
  comments: //
luogu.cxx/14/gcc:
  highlight: cpp astyle-c
  display: C++14
  comment: //
  monaco: cpp
  pretest: cc.cc14
luogu.cxx/14/gcco2:
  highlight: cpp astyle-c
  display: C++14(O2)
  comment: //
  monaco: cpp
  pretest: cc.cc14o2
luogu.cxx/noi/202107:
  highlight: cpp astyle-c
  display: C++14(GCC 9.3.0)
  comment: //
  monaco: cpp
  # pretest: cc.cc14
luogu.cxx/noi/202107o2:
  highlight: cpp astyle-c
  display: C++14(O2, GCC 9.3.0)
  comment: //
  monaco: cpp
  # pretest: cc.cc14o2
luogu.cxx/17/gcc:
  highlight: cpp astyle-c
  display: C++17
  comment: //
  monaco: cpp
  pretest: cc.cc17
luogu.cxx/17/gcco2:
  highlight: cpp astyle-c
  display: C++17(O2)
  comment: //
  monaco: cpp
  pretest: cc.cc17o2
luogu.ruby:
  highlight: ruby
  display: Ruby
  comment: //
luogu.go:
  highlight: go
  display: Go
  comment: //
luogu.rust/rustc:
  highlight: rust
  display: Rust
  comment: //
luogu.php:
  highlight: php
  display: PHP
luogu.csharp:
  disabled: true
  highlight: csharp
  display: 'C#'
  comment: //
luogu.vb:
  disabled: true
  highlight: vb
  display: Visual Basic Mono
  comment: //
luogu.haskell/ghc:
  highlight: hs
  display: Haskell
  comment: //
luogu.kotlin/jvm:
  highlight: kotlin
  display: Kotlin/JVM
  comment: //
luogu.scala:
  highlight: scala
  display: Scala
  comment: //
luogu.perl:
  highlight: perl
  display: Perl
  comment: //
luogu.python3/py:
  highlight: python
  display: PyPy 3
  comments: '#'
  pretest: py.pypy3
luogu.cxx/20/gcc:
  highlight: cpp astyle-c
  display: C++20
  comment: //
  monaco: cpp
  pretest: cc.cc20
luogu.cxx/20/gcco2:
  highlight: cpp astyle-c
  display: C++20(O2)
  comment: //
  monaco: cpp
  pretest: cc.cc20o2`;

function processContent(content: string) {
    return content.replace(/\r/g, '').replace(/\n+/g, '\n')
        .replace(/!\[[a-z.0-9A-z]*?\]\(https:\/\/cdn\.luogu\.com\.cn\/.+\)/g, '[image]')
        .replace(/!\[[a-z.0-9A-z]*?\]\(file:\/\/.+\)/g, '[image]');
}

const ignoreList: string[] = [];
let override = false;
let vscodeOpen = false;

export async function importProblem(path = '', domainId = 'luogu', owner = 1) {
    if (!path) {
        console.log('Downloading latest.ndjson...');
        path = `${os.tmpdir()}/${String.random(8)}.ndjson`;
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
    const bar = create('Progress', 'green');
    const current = SystemModel.get('hydrooj.langs');
    if (!current.includes('luogu')) {
        await SystemModel.set('hydrooj.langs', `${current}\n${langs}`);
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
        const title = _title.replace(/](?! )/g, '] ');
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
        const doc = await ProblemModel.get(domainId, pid);
        if (doc) {
            if (doc.title !== title) {
                if (doc.title.replace(/ /g, '') === title.replace(/ /g, '')) {
                    await ProblemModel.edit(domainId, doc.docId, { title });
                    continue;
                }
                await promptMessage([
                    `题目ID 冲突：已经存在 ${pid}，但题目标题不同 是否覆盖？ (Yes/No/Exit)`,
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
            if (processContent(doc.content) !== processContent(content) && !ignoreList.includes(`,${pid.split('P')[1]},`)) {
                fs.writeFileSync('__a.md', processContent(doc.content));
                fs.writeFileSync('__b.md', processContent(content));
                if (process.env.VSCODE_INJECTION && !vscodeOpen) {
                    exec('code --diff __a.md __b.md');
                    vscodeOpen = true;
                }
                await promptMessage([
                    `题目内容冲突：已经存在 ${pid}，但题目内容不同 是否覆盖？ (All/Yes/No/Exit)`,
                    `file: __a.md __b.md ${processContent(doc.content).includes('[image]') ? '警告：存在图片' : ''}`,
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
            docId = await ProblemModel.add(domainId, pid, title, content, owner, tags);
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
    console.log('导入全部完成。');
}
