#!/usr/bin/env python3
"""No-cache static dev server (stdlib only), so edited CSS/JS is always picked up.

    python3 tools/serve.py 8010      # then open http://localhost:8010

Why not plain `python3 -m http.server`: its listen backlog is 5. The page loads ~15 ES modules
in parallel, so on macOS extra connections get reset (ERR_CONNECTION_RESET) and a random module
or data file fails, leaving the page half-working. This server has a large backlog, keeps
connections alive (HTTP/1.1) and tells the browser never to cache.
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'   # reuse connections instead of one per file

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_request(self, code='-', size='-'):  # quieter: log failed requests only
        if str(getattr(code, 'value', code))[:1] in '45':
            super().log_request(code, size)


class Server(ThreadingHTTPServer):
    request_queue_size = 128        # default 5 overflows with parallel module loads
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
    server = Server(('0.0.0.0', port), partial(NoCache, directory=ROOT))
    print(f'Serving {ROOT} on http://localhost:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
