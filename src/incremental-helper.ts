import * as fs from 'fs';
import * as path from 'path';
import * as childProcess from 'child_process';
import micromatch from 'micromatch';

const micromatchOptions: micromatch.Options = {
	nocase: true,
	windows: true,
};

const normalizePath = (str: string) => path.resolve(str).replace(/\\/g, '/').replace(/[\\/]+$/, '');

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

const readdir = (dir: string) => {
	const files: string[] = [];
	const readdir = (dir: string, prefix = '') => {
		for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
			if (dirent.isDirectory()) {
				readdir(dir + '/' + dirent.name, prefix + dirent.name + '/');
			} else {
				files.push(prefix + dirent.name);
			}
		}
	};
	readdir(dir.replace(/[\\/]+$/, ''));
	return files;
};

const triggersArrayHandler = (triggersArray: [string, string][]) => (changes: string[]) => {
	const triggered = new Set<string>();
	for (const [source, target] of triggersArray) {
		if (micromatch.some(changes, source, micromatchOptions)) {
			triggered.add(target);
		}
	}
	return [...triggered];
};

export class IncrementalHelper {
	private file: string;
	private key: string;
	private cwd: string;
	private strategy: 'git' | 'time';
	private triggers?: [string, string][] | ((changes: string[]) => string[]);
	private triggersTrackingRoot: string;
	private readonly startedAt = new Date();
	private readonly gitBaseDir: string = '.';

	/**
	 * Creates an incremental reader helper object
	 */
	constructor({
		file = '.incremental',
		key,
		cwd,
		strategy = 'time',
		triggers,
		triggersTrackingRoot,
	}: {
		file?: IncrementalHelper['file'];
		key: IncrementalHelper['key'];
		cwd: IncrementalHelper['cwd'];
		strategy?: IncrementalHelper['strategy'];
		triggers?: IncrementalHelper['triggers'];
		triggersTrackingRoot?: IncrementalHelper['triggersTrackingRoot'];
	}) {
		if (typeof file !== 'undefined' && typeof file !== 'string') {
			throw new TypeError(`Incremental reader: 'file' type mismatch, expected 'string', got '${typeof strategy}'.`);
		}

		if (typeof key !== 'string') {
			throw new TypeError(`Incremental reader: 'key' type mismatch, expected 'string', got '${typeof key}'.`);
		}

		if (typeof cwd !== 'string') {
			throw new TypeError(`Incremental reader: 'cwd' type mismatch, expected 'string', got '${typeof cwd}'.`);
		}

		if (typeof strategy !== 'undefined') {
			if (typeof strategy !== 'string') {
				throw new TypeError(`Incremental reader: 'strategy' type mismatch, expected 'string', got '${typeof strategy}'.`);
			} else if (!['git', 'time'].includes(strategy)) {
				throw new TypeError(`Unknown incremental reader strategy '${strategy}'.`);
			}

			// Test if git works properly in this repository.
			if (!git().startsWith('usage:')) {
				throw new Error('Incremental reader: Git is not installed.');
			}
			const gitBaseDir = getGitBaseDir();
			if (gitBaseDir.startsWith('fatal:')) {
				throw new Error('Incremental reader: Not a git repository.');
			}
			this.gitBaseDir = normalizePath(gitBaseDir);
		}

		if (typeof triggers !== 'undefined' &&
			(
				!Array.isArray(triggers) ||
				triggers.some(x => !Array.isArray(x) || x.length !== 2)
			) &&
			typeof triggers !== 'function'
		) {
			throw new TypeError('Incremental reader: \'triggers\' type mismatch, this option expects \'[string, string][] | (changes: string[]) => string[]\'.');
		}

		if (typeof triggersTrackingRoot !== 'undefined' && typeof triggersTrackingRoot !== 'string') {
			throw new TypeError(`Incremental reader: 'triggersTrackingRoot' type mismatch, expected 'string', got '${typeof triggersTrackingRoot}'.`);
		}

		this.file = file;
		this.key = key;
		this.cwd = normalizePath(cwd);
		this.strategy = strategy;
		this.triggers = triggers;
		this.triggersTrackingRoot = (triggersTrackingRoot && normalizePath(triggersTrackingRoot)) ?? this.cwd;
	}

	/**
	 * Filters files that are changed since last build
	 */
	filter(files: string[]): string[] {
		const statusData = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf-8')) : {};

		const triggersCallback = Array.isArray(this.triggers) ? triggersArrayHandler(this.triggers) : this.triggers;

		if (this.strategy === 'time') { // Handle TIME strategy
			if (statusData[this.key]) {
				const lastReadTime = new Date(statusData[this.key]);

				const triggered = triggersCallback?.(
					readdir(this.triggersTrackingRoot)
						.filter(x => lastReadTime < fs.statSync(this.triggersTrackingRoot + '/' + x).mtime)
						.map(x => path.relative(this.cwd, this.triggersTrackingRoot + '/' + x).replace(/\\/g, '/'))
				);

				if (triggered) {
					return files.filter(x => lastReadTime < fs.statSync(this.cwd + '/' + x).mtime || micromatch.any(x, triggered, micromatchOptions));
				} else {
					return files.filter(x => lastReadTime < fs.statSync(this.cwd + '/' + x).mtime);
				}
			}
		} else if (this.strategy === 'git') { // Handle GIT strategy
			const commitHash = statusData[this.key];
			if (commitHash) {
				const gitChanges = getGitChangesSince(commitHash);

				const changes = new Set(gitChanges
					.filter(x => (this.gitBaseDir + '/' + x).startsWith(this.cwd))
					.map(x => (this.gitBaseDir + '/' + x).substring(this.cwd.length + 1))
				);

				const triggered = triggersCallback?.(gitChanges
					.filter(x => (this.gitBaseDir + '/' + x).startsWith(this.triggersTrackingRoot))
					.map(x => path.relative(this.cwd, this.gitBaseDir + '/' + x).replace(/\\/g, '/'))
				);

				if (triggered) {
					return files.filter(x => changes.has(x) || micromatch.any(x, triggered, micromatchOptions));
				} else {
					return files.filter(x => changes.has(x));
				}
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
