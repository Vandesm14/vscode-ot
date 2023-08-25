import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "vscode-ot" is now active!');

  // show info event
  vscode.window.showInformationMessage('VSCode OT is now active');

  vscode.workspace.onDidChangeTextDocument(event => {
    const changes = event.contentChanges;
    const otOps = changesToOT(changes);
    saveToOTFile(event.document, otOps);
  });
}

function changesToOT(changes: readonly vscode.TextDocumentContentChangeEvent[]) {
  return changes.map(change => {
    if (change.text.length === 0) {
      return {
        operation: 'delete',
        start: change.range.start.character,
        end: change.range.end.character
      };
    } else {
      return {
        operation: 'insert',
        position: change.range.start.character,
        text: change.text
      };
    }
  });
}

function saveToOTFile(document: vscode.TextDocument, ops: any[]) {
  const otPath = path.join(path.dirname(document.fileName), path.basename(document.fileName) + '.ot.json');

  let existingOps = [];
  if (fs.existsSync(otPath)) {
    existingOps = JSON.parse(fs.readFileSync(otPath, 'utf-8'));
  }

  existingOps.push(...ops);
  fs.writeFileSync(otPath, JSON.stringify(existingOps));

  console.log('Saved to ' + otPath);
}
