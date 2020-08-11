import { commands, LanguageClient, workspace } from 'coc.nvim';
import { statusBar } from '../../lib/status';
import { cmdPrefix } from '../../util/constant';
import { Range } from 'vscode-languageserver-protocol';

import { Dispose } from '../../util/dispose';

interface ClientParams_Outline {
	uri: string;
	outline: OutlineParams;
}

interface OutlineParams {
	element: ElementParams;
	range: Range;
	codeRange: Range;
	children: OutlineParams[];
	folded: boolean;
}

interface ElementParams {
	name: string;
	range: Range;
	kind: string;
	parameters: string | undefined;
	typeParameters: string | undefined;
	returnType: string | undefined;
}

export class Outline extends Dispose {
	public outlines: Record<string, OutlineParams> = {};
	public outlineStrings: Record<string, string[]> = {};
	public outlineVersions: Record<string, number> = {};
	public outlineVersions_Rendered: Record<string, number> = {};
	public outlineBuffer: any;

	constructor(client: LanguageClient) {
		super();
		this.init(client);
	}

	updateOutlineBuffer = async (uri: string) => {
		console.log(uri, this.outlineVersions[uri], this.outlineVersions_Rendered[uri]);
		if (this.outlineVersions[uri] == this.outlineVersions_Rendered[uri] && this.outlineVersions[uri] !== undefined)
			return;
		if (this.outlineBuffer && this.outlineStrings[uri]) {
			this.outlineVersions_Rendered[uri] = this.outlineVersions[uri];
			await this.outlineBuffer.setOption('modifiable', true);
			const len = await this.outlineBuffer.length;
			const content = this.outlineStrings[uri];
			if (len > content.length) {
				await this.outlineBuffer.setLines([], {
					start: 0,
					end: len - 1,
				});
				// console.log(this.outlineStrings[uri]);
				await this.outlineBuffer.setLines(content, {
					start: 0,
					end: 0,
					strictIndexing: false,
				});
			} else {
				await this.outlineBuffer.setLines(content, {
					start: 0,
					end: len - 1,
					strictIndexing: false,
				});
			}
			// await this.outlineBuffer.setOption('modifiable', false);
		}
	};

	async init(client: LanguageClient) {
		const { nvim } = workspace;
		client.onNotification('dart/textDocument/publishOutline', this.onOutline);
		const updateCursorText = async () => {
			const cursor = await (await nvim.window).cursor;
			const path = await nvim.commandOutput('echo expand("%:p")');
			const uri = `file://${path}`;
			let outline = this.outlines[uri];
			if (outline) {
				this.updateOutlineBuffer(uri);
				let elementPath = '';
				let foundChild = true;
				while (foundChild) {
					foundChild = false;
					if (Array.isArray(outline.children) && outline.children.length > 0) {
						for (const child of outline.children) {
							const curLine = cursor[0] - 1,
								curCol = cursor[1];
							const startLine = child.codeRange.start.line,
								startCol = child.codeRange.start.character;
							const endLine = child.codeRange.end.line,
								endCol = child.codeRange.end.character;
							if (
								(curLine > startLine || (curLine == startLine && curCol >= startCol)) &&
								(curLine < endLine || (curLine == endLine && curCol < endCol))
							) {
								outline = child;
								foundChild = true;
								break;
							}
						}
					}
					if (foundChild) {
						elementPath += ` > ${outline.element.name}`;
					} else {
						break;
					}
				}
				statusBar.show(elementPath, false);
			}
		};
		const outlineBufferName = '__flutter_widget_tree';
		commands.registerCommand(`${cmdPrefix}.updateCursorText`, updateCursorText);
		commands.registerCommand(`${cmdPrefix}.openWidgetTree`, async () => {
			const curWin = await nvim.window;
			await nvim.command('set splitright');
			await nvim.command(`30vsplit ${outlineBufferName}`);
			const win = await nvim.window;
			await nvim.command('set buftype=nofile');
			await nvim.command('setlocal nomodifiable');
			await nvim.command('setlocal nonumber');
			await nvim.command('setlocal norelativenumber');
			await nvim.command('setlocal nowrap');
			await nvim.call('win_gotoid', [curWin.id]);
			this.outlineBuffer = await win.buffer;
			const buf = await win.buffer;
			// const r = await nvim.commandOutput('new');
			// console.log(r);
		});
	}

	generateOutlineStrings = (uri: string) => {
		const root = this.outlines[uri];
		const lines: string[] = [];
		const verticalLine = '│';
		const horizontalLine = '─';
		const bottomCorner = '└';
		const middleCorner = '├';
		const icons = {
			TOP_LEVEL_VARIABLE: '\uf93d',
			CLASS: '\uf0e8 ',
			FIELD: '\uf93d',
			CONSTRUCTOR: '\ue624 ',
			CONSTRUCTOR_INVOCATION: '\ufc2a ',
			FUNCTION: '\u0192 ',
			METHOD: '\uf6a6 ',
		};
		const icon_default = '\ue612';
		function genOutline(outline: OutlineParams, indentStr: string) {
			let indent = indentStr;
			let foldIndicator = '  ';
			let icon = icons[outline.element.kind];
			if (icon === undefined) icon = icon_default;
			// icon += ' ';
			if (Array.isArray(outline.children) && outline.children.length > 0 && outline.folded === true)
				foldIndicator = '▸ ';
			lines.push(indent + icon + outline.element.name);
			const len = indent.length;
			if (len > 1) {
				if (indent[len - 2] == middleCorner) {
					indent = indent.substr(0, len - 2) + verticalLine + ' ';
				} else if (indent[len - 2] == bottomCorner) {
					indent = indent.substr(0, len - 2) + '  ';
				}
			}
			if (Array.isArray(outline.children))
				if (outline.children.length == 1) {
					genOutline(outline.children[0], `${indent}  `);
				} else if (outline.children.length > 1) {
					for (let i = 0; i < outline.children.length; ++i) {
						if (i == outline.children.length - 1) {
							// indent = indent.substr(0, len - 2) + '  ';
							genOutline(outline.children[i], `${indent}${bottomCorner}${horizontalLine}`);
						} else {
							genOutline(outline.children[i], `${indent}${middleCorner}${horizontalLine}`);
						}
					}
				}
		}
		if (Array.isArray(root.children) && root.children.length > 0)
			for (const child of root.children) genOutline(child, ' ');
		this.outlineStrings[uri] = lines;
		if (this.outlineVersions[uri] === undefined) {
			this.outlineVersions[uri] = 0;
		} else {
			this.outlineVersions[uri] += 1;
		}
	};

	onOutline = async (params: ClientParams_Outline) => {
		const { uri, outline } = params;
		const doc = workspace.getDocument(uri);
		// ensure the document is exists
		if (!doc) {
			return;
		}

		this.outlines[uri] = outline;
		this.generateOutlineStrings(uri);
		this.updateOutlineBuffer(uri);
	};
}