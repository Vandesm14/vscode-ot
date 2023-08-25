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

// type SelectOp = {
//   operation: 'select';
//   start: number;
//   end: number;
// }

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

  // vscode.window.onDidChangeTextEditorSelection((event) => {
  //   const document = event.textEditor.document;
  //   if (document.fileName.endsWith('.ot.json')) {
  //     return;
  //   }

  //   const selection = event.selections[0];
  //   const otOps: OtOp[] = [{
  //     operation: 'select',
  //     start: selection.start.character,
  //     end: selection.end.character,
  //   }];
  //   saveToOTFile(document, otOps);
  // });

  // A command to rebuild the file based on OT data. It will output a <file>.ot.<ext> file
  vscode.commands.registerCommand('vscode-ot.rebuild', () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
      vscode.window.showErrorMessage('No active document');
      return;
    }

    const otOps = readOTFile(document);
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

    const otPath = otFilePath(document);
    const insertOp: InsertOp = {
      operation: "insert",
      position: 0,
      text: document.getText()
    };

    if (!otPath) {
      return;
    }

    // Prefill with file contents
    fs.writeFileSync(otPath, JSON.stringify([insertOp]));
    vscode.window.showInformationMessage('OT file cleared');
  });
}

function otFilePath(document: vscode.TextDocument): string | null {
  let otPath = '';
  if (document.fileName.endsWith('.ot.json')) {
    otPath = document.fileName;
  } else {
    otPath = path.join(
      path.dirname(document.fileName),
      path.basename(document.fileName) + '.ot.json'
    );
    if (!fs.existsSync(otPath)) {
      vscode.window.showErrorMessage('No OT file found');
      return null;
    }
  }

  return otPath;
}

function readOTFile(document: vscode.TextDocument): OtOp[] {
  const otPath = otFilePath(document);
  if (!otPath) {
    return [];
  }

  return JSON.parse(fs.readFileSync(otPath).toString()) as OtOp[];
}

function changesToOT(
  changes: readonly vscode.TextDocumentContentChangeEvent[]
): OtOp[] {
  return changes.flatMap((change) => {
    if (change.rangeLength > 0 && change.text.length > 0) {
      // If the change replaces text, we need to delete the old text and insert the new text
      return [{
        operation: 'delete',
        start: change.range.start.character,
        end: change.range.end.character,
      }, {
        operation: 'insert',
        position: change.range.start.character,
        text: change.text,
      }];
    } else if (change.text.length === 0) {
      // If the change deletes text
      return {
        operation: 'delete',
        start: change.range.start.character,
        end: change.range.end.character,
      };
    } else {
      // If the change inserts text
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

  let existingOps: OtOp[] = [];
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

function equals(a: OtOp, b: OtOp) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isOppositeOp(a: OtOp, b: OtOp) {
  if (a.operation === 'insert' && b.operation === 'delete') {
    return a.position >= b.start && a.position <= b.end;
  } else if (a.operation === 'delete' && b.operation === 'insert') {
    return b.position >= a.start && b.position <= a.end;
  }

  return false;
}