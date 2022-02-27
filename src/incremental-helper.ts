import * as fs from 'fs';
import * as childProcess from 'child_process';
import glob from 'fast-glob';
import micromatch from 'micromatch';

export interface IncrementalOptions {
	key: string;
	file?: string;
	strategy?: 'git' | 'time';
	triggers?: ([string, string] | string)[];
	triggersCwd?: string;
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

export class IncrementalHelper {
	private static readonly defaultOptions = {
		strategy: 'time',
		file: '.incremental',
	} as const;

	private file: IncrementalOptions['file'];
	private key: IncrementalOptions['key'];
	private strategy: IncrementalOptions['strategy'];
	private triggers: IncrementalOptions['triggers'];
	private triggersCwd: IncrementalOptions['triggersCwd'];
	private readonly startedAt = new Date();

	/**
	 * Creates an incremental build helper object
	 */
	constructor(options: IncrementalOptions) {
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

		if (typeof options.triggers !== 'undefined') {
			if (!Array.isArray(options.triggers) || options.triggers.some(x => (!Array.isArray(x) || x.length !== 2) && typeof x !== 'string')) {
				throw new TypeError('Incremental build \'triggers\' type mismatch, this option expects \'([string, string] | string)[]\'.');
			}
		}

		if (typeof options.triggersCwd !== 'undefined' && typeof options.triggersCwd !== 'string') {
			throw new TypeError(`Incremental build 'cwd' type mismatch, expected 'string', got '${typeof options.triggersCwd}'.`);
		}

		this.key = options.key;
		this.file = options.file ?? IncrementalHelper.defaultOptions.file;
		this.strategy = options.strategy ?? IncrementalHelper.defaultOptions.strategy;
		this.triggers = options.triggers ?? [];
		this.triggersCwd = options.triggersCwd ?? process.cwd();
	}

	/**
	 * Filters out files that are not changed since last build based on the given strategy.
	 */
	filter(files: string[]): string[] {
		const statusData = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf-8')) : {};

		// eliminate duplicate trigger sources
		// these activates part of the 'files' array with a given pattern
		const triggerSome: Record<string, string[]> = {};
		// these activates the entire 'files' array
		const triggerAll = new Set<string>();
		for (const trigger of this.triggers) {
			if (Array.isArray(trigger)) {
				const source = trigger[0];
				if (!triggerSome[source]) {
					triggerSome[source] = [];
				}
				triggerSome[source].push(trigger[1]);
			} else {
				triggerAll.add(trigger);
			}
		}

		const micromatchOptions: micromatch.Options = {
			nocase: true,
			cwd: this.triggersCwd,
		};

		const globOptions: glob.Options = {
			absolute: true,
			cwd: micromatchOptions.cwd,
			caseSensitiveMatch: !micromatchOptions.nocase,
		};

		if (this.strategy === 'time') {
			if (statusData[this.key]) {
				const lastBuildTime = new Date(statusData[this.key]);

				// handle when a change activates all files
				for (const pattern of triggerAll) {
					// any file matching the trigger pattern
					for (const file of glob.sync(pattern, globOptions)) {
						// is modified since last run
						if (lastBuildTime < fs.statSync(file).mtime) {
							return files;
						}
					}
				}

				// handle when a change activates some of the files
				const triggered = new Set<string>();
				const mtimeCache: Record<string, Date> = {};
				for (const [source, targets] of Object.entries(triggerSome)) {
					for (const file of glob.sync(source, globOptions)) {
						if (!mtimeCache[file]) {
							mtimeCache[file] = fs.statSync(file).mtime;
						}
						if (lastBuildTime < mtimeCache[file]) {
							for (const targetFile of micromatch(files, targets, micromatchOptions)) {
								triggered.add(targetFile);
							}
						}
					}
				}
				return files.filter(x => lastBuildTime < fs.statSync(x).mtime || triggered.has(x));
			}
		} else if (this.strategy === 'git') {
			const commitHash = statusData[this.key];
			if (commitHash) {
				const gitBaseDir = getGitBaseDir();
				const changes = getGitChangesSince(commitHash).map(x => `${gitBaseDir}/${x}`);

				// handle when a change activates all files
				if (micromatch.some(changes, [...triggerAll], micromatchOptions)) {
					return files;
				}

				// handle when a change activates some of the files
				const triggered = new Set();
				for (const [sourcePattern, targetPatterns] of Object.entries(triggerSome)) {
					if (micromatch.some(changes, sourcePattern, micromatchOptions)) {
						for (const triggeredFile of micromatch(files, targetPatterns, micromatchOptions)) {
							triggered.add(triggeredFile);
						}
					}
				}
				const changesSet = new Set(changes);
				return files.filter(x => changesSet.has(x) || triggered.has(x));
			}
		}
		return files;
	}

	/**
	 * Calling .close() will write the last build time to the `.incremental` file.
	 * The time of the creation of this class is preserved in the file.
	 */
	close(): void {
		const data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf-8')) : {};

		if (this.strategy === 'time') {
			data[this.key] = this.startedAt.toJSON();
		} else if (this.strategy === 'git') {
			data[this.key] = getGitCommitHash();
		}

		fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
	}
}
