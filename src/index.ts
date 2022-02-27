import * as fs from 'fs';
import * as path from 'path';
import glob from 'fast-glob';
import { IncrementalHelper, IncrementalOptions } from './incremental-helper.js';

export interface Options {
	cwd?: string;
	pattern?: string;
	encoding?: BufferEncoding;
	incremental?: boolean | Pick<Partial<IncrementalOptions>, 'file' | 'key' | 'strategy' | 'triggers'>;
}

/**
 * Example: `/project/pages/about/company.md`\
 * `header.cwd`: `/project`\
 * `header.path`: `pages/about/company.md`\
 * `header.dirname`: `pages/about`\
 * `header.basename`: `company`\
 * `header.extname`: `.md`\
 * `body`: `[file contents]`
 */
export interface Data {
	header: {
		cwd: string;
		path: string;
		dirname: string;
		basename: string;
		extname: string;
	};
	body: string;
}

export default ({ cwd = 'pages', pattern = '**/*', encoding = 'utf-8', incremental = false }: Options = {}) => ({
	[Symbol.iterator]() {
		const absCwd = path.resolve(process.cwd(), cwd);
		let files = glob.sync(pattern, {
			cwd: absCwd,
			absolute: true,
			caseSensitiveMatch: false,
		});

		let incrementalHelper: IncrementalHelper;
		if (incremental) {
			incrementalHelper = new IncrementalHelper({
				key: path.posix.join(cwd, pattern),
				...<object>incremental,
				triggersCwd: cwd,
			});
			files = incrementalHelper.filter(files);
		}

		return {
			next() {
				const file = files.pop();
				if (!file) { // no more input
					incrementalHelper?.close();
					return { done: true };
				}

				const relativePath = path.relative(absCwd, file);
				const extName = path.extname(file);

				const data = {
					header: {
						cwd: absCwd,
						path: relativePath,
						dirname: path.dirname(relativePath),
						basename: path.basename(relativePath, extName),
						extname: extName
					},
					body: fs.readFileSync(file, encoding),
				};

				return { value: data };
			}
		};
	}
});
