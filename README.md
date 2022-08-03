# Static Pages / File reader
Reads the contents of every file where the file name matches the given pattern. Produces an iterable.

## Usage
```js
import reader from '@static-pages/file-reader';

const iterable = reader({
  cwd: '.',
  pattern: '**',
  ignore: 'ignored-file*',
  encoding: 'utf-8',
  incremental: {
    file: '.incremental',
    key: '.:**',
    strategy: 'time',
    triggersTrackingRoot: '.',
    triggers: [
      ['news/*', 'news.main'], // if 'news/*' changes, read 'news.main' too
      ['posts/*', 'posts/*'], // if anything in 'posts' changes, read everything
    ],
  },
});

// one item in the iterable:
// {
//   header: {
//     cwd: '/path/to/pages',
//     path: 'folder/file.md',
//     dirname: 'folder',
//     basename: 'file',
//     extname: '.md'
//   },
//   body: '[file contents]'
// }
```

## Docs

### __`reader(options: Options): Iterable<Data>`__

#### `Options`
- `options.cwd` (default: `.`) sets the current working directory.
- `options.pattern` (default: `**`) glob pattern(s) that selects the files to read. Can be a `string` or a `string` array.
- `options.ignore` (default: `undefined`) glob pattern(s) that selects the files to ignore. Can be a `string` or a `string` array.
- `options.encoding` (default: `utf-8`) defines the returned file encoding. Possible values are the same as the `encoding` argument of `fs.readFile`.
- `options.incremental` (default: `false`) return only those files that are newer than the previous iteration. Read more about incremental reads below.

#### `Data`
- `data.header` contains metadata about the file.
  - `header.cwd` is the absolute path of the `cwd` set in the options.
  - `header.path` is the file path relative to the `header.cwd`.
  - `header.dirname` is equivalent to `path.dirname(header.path)`.
  - `header.basename` is equivalent to `path.basename(header.path, header.extname)`.
  - `header.extname` is equivalent to `path.extname(header.path)`.
- `data.body` contains the contents read from the source file.

> Windows style backslashes are always normalized to Unix style forward slashed in paths.

### Incremental reads
It means that if a file content is already read it won't be read again on the next iteration unless it has modifications.

Set `options.incremental` to `true` or pass an object containing specific options to enable incremental reads.

```ts
interface IncrementalOptions {
  file?: string;
  key?: string;
  strategy?: 'git' | 'time';
  triggers?: [string, string][] | ((changes: string[]) => string[]);
  triggersTrackingRoot?: string;
}
```

Modifications detected either by file modification time (the `mtime` field) or by git changes since a given commmit. By default we use the file modification time strategy.
To change this to the git strategy, set `options.incremental.strategy` to `git`.

Last read state is preserved in a `.incremental` file in the current working directory. You can redirect this output to a different file by setting the `options.incremental.file` to eg. `readstate.json`. Multiple readers can share a single `.inremental` file.

If there are multiple file readers with the same `cwd` and `pattern`, they will collide with each if incremental is enabled. This is beacause the current state of an incremental read is cached with a key generated from the `cwd` and the `pattern`. Set `options.incremental.key` to some unique for each of the readers.

You can define file relations like: if 'A' file is modified 'B' file also needs to be read.
These rules can be defined with `options.incremental.triggers` which accepts a 2d array or a function recieving the changes and returning file patterns that also needs to be read.
Changes are only tracked in the `options.incremental.triggersTrackingRoot` directory which defaults to the `options.cwd`. Outside this directory no changes are considered even with git strategy where git easily can report changes in the parent directories. Changes are always provided with relative path to `options.cwd`.

> Tip: Add a `.incremental` rule to your `.gitignore` file if you are using version control.

> Tip: In CI environments don't forget to cache the `.incremental` file.

## Where to use this?
This module can be used to generate static HTML pages from file based sources. Read more at the [Static Pages JS project page](https://staticpagesjs.github.io/).
