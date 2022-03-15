import * as fs from 'fs';
import path from 'path';
import * as childProcess from 'child_process';
import glob from 'fast-glob';
import micromatch from 'micromatch';

export type IncrementalHelperOptions = {
	key: string;
	file?: string;
	strategy?: 'git' | 'time';
	triggers?: ([string, string] | string)[];
	triggersCwd?: string;
};

const git = (...args: string[]) => childProcess.spawnSync('git', args)?.stdout?.toString?.().trim() ?? '';

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
	private file: IncrementalHelperOptions['file'];
	private key: IncrementalHelperOptions['key'];
	private strategy: IncrementalHelperOptions['strategy'];
	private triggers: IncrementalHelperOptions['triggers'];
	private triggersCwd: IncrementalHelperOptions['triggersCwd'];
	private readonly startedAt = new Date();

	/**
	 * Creates an incremental build helper object
	 */
	constructor(options: IncrementalHelperOptions) {
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
		this.file = options.file ?? '.incremental';
		this.strategy = options.strategy ?? 'time';
		this.triggers = options.triggers ?? [];
		this.triggersCwd = options.triggersCwd ?? process.cwd();
	}

	/**
	 * Filters files that are changed since last build
	 */
	filter(files: string[]): string[] {
		const statusData = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf-8')) : {};

		const addCwd = (x: string) => path.join(this.triggersCwd, x).replace(/\\/g, '/');

		// eliminate duplicate trigger sources
		// these activates part of the 'files' array with a given pattern
		const triggerSome: Record<string, string[]> = {};
		// these activates the entire 'files' array
		const triggerAll = new Set<string>();
		for (const trigger of this.triggers) {
			if (Array.isArray(trigger)) {
				const source = addCwd(trigger[0]);
				if (!triggerSome[source]) {
					triggerSome[source] = [];
				}
				triggerSome[source].push(addCwd(trigger[1]));
			} else {
				triggerAll.add(addCwd(trigger));
			}
		}

		const micromatchOptions: micromatch.Options = {
			nocase: true,
			windows: true, // 'files' can have windows style paths too
		};

		const globOptions: glob.Options = {
			absolute: true,
			cwd: this.triggersCwd,
			caseSensitiveMatch: false,
		};

		if (this.strategy === 'time') { // Handle TIME strategy
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
				const patternCache = new Set<string>();
				const mtimeCache: Record<string, Date> = {};
				for (const [sourcePattern, targetPatterns] of Object.entries(triggerSome)) {
					// get files that match the source pattern
					for (const file of glob.sync(sourcePattern, globOptions)) {
						if (!mtimeCache[file]) {
							mtimeCache[file] = fs.statSync(file).mtime;
						}
						// if the file is new/modified
						if (lastBuildTime < mtimeCache[file]) {
							// drop patterns that we seen earlier
							const unvisitedTargetPatterns = targetPatterns.filter(x => !patternCache.has(x));
							// if there is atleast one not yet seen pattern
							if (unvisitedTargetPatterns.length > 0) {
								// filter matching files to it
								for (const targetFile of micromatch(files, unvisitedTargetPatterns, micromatchOptions)) {
									triggered.add(targetFile);
								}
								// add it to seen patterns list
								for (const target of targetPatterns) {
									patternCache.add(target);
								}
							}
						}
					}
				}
				return files.filter(x => lastBuildTime < fs.statSync(x).mtime || triggered.has(x));
			}
		} else if (this.strategy === 'git') { // Handle GIT strategy
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

		// if a strategy did not return its filtered result we return the whole input unfiltered
		return files;
	}

	/**
	 * Calling .close() will update the `.incremental` file
	 */
	close(): void {
		const data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf-8')) : {};

		if (this.strategy === 'time') {
			// time strategy saves an UTC date
			data[this.key] = this.startedAt.toJSON();
		} else if (this.strategy === 'git') {
			// git strategy saves a git commit hash
			data[this.key] = getGitCommitHash();
		}

		fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
	}
}
