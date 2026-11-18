// 新业务命令共用的输入校验与产物写入，不包含页面或业务评分规则。
import fs from 'node:fs';
import path from 'node:path';
import { SKILL_ROOT } from './config.mjs';

export function countOption(value, fallback, name) {
  const selected = value ?? fallback;
  if (!/^\d+$/.test(String(selected)) || !Number.isSafeInteger(Number(selected)) || Number(selected) < 1) throw new Error(name + ' 必须为正整数');
  return Number(selected);
}

export function outputFiles(opts, label, inputs = []) {
  const outFile = path.resolve(opts.out || path.join(SKILL_ROOT, 'outputs', `${label}-${Date.now()}`, label + '.json'));
  if (!outFile.toLowerCase().endsWith('.json')) throw new Error('--out 必须为 .json');
  const reportFile = outFile.slice(0, -5) + '.md';
  const key = value => path.sep === '\\' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (inputs.filter(Boolean).some(input => [outFile, reportFile].some(file => key(file) === key(input)))) throw new Error('输出不能覆盖输入或历史快照');
  return { outFile, reportFile };
}

export function writeArtifacts(files, result, render) {
  const json = JSON.stringify(result, null, 2);
  const report = render(result);
  fs.mkdirSync(path.dirname(files.outFile), { recursive: true });
  fs.writeFileSync(files.outFile, json, 'utf8');
  fs.writeFileSync(files.reportFile, report, 'utf8');
}

export function fileJson(file) {
  if (typeof file !== 'string' || !file.trim()) throw new Error('输入需要文件路径');
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

export { numericId } from '../data-rules.mjs';
