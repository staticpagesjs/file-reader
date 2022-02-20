import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';

export interface Options {
	key: string;
	file?: string;
	strategy?: 'git' | 'time';
}

const git = (...args: string[]) => childProcess.spawnSync('git', args).stdout.toString().trim();

const getGitBaseDir = () => git('rev-parse', '--show-toplevel');
const getGitCommitHash = () => git('rev-parse', 'HEAD');
const getGitChangesSince = (commitHash: string) => {
	const changes = git('diff', '--name-only', `${commitHash}..HEAD`);
	if (changes.startsWith('fatal:')) {
		throw new Error(`Git: Not a valid commit hash '${commitHash}'`);
	}
	return changes.split(/\r?\n/);
};

export class Incremental {
	private static readonly defaultOptions = {
		strategy: 'time',
		file: '.incremental',
	} as const;

	private file: Options['file'];
	private key: Options['key'];
	private strategy: Options['strategy'];
	private readonly startedAt = new Date();

	/**
	 * Creates an incremental build helper object
	 */
	constructor(options: Options) {
		if (!options) {
			throw new TypeError('Incremental helper constructor expects an options object.');
		}

		if (typeof options.key !== 'string') {
			throw new TypeError(`Incremental build 'key' type mismatch, expected 'string', got '${typeof options.key}'.`);
		}

		if (typeof options.file !== 'undefined' && typeof options.file !== 'string') {
			throw new TypeError(`Incremental build 'file' type mismatch, expected 'string', got '${typeof options.strategy}'.`);
		}

		if (typeof options.strategy !== 'undefined') {
			if (typeof options.strategy !== 'string') {
				throw new TypeError(`Incremental build 'strategy' type mismatch, expected 'string', got '${typeof options.strategy}'.`);
			} else if (!['git', 'time'].includes(options.strategy)) {
				throw new TypeError(`Unknown incremental build strategy '${options.strategy}'.`);
			}

			// Test if git works properly in this repository.
			if (!git().startsWith('usage:')) {
				throw new Error('Incremental build: Git is not installed.');
			}
			if (getGitBaseDir().startsWith('fatal:')) {
				throw new Error('Incremental build: Not a git repository.');
			}
		}

		this.key = options.key;
		this.file = options.file ?? Incremental.defaultOptions.file;
		this.strategy = options.strategy ?? Incremental.defaultOptions.strategy;
	}

	/**
	 * Filters out files that are not changed since last build based on the given strategy.
	 */
	filter(files: string[]): string[] {
		const data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf-8')) : {};

		if (this.strategy === 'time') {
			if (data[this.key]) {
				const lastBuildTime = new Date(data[this.key]);
				return files.filter(x => lastBuildTime < fs.statSync(x).mtime);
			}
		} else if (this.strategy === 'git') {
			const commitHash = data[this.key];
			if (commitHash) {
				const changes = new Set(getGitChangesSince(commitHash));
				const gitBaseDir = getGitBaseDir();
				return files.filter(x => changes.has(
					path.relative(gitBaseDir, x).replace(/\\/g, '/')
				));
			}
		}
		return files;
	}

	/**
	 * Calling .finalize() will write the last build time to the `.incremental` file.
	 * The time of the creation of this class is preserved in the file.
	 */
	finalize(): void {
		const data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf-8')) : {};

		if (this.strategy === 'time') {
			data[this.key] = this.startedAt.toJSON();
		} else if (this.strategy === 'git') {
			data[this.key] = getGitCommitHash();
		}

		fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
	}
}
