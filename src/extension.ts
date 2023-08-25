import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ot from './ot';

type DocumentMessage = {
  type: 'vscode-ot';
  max: number;
  content: string;
  path: string;
  startLine: number;
};

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

  let message: DocumentMessage = {
    type: 'vscode-ot',
    max: 0,
    content: '',
    path: '',
    startLine: 0,
  };

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

    message = {
      ...message,
      max: otOps.length,
      content: ot.buildOT(otOps),
      path: document.fileName,
    };
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

  // set message to the current document
  if (document) {
    const otOps = readOTFile(document);

    message = {
      ...message,
      max: otOps.length,
      content: ot.buildOT(otOps),
      path: document.fileName,
    };
  }

  // Handle messages from the Webview
  panel.webview.onDidReceiveMessage((msg) => {
    if (msg.type === 'sliderChange') {
      const document =
        vscode.window.activeTextEditor?.document ?? lastOpenDocument;
      if (!document) {
        vscode.window.showErrorMessage('No active document');
        return;
      }

      const otOps = readOTFile(document);
      const opsToApply = otOps.slice(0, msg.value);
      const text = ot.buildOT(opsToApply);

      let lastOp = opsToApply[opsToApply.length - 1];
      let lastIndex = 0;
      if (lastOp?.operation === 'insert') {
        lastIndex = lastOp.position;
      } else if (lastOp?.operation === 'delete') {
        lastIndex = lastOp.start;
      }

      message = {
        ...message,
        content: text,
        startLine: getLineNumber(text, lastIndex),
      };

      // Post a message back to the webview to tell the slider what the new content is
      panel?.webview.postMessage(message);
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

    message = { ...message, max: maxOps };

    panel?.webview.postMessage(message);
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

function getLineNumber(input: string, index: number): number {
  if (index < 0 || index >= input.length) {
    throw new Error('Index is out of bounds.');
  }

  const lines = input.split('\n');
  let currentIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLength = line.length + 1; // Include the newline character
    if (currentIndex + lineLength > index) {
      return i + 1; // Line numbers are 1-based
    }
    currentIndex += lineLength;
  }

  return -1; // Index not found
}

function getWebviewContent(maxValue: number, content: string = '') {
  return `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        #fixed {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 50px;
          background-color: #333;
          color: #fff;
          padding: 10px;
          box-sizing: border-box;
        }
      </style>
    </head>
    <body>
      <div id="fixed">
        <input
          type="range"
          id="ot-slider"
          min="1"
          max="${maxValue}"
          value="${maxValue}"
        />
        <span id="ot-value">${maxValue} / ${maxValue}</span>
        <br />
        <span id="path"></span>
      </div>
      <br />
      <pre id="ot-content">${content}</pre>
      <script>
        const maxValue = ${maxValue};
        const slider = document.getElementById('ot-slider');
        const content = document.getElementById('ot-content');
        const otValue = document.getElementById('ot-value');
        const path = document.getElementById('path');
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
          if (message.type === 'vscode-ot') {
            console.log({message});
            slider.max = message.max;
            path.innerText = message.path;
            otValue.innerText = slider.value + ' / ' + message.max;
            content.innerText = message.content;

            // scroll the window to line
            const lineNumber = message.startLine;
            const lineHeight = 76;
            const scrollOffset = window.innerHeight / 2;
            const top = (lineNumber - 1) * lineHeight - scrollOffset;
            window.scrollTo(0, top);
          }
        });
      </script>
    </body>
  </html>`;
}
