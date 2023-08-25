import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ot from './ot';

export async function activate(context: vscode.ExtensionContext) {
  const rootFolder = vscode.workspace.workspaceFolders;
  if (!rootFolder) {
    vscode.window.showErrorMessage(
      'VSCode OT: No workspace folder found. Please open a folder first.'
    );
    return;
  }

  const rootUri = rootFolder[0].uri;
  const otFolder = vscode.Uri.joinPath(rootUri, '.ot');

  // check if .ot/ folder exists
  try {
    await vscode.workspace.fs.stat(otFolder);
  } catch {
    console.log('Creating .ot folder');

    await vscode.workspace.fs.createDirectory(otFolder);
  }

  // When the file is changed, we need to update the HTML
  let lastOpenDocument = vscode.window.activeTextEditor?.document;
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor) {
      return;
    }

    const document = editor.document;
    if (document === lastOpenDocument) {
      return;
    }

    lastOpenDocument = document;
    const otOps = readOTFile(document);

    // Post a message back to the webview to tell the slider what the new content is
    panel?.webview.postMessage({
      type: 'updateContent',
      text: ot.buildOT(otOps),
    });

    panel?.webview.postMessage({
      type: 'updateMax',
      maxValue: otOps.length,
    });
  });

  // Create a Webview panel
  let panel: vscode.WebviewPanel | null = vscode.window.createWebviewPanel(
    'sliderPanel',
    'Range Slider',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true, // Enable JavaScript in the Webview
    }
  );

  panel.onDidDispose(() => {
    panel = null;
  });

  // Create or reopen the Webview panel
  function createOrReopenPanel() {
    console.log({ panel });

    if (panel) {
      // If the panel already exists, reveal it
      panel.reveal(vscode.ViewColumn.Beside);
    } else {
      // Create a new panel
      panel = vscode.window.createWebviewPanel(
        'sliderPanel',
        'Range Slider',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
        }
      );

      const document = vscode.window.activeTextEditor?.document;
      panel.webview.html = getWebviewContent(
        document ? readOTFile(document).length : 0
      );

      // Dispose the panel when it's closed
      panel.onDidDispose(() => {
        panel = null;
      });
    }
  }

  const document = vscode.window.activeTextEditor?.document;
  panel.webview.html = getWebviewContent(
    document ? readOTFile(document).length : 0
  );

  // Handle messages from the Webview
  panel.webview.onDidReceiveMessage((message) => {
    if (message.type === 'sliderChange') {
      const document =
        vscode.window.activeTextEditor?.document ?? lastOpenDocument;
      if (!document) {
        vscode.window.showErrorMessage('No active document');
        return;
      }

      const otOps = readOTFile(document);
      const opsToApply = otOps.slice(0, message.value);
      const text = ot.buildOT(opsToApply);

      // Post a message back to the webview to tell the slider what the new content is
      panel?.webview.postMessage({
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
    const otOps = ot.changesToOT(changes);

    // After saving the operations, send a message to the webview to update the slider's max value
    const maxOps = saveToOTFile(event.document, otOps);
    panel?.webview.postMessage({
      type: 'updateMax',
      maxValue: maxOps,
    });
  });

  vscode.commands.registerCommand('vscode-ot.openSlider', () => {
    createOrReopenPanel();
  });

  // A command to clear the OT file
  vscode.commands.registerCommand('vscode-ot.clear', () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
      vscode.window.showErrorMessage('No active document');
      return;
    }

    const otPath = otFilePath(document);
    const insertOp: ot.InsertOp = {
      operation: 'insert',
      position: 0,
      text: document.getText(),
    };

    // Prefill with file contents
    fs.writeFileSync(otPath, JSON.stringify([insertOp]));
    vscode.window.showInformationMessage('OT file cleared');
  });

  console.log('Extension "vscode-ot" is now active!');

  // show info event
  vscode.window.showInformationMessage('VSCode OT is now active');

  function saveToOTFile(document: vscode.TextDocument, ops: ot.OtOp[]): number {
    const otPath = otFilePath(document);
    const existingOps = readOTFile(document);

    if (existingOps.length === 0) {
      // Prefill with file contents
      const insertOp: ot.InsertOp = {
        operation: 'insert',
        position: 0,
        text: document.getText(),
      };
      existingOps.push(insertOp);
    }

    existingOps.push(...ops);
    fs.writeFileSync(otPath, JSON.stringify(existingOps, null, 2));

    console.log('Saved to ' + otPath);
    return existingOps.length;
  }

  function otFilePath(document: vscode.TextDocument): string {
    const otPath = path.join(
      otFolder.fsPath,
      encodeURIComponent(document.fileName).toString() + '.ot.json'
    );

    return otPath;
  }

  function readOTFile(document: vscode.TextDocument): ot.OtOp[] {
    const otPath = otFilePath(document);
    if (!fs.existsSync(otPath)) {
      return [];
    }

    return JSON.parse(fs.readFileSync(otPath).toString()) as ot.OtOp[];
  }
}

function getWebviewContent(maxValue: number, content: string = '') {
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
        min="1"
        max="${maxValue}"
        value="${maxValue}"
      />
      <span id="ot-value">${maxValue} / ${maxValue}</span>
      <br />
      <span id="ot-content">${content}</span>
      <script>
        const maxValue = ${maxValue};
        const slider = document.getElementById('ot-slider');
        const content = document.getElementById('ot-content');
        const otValue = document.getElementById('ot-value');
        const vscode = acquireVsCodeApi();

        slider.addEventListener('input', (event) => {
          vscode.postMessage({
            type: 'sliderChange',
            value: parseInt(event.target.value),
          });

          otValue.innerText = slider.value + ' / ' + maxValue;
        });

        window.addEventListener('message', event => {
          const message = event.data;
          switch (message.type) {
            case 'updateMax':
              slider.max = message.maxValue;
              otValue.innerText = slider.value + ' / ' + message.maxValue;
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
