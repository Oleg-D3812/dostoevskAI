"""Static file server for local preview that disables caching.

Python's stock ``http.server`` only sends ``Last-Modified``, which makes some
browsers hold JS/CSS in cache across edits. This subclass adds ``no-store`` so
every reload fetches fresh files.
"""
import sys
from http.server import SimpleHTTPRequestHandler, test


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        if keyword.lower() in ("last-modified", "etag"):
            return
        super().send_header(keyword, value)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    test(HandlerClass=NoCacheHandler, port=port, bind="127.0.0.1")
