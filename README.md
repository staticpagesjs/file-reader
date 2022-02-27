# Static Pages / File reader
Reads the contents of every file where the file name matches the given pattern. Produces an iterable.

## Usage
```js
import reader from '@static-pages/file-reader';

const iterable = reader({
  cwd: 'pages',
  pattern: '**/*',
  encoding: 'utf-8',
  incremental: false,
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
- `options.cwd` (default: `pages`) sets the current working directory.
- `options.pattern` (default: `**/*`) a glob pattern that marks the files to read.
- `options.encoding` (default: `utf-8`) defines the returned file encoding. Possible values are the same as the `encoding` argument of `fs.readFile`.
- `options.incremental` (default: `false`) return only those files that are newer than the last iteration of the files. Read more about incremental builds below.

#### `Data`
- `data.header` contains metadata about the file.
  - `header.cwd` is the base directory wich contains the file.
  - `header.path` is the file path relative to the `header.cwd`.
  - `header.dirname` is equivalent to `path.dirname(header.path)`.
  - `header.basename` is equivalent to `path.basename(header.path, header.extname)`.
  - `header.extname` is equivalent to `path.extname(header.path)`.
- `data.body` contains the text data read from the source file.

### Incremental builds
It means that if a file content is already read and processed it will not be read again if you iterate the files next time unless it has new modifications to it.

Set the `incremental` option to `true` or pass an object containing specific options to enable incremental builds.

Modifications detected either by file `mtime` field or by `git diff --name-only <current-hash>..HEAD` (defaults to file modification time).
To change this set `incremental: { strategy: 'git' }`.

Last build state is preserved in a `.incremental` file in the current working directory. You can redirect the output to a different file by setting the `incremental: { file: 'buildstate.json' }` option.

If there are multiple file readers having the same `cwd` and `pattern` they can collide with each. This is beacause the current state of an incremental build is cached with a key generated from the `cwd` and `pattern`. Set `incremental: { key: 'my-unique-key' }` for each of the readers to fix this.

You can define file relations eg. "if 'A' is updated 'B' also needs to be included in the build" OR "if 'A' is updated, incremental build mode should be turned off".
These rules can be defined in `incremental: { triggers: [...] }`. The `triggers` accepts `([string, string] | string)[]` type. The `[string, string]` is the previously said 'A','B' form, the `string` is the latter where incremental build is ignored (triggers all the files).

#### Options of `incremental`
```ts
interface IncrementalOptions {
  strategy?: 'git' | 'time';
  file?: string;
  key?: string;
  triggers?: ([string, string] | string)[];
}
```

## Where to use this?
This module can be used to generate static HTML pages from file based sources. Read more at the [Static Pages JS project page](https://staticpagesjs.github.io/).
