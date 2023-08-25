import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type InsertOp = {
  operation: 'insert';
  position: number;
  text: string;
};

type DeleteOp = {
  operation: 'delete';
  start: number;
  end: number;
};

type OtOp = InsertOp | DeleteOp;

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "vscode-ot" is now active!');

  // show info event
  vscode.window.showInformationMessage('VSCode OT is now active');

  // TODO: When the file is changed, we need to update the HTML
  let lastOpenDocument = vscode.window.activeTextEditor?.document;
  // vscode.window.onDidChangeActiveTextEditor((editor) => {
  //   if (!editor) {
  //     return;
  //   }

  //   const document = editor.document;
  //   if (document === lastOpenDocument) {
  //     return;
  //   }

  //   lastOpenDocument = document;
  //   const otOps = readOTFile(document);
  //   panel.webview.html = getWebviewContent(otOps.length);
  // });

  // Create a Webview panel
  const panel = vscode.window.createWebviewPanel(
    'sliderPanel',
    'Range Slider',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true, // Enable JavaScript in the Webview
    }
  );

  const document = vscode.window.activeTextEditor?.document;
  if (document) {
    const otOps = readOTFile(document);
    panel.webview.html = getWebviewContent(otOps.length);
  }

  // Handle messages from the Webview
  panel.webview.onDidReceiveMessage((message) => {
    if (message.type === 'sliderChange') {
      const document =
        vscode.window.activeTextEditor?.document ?? lastOpenDocument;
      if (!document) {
        vscode.window.showErrorMessage('No active document');
        return;
      }

      console.log('Slider changed to ' + message.value);

      const otOps = readOTFile(document);
      const opsToApply = otOps.slice(0, message.value);
      const text = buildOT(opsToApply);

      // const newText = vscode.TextEdit.replace(
      //   new vscode.Range(0, 0, document.lineCount, 0),
      //   text
      // );
      // const edit = new vscode.WorkspaceEdit();
      // edit.set(document.uri, [newText]);
      // vscode.workspace.applyEdit(edit);

      // Post a message back to the webview to tell the slider what the new content is
      panel.webview.postMessage({
        type: 'updateContent',
        text: text,
      });
    }
  });

  vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.fileName.endsWith('.ot.json')) {
      return;
    }

    const changes = event.contentChanges;
    const otOps = changesToOT(changes);

    // After saving the operations, send a message to the webview to update the slider's max value
    const maxOps = saveToOTFile(event.document, otOps);
    panel.webview.postMessage({
      type: 'updateMax',
      maxValue: maxOps,
    });
  });

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
      operation: 'insert',
      position: 0,
      text: document.getText(),
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
      return [
        {
          operation: 'delete',
          start: change.range.start.character,
          end: change.range.end.character,
        },
        {
          operation: 'insert',
          position: change.range.start.character,
          text: change.text,
        },
      ];
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

function saveToOTFile(document: vscode.TextDocument, ops: OtOp[]): number {
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
  return existingOps.length;
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

function getWebviewContent(maxValue: number) {
  return `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        /* Add your CSS styles here */
      </style>
    </head>
    <body>
      <input
        type="range"
        id="ot-slider"
        min="0"
        max="${maxValue}"
        value="${maxValue}"
      />
      <span id="ot-value">${maxValue} / ${maxValue}</span>
      <br />
      <span id="ot-content"></span>
      <script>
        const maxValue = ${maxValue};
        const slider = document.getElementById('ot-slider');
        const content = document.getElementById('ot-content');
        const vscode = acquireVsCodeApi();

        slider.addEventListener('input', (event) => {
          console.log('from webview: Slider changed to ' + event.target.value)

          vscode.postMessage({
            type: 'sliderChange',
            value: parseInt(event.target.value),
          });

          const otValue = document.getElementById('ot-value');
          otValue.innerText = slider.value + ' / ' + maxValue;
        });

        window.addEventListener('message', event => {
          const message = event.data;
          switch (message.type) {
            case 'updateMax':
              slider.max = message.maxValue;
              const otValue = document.getElementById('ot-value');
              otValue.innerText = slider.value + ' / ' + slider.max;
              break;
            case 'updateContent':
              content.innerText = message.text;
              break;
          }
        });
      </script>
    </body>
  </html>`;
}
