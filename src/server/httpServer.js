// A minimal hand-rolled HTTP server built on raw TCP sockets.
//
// Why not just use Node's "http" module like the PC (Electron) version?
// Electron apps run on a real Node.js runtime, so `require('http')` works
// out of the box. React Native apps run on a mobile JS engine (Hermes),
// which has no built-in networking beyond fetch/WebSocket - there's no
// low-level TCP or HTTP server available unless a *native module*
// provides one. `react-native-tcp-socket` is that native module: it
// gives us a raw TCP server, and this file builds just enough of the
// HTTP protocol on top of it to serve one HTML page and accept one kind
// of file upload. It is intentionally minimal (not a general-purpose
// server) - just enough for DataShare's one job.

import TcpSocket from 'react-native-tcp-socket';
import * as FileSystem from 'expo-file-system';

const RECEIVED_DIR = FileSystem.documentDirectory + 'DataShareReceived/';

async function ensureReceivedDir() {
  const info = await FileSystem.getInfoAsync(RECEIVED_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(RECEIVED_DIR, { intermediates: true });
  }
}

// The web page shown when someone scans the QR code / opens the link.
// Deliberately close to the PC version's public/upload.html so the
// experience feels the same on both ends.
function getUploadPageHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Send to Phone</title>
  <style>
    body { font-family: -apple-system, Roboto, Arial, sans-serif; background:#f5f5f7; margin:0; padding:24px; }
    h1 { font-size:20px; margin-bottom:4px; }
    p { color:#666; margin-top:0; }
    .drop { border:2px dashed #bbb; border-radius:12px; padding:32px; text-align:center; margin:20px 0; background:#fff; }
    input[type=file] { display:none; }
    label, button { display:block; width:100%; padding:14px; margin-top:10px; border-radius:8px; border:none; font-size:16px; text-align:center; cursor:pointer; }
    label { background:#eee; color:#333; }
    button { background:#2563eb; color:#fff; }
    #status { margin-top:14px; text-align:center; color:#16a34a; font-weight:600; }
  </style>
</head>
<body>
  <h1>Send to Phone</h1>
  <p>Choose files to send to this device</p>
  <div class="drop">
    <label for="fileInput">Tap to choose files</label>
    <input id="fileInput" type="file" multiple />
  </div>
  <button onclick="sendFiles()">Send</button>
  <div id="status"></div>
  <script>
    function sendFiles() {
      const input = document.getElementById('fileInput');
      const status = document.getElementById('status');
      if (!input.files.length) { status.textContent = 'Please choose a file first.'; return; }
      const formData = new FormData();
      for (const f of input.files) formData.append('files', f);
      status.textContent = 'Sending...';
      fetch('/upload', { method: 'POST', body: formData })
        .then((res) => res.json())
        .then(() => { status.textContent = 'Sent successfully! You can close this page.'; })
        .catch(() => { status.textContent = 'Failed to send. Please try again.'; });
    }
  </script>
</body>
</html>`;
}

function parseHeaders(rawHeaderText) {
  const lines = rawHeaderText.split('\r\n');
  const requestLine = lines[0]; // e.g. "POST /upload HTTP/1.1"
  const [method, path] = requestLine.split(' ');
  const headers = {};
  for (let i = 1; i < lines.length; i++) {
    const idx = lines[i].indexOf(':');
    if (idx === -1) continue;
    const key = lines[i].slice(0, idx).trim().toLowerCase();
    const value = lines[i].slice(idx + 1).trim();
    headers[key] = value;
  }
  return { method, path, headers };
}

// Extremely small multipart/form-data parser - good enough for simple
// file uploads from a browser's <input type="file">. Not meant to
// handle every edge case a full server library would.
function parseMultipart(bodyBuffer, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = bodyBuffer.indexOf(boundaryBuf);
  while (start !== -1) {
    const nextBoundary = bodyBuffer.indexOf(boundaryBuf, start + boundaryBuf.length);
    if (nextBoundary === -1) break;
    const partBuf = bodyBuffer.slice(start + boundaryBuf.length, nextBoundary);
    const headerEnd = partBuf.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = partBuf.slice(0, headerEnd).toString('utf8');
      // strip trailing \r\n before next boundary
      let content = partBuf.slice(headerEnd + 4, partBuf.length - 2);
      const nameMatch = headerText.match(/name="([^"]+)"/);
      const filenameMatch = headerText.match(/filename="([^"]+)"/);
      if (filenameMatch && filenameMatch[1]) {
        parts.push({
          fieldName: nameMatch ? nameMatch[1] : 'file',
          filename: filenameMatch[1],
          data: content,
        });
      }
    }
    start = nextBoundary;
  }
  return parts;
}

export class DataShareServer {
  constructor({ port = 3000, onFileReceived } = {}) {
    this.port = port;
    this.onFileReceived = onFileReceived;
    this.server = null;
  }

  async start() {
    await ensureReceivedDir();

    this.server = TcpSocket.createServer((socket) => {
      let chunks = [];
      let expectedLength = null;
      let headerParsed = null;
      let headerByteLength = 0;

      socket.on('data', (data) => {
        chunks.push(data);
        const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)));

        if (!headerParsed) {
          const headerEndIndex = combined.indexOf('\r\n\r\n');
          if (headerEndIndex === -1) return; // wait for more data
          const headerText = combined.slice(0, headerEndIndex).toString('utf8');
          headerParsed = parseHeaders(headerText);
          headerByteLength = headerEndIndex + 4;
          expectedLength = parseInt(headerParsed.headers['content-length'] || '0', 10);
        }

        const bodyLengthSoFar = combined.length - headerByteLength;
        if (bodyLengthSoFar < expectedLength) return; // wait for more data

        // Full request received - handle it
        this.handleRequest(headerParsed, combined.slice(headerByteLength, headerByteLength + expectedLength), socket);
        chunks = [];
        headerParsed = null;
      });

      socket.on('error', () => {});
    });

    this.server.listen({ port: this.port, host: '0.0.0.0' });
    return this.port;
  }

  async handleRequest(request, bodyBuffer, socket) {
    const { method, path, headers } = request;

    if (method === 'GET' && (path === '/' || path === '')) {
      const html = getUploadPageHtml();
      this.writeResponse(socket, 200, 'text/html', html);
      return;
    }

    if (method === 'POST' && path.startsWith('/upload')) {
      try {
        const contentType = headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=(.+)$/);
        if (!boundaryMatch) {
          this.writeResponse(socket, 400, 'application/json', JSON.stringify({ success: false }));
          return;
        }
        const parts = parseMultipart(bodyBuffer, boundaryMatch[1]);
        const saved = [];

        for (const part of parts) {
          const safeName = `${Date.now()}-${part.filename}`;
          const destPath = RECEIVED_DIR + safeName;
          // expo-file-system writes strings/base64, so convert the raw bytes
          const base64Data = part.data.toString('base64');
          await FileSystem.writeAsStringAsync(destPath, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const fileInfo = { name: part.filename, path: destPath, receivedAt: new Date().toISOString() };
          saved.push(fileInfo);
          if (this.onFileReceived) this.onFileReceived(fileInfo);
        }

        this.writeResponse(socket, 200, 'application/json', JSON.stringify({ success: true, files: saved }));
      } catch (err) {
        this.writeResponse(socket, 500, 'application/json', JSON.stringify({ success: false, error: String(err) }));
      }
      return;
    }

    this.writeResponse(socket, 404, 'text/plain', 'Not found');
  }

  writeResponse(socket, statusCode, contentType, body) {
    const statusText = { 200: 'OK', 400: 'Bad Request', 404: 'Not Found', 500: 'Server Error' }[statusCode] || 'OK';
    const bodyBuffer = Buffer.from(body, 'utf8');
    const responseHeader =
      `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
      `Content-Type: ${contentType}\r\n` +
      `Content-Length: ${bodyBuffer.length}\r\n` +
      `Connection: close\r\n\r\n`;
    socket.write(responseHeader);
    socket.write(bodyBuffer);
    socket.end();
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

export { RECEIVED_DIR };
