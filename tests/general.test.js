const reader = require('../cjs/index').default;
const fs = require('fs');

afterEach(() => {
	if (fs.existsSync('tests/.incremental')) {
		fs.unlinkSync('tests/.incremental');
	}
});

test('it reads file{1..3}.txt files, and not skip.txt', async () => {
	const expected = ['file1', 'file2', 'file3'];

	const output = [...reader({
		cwd: 'tests/input',
		pattern: '**/file*.txt',
		encoding: 'utf-8',
		incremental: false,
	})].map(x => x.body.trim());

	output.sort((a, b) => a.localeCompare(b));
	expect(output).toStrictEqual(expected);
});

test('it accepts array as pattern', async () => {
	const expected = ['file1'];

	const output = [...reader({
		cwd: 'tests/input',
		pattern: [
			'file*.txt',
			'!file2.txt',
		],
		encoding: 'utf-8',
		incremental: false,
	})].map(x => x.body.trim());

	output.sort((a, b) => a.localeCompare(b));
	expect(output).toStrictEqual(expected);
});

test('it makes a .incremental file on incremental builds', async () => {
	// read everything to trigger .incremental creation
	[...reader({
		cwd: 'tests/input',
		pattern: '**/file*.txt',
		encoding: 'utf-8',
		incremental: {
			file: 'tests/.incremental',
		},
	})];

	expect(fs.existsSync('tests/.incremental')).toStrictEqual(true);

	const incrementalData = JSON.parse(fs.readFileSync('tests/.incremental', 'utf-8'));
	expect(Object.keys(incrementalData)).toStrictEqual(['tests/input:**/file*.txt']);
});

test('incremental key can be customized', async () => {
	// read everything to trigger .incremental creation
	[...reader({
		cwd: 'tests/input',
		pattern: '**/file*.txt',
		encoding: 'utf-8',
		incremental: {
			file: 'tests/.incremental',
			key: 'my-key'
		},
	})];

	const incrementalData = JSON.parse(fs.readFileSync('tests/.incremental', 'utf-8'));
	expect(Object.keys(incrementalData)).toStrictEqual(['my-key']);
});
