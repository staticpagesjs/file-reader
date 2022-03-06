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

test('it should use incremental with git strategy', async () => {
	const expected = ['file2'];

	// prepare an incremental file in place
	fs.writeFileSync('tests/.incremental', JSON.stringify({
		'test': '391010629523c2a1dfa1bb95badc6f30947da39b',
	}));

	const output = [...reader({
		cwd: 'tests/input',
		pattern: '**/file*.txt',
		encoding: 'utf-8',
		incremental: {
			strategy: 'git',
			file: 'tests/.incremental',
			key: 'test',
		},
	})].map(x => x.body.trim());

	output.sort((a, b) => a.localeCompare(b));
	expect(output).toStrictEqual(expected);
});

test('it should use triggers', async () => {
	const expected = ['file2', 'file3'];

	// prepare an incremental file in place
	fs.writeFileSync('tests/.incremental', JSON.stringify({
		'test': '391010629523c2a1dfa1bb95badc6f30947da39b',
	}));

	const output = [...reader({
		cwd: 'tests/input',
		pattern: '**/file*.txt',
		encoding: 'utf-8',
		incremental: {
			strategy: 'git',
			file: 'tests/.incremental',
			key: 'test',
			triggers: [
				['**/*2*', '**/*3*']
			]
		},
	})].map(x => x.body.trim());

	output.sort((a, b) => a.localeCompare(b));
	expect(output).toStrictEqual(expected);
});
