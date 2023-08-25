import * as vscode from 'vscode';

export type InsertOp = {
  operation: 'insert';
  position: number;
  text: string;
};

export type DeleteOp = {
  operation: 'delete';
  start: number;
  end: number;
};

export type OtOp = InsertOp | DeleteOp;

export function changesToOT(
  changes: readonly vscode.TextDocumentContentChangeEvent[]
): OtOp[] {
  return changes.flatMap((change) => {
    const offset = change.rangeOffset;
    const endOffset = offset + change.rangeLength;
    if (change.rangeLength > 0 && change.text.length > 0) {
      // If the change replaces text, we need to delete the old text and insert the new text
      return [
        {
          operation: 'delete',
          start: offset,
          end: endOffset,
        },
        {
          operation: 'insert',
          position: offset,
          text: change.text,
        },
      ];
    } else if (change.text.length === 0) {
      // If the change deletes text
      return {
        operation: 'delete',
        start: offset,
        end: endOffset,
      };
    } else {
      // If the change inserts text
      return {
        operation: 'insert',
        position: offset,
        text: change.text,
      };
    }
  });
}

export function buildOT(ops: OtOp[]) {
  return ops.reduce((text, op) => {
    if (op.operation === 'insert') {
      return text.slice(0, op.position) + op.text + text.slice(op.position);
    } else if (op.operation === 'delete') {
      return text.slice(0, op.start) + text.slice(op.end);
    }

    return text;
  }, '');
}

export function equals(a: OtOp, b: OtOp) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isOppositeOp(a: OtOp, b: OtOp) {
  if (a.operation === 'insert' && b.operation === 'delete') {
    return a.position >= b.start && a.position <= b.end;
  } else if (a.operation === 'delete' && b.operation === 'insert') {
    return b.position >= a.start && b.position <= a.end;
  }

  return false;
}
