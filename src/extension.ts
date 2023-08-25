import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type InsertOp = {
  operation: 'insert';
  position: number;
  text: string;
}

type DeleteOp = {
  operation: 'delete';
  start: number;
  end: number;
}

type OtOp = InsertOp | DeleteOp;

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "vscode-ot" is now active!');

  // show info event
  vscode.window.showInformationMessage('VSCode OT is now active');

  vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.fileName.endsWith('.ot.json')) {
      return;
    }

    const changes = event.contentChanges;
    const otOps = changesToOT(changes);
    saveToOTFile(event.document, otOps);
  });

  // A command to rebuild the file based on OT data. It will output a <file>.ot.<ext> file
  vscode.commands.registerCommand('vscode-ot.rebuild', () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
      vscode.window.showErrorMessage('No active document');
      return;
    }

    const otPath = path.join(
      path.dirname(document.fileName),
      path.basename(document.fileName) + '.ot.json'
    );
    if (!fs.existsSync(otPath)) {
      vscode.window.showErrorMessage('No OT file found');
      return;
    }

    const otOps = JSON.parse(fs.readFileSync(otPath, 'utf-8')) as OtOp[];
    const text = buildOT(otOps);
    const newText = vscode.TextEdit.replace(
      new vscode.Range(0, 0, document.lineCount, 0),
      text
    );
    const edit = new vscode.WorkspaceEdit();
    edit.set(document.uri, [newText]);
    vscode.workspace.applyEdit(edit);
  });

  // A command to clear the OT file
  vscode.commands.registerCommand('vscode-ot.clear', () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
      vscode.window.showErrorMessage('No active document');
      return;
    }

    const otPath = path.join(
      path.dirname(document.fileName),
      path.basename(document.fileName) + '.ot.json'
    );
    if (!fs.existsSync(otPath)) {
      vscode.window.showErrorMessage('No OT file found');
      return;
    }

    const insertOp: InsertOp = {
      operation: "insert",
      position: 0,
      text: document.getText()
    };

    // Prefill with file contents
    fs.writeFileSync(otPath, JSON.stringify([insertOp]));
    vscode.window.showInformationMessage('OT file cleared');
  });
}

function changesToOT(
  changes: readonly vscode.TextDocumentContentChangeEvent[]
): OtOp[] {
  return changes.map((change) => {
    if (change.text.length === 0) {
      return {
        operation: 'delete',
        start: change.range.start.character,
        end: change.range.end.character,
      };
    } else {
      return {
        operation: 'insert',
        position: change.range.start.character,
        text: change.text,
      };
    }
  });
}

function saveToOTFile(document: vscode.TextDocument, ops: OtOp[]) {
  const otPath = path.join(
    path.dirname(document.fileName),
    path.basename(document.fileName) + '.ot.json'
  );

  let existingOps = [];
  if (fs.existsSync(otPath)) {
    existingOps = JSON.parse(fs.readFileSync(otPath, 'utf-8'));
  }

  existingOps.push(...ops);
  fs.writeFileSync(otPath, JSON.stringify(existingOps, null, 2));

  console.log('Saved to ' + otPath);
}

function buildOT(ops: OtOp[]) {
  return ops.reduce((text, op) => {
    if (op.operation === 'insert') {
      return text.slice(0, op.position) + op.text + text.slice(op.position);
    } else if (op.operation === 'delete') {
      return text.slice(0, op.start) + text.slice(op.end);
    }

    return text;
  }, '');
}
