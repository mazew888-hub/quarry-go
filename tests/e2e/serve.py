"""Serves the repo on http://localhost:8765 (modules and service workers don't load from file://)."""
import functools, http.server, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PORT = 8765

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json',
                      '.woff2': 'font/woff2'}
    def log_message(self, *a): pass

def start():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

if __name__ == '__main__':
    start(); print(f'serving {ROOT} on http://localhost:{PORT}'); threading.Event().wait()
