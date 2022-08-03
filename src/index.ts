import * as fs from 'fs';
import * as path from 'path';
import glob from 'fast-glob';
import { IncrementalHelper } from './incremental-helper.js';

export type FileReaderOptions = {
	cwd?: string;
	pattern?: string | string[];
	ignore?: string | string[];
	encoding?: BufferEncoding;
	incremental?: boolean | Omit<Partial<ConstructorParameters<typeof IncrementalHelper>[0]>, 'cwd'>;
};

/**
 * Example: `/project/pages/about/company.md`\
 * `header.cwd`: `/project`\
 * `header.path`: `pages/about/company.md`\
 * `header.dirname`: `pages/about`\
 * `header.basename`: `company`\
 * `header.extname`: `.md`\
 * `body`: `[file contents]`
 */
export type FileReaderData = {
	header: {
		cwd: string;
		path: string;
		dirname: string;
		basename: string;
		extname: string;
	};
	body: string;
};

export const fileReader = ({ cwd = '.', pattern = '**', encoding = 'utf-8', incremental = false, ignore }: FileReaderOptions = {}) => ({
	[Symbol.iterator]() {
		let files = glob.sync(pattern, {
			cwd: cwd,
			absolute: false,
			...(ignore && { ignore: Array.isArray(ignore) ? ignore : [ignore] }),
			caseSensitiveMatch: false,
		});

		let incrementalHelper: IncrementalHelper;
		if (incremental) {
			incrementalHelper = new IncrementalHelper({
				key: [cwd, ...(Array.isArray(pattern) ? pattern : [pattern])].join(':'),
				...incremental as object,
				cwd: cwd,
			});
			files = incrementalHelper.filter(files);
		}

		const resolvedCwd = path.resolve(cwd).replace(/\\/g, '/');
		return {
			next() {
				const file = files.shift();
				if (!file) { // no more input
					incrementalHelper?.close();
					return { done: true };
				}

				const extName = path.extname(file);

				const data = {
					header: {
						cwd: resolvedCwd,
						path: file,
						dirname: path.dirname(file),
						basename: path.basename(file, extName),
						extname: extName
					},
					body: fs.readFileSync(path.join(resolvedCwd, file), encoding),
				};

				return { value: data };
			}
		};
	}
} as Iterable<FileReaderData>);

export default fileReader;
