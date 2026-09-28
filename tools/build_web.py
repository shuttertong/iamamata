#!/usr/bin/env python3
"""Package the website for static hosting (stdlib only).

    python3 tools/build_web.py           # → dist/web/ (folder to upload) + dist/flood-map-web.zip

Production settings come from environment variables, so src/config.js in git stays in demo mode:
  SUPABASE_URL, SUPABASE_ANON_KEY (the public anon key — never the service_role key), TURNSTILE_SITE_KEY
GitHub Actions passes them from the repository's Actions variables (.github/workflows/deploy.yml).

The output holds only what the browser needs: index.html, admin.html, src/, data/, plus hosting config:
  .htaccess  — Hostinger / Apache / LiteSpeed: force HTTPS, revalidate HTML/JS/CSS/data after updates,
               no directory listing, keep admin.html out of search engines
  _headers   — the same cache and robots rules for Cloudflare Pages (ignored elsewhere)
  robots.txt — don't index the admin page
Upload it to the web root (Hostinger: hPanel → File Manager → public_html → Upload → Extract).
All paths in the app are relative, so a subfolder (e.g. public_html/flood/) works too.
"""
import os
import re
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'dist', 'flood-map-web.zip')
OUT_DIR = os.path.join(ROOT, 'dist', 'web')
# config.js key → environment variable that overrides it at build time.
ENV_CONFIG = {'supabaseUrl': 'SUPABASE_URL', 'supabaseAnonKey': 'SUPABASE_ANON_KEY', 'turnstileSiteKey': 'TURNSTILE_SITE_KEY'}
SAFE_VALUE = re.compile(r"^[A-Za-z0-9_.:/\-]+$")   # URLs and JWT-style keys only; nothing that could break out of the JS string
INCLUDE_FILES = ['index.html', 'admin.html']
INCLUDE_DIRS = ['src', 'data']
SKIP = re.compile(r'(\.tmp$|\.DS_Store$|__pycache__)')

HTACCESS = """# แผนที่น้ำท่วม — Hostinger (Apache / LiteSpeed)
Options -Indexes
DirectoryIndex index.html

# HTTPS only: the camera, GPS and the data APIs need a secure page.
# (If hPanel's "Force HTTPS" is already on and you see a redirect loop, delete these three lines.)
RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

AddType text/javascript .js
AddType application/json .json
AddType application/geo+json .geojson
AddType image/svg+xml .svg

<IfModule mod_headers.c>
  # Updates show up at once: browsers check for a newer file (ETag) instead of using an old copy.
  <FilesMatch "\\.(html|js|css|json|geojson)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  <Files "admin.html">
    Header set X-Robots-Tag "noindex, nofollow"
  </Files>
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/json application/geo+json
</IfModule>
"""

HEADERS = """# Cloudflare Pages headers (same rules as .htaccess)
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/*.html
  Cache-Control: no-cache
/src/*
  Cache-Control: no-cache
/data/*
  Cache-Control: no-cache
/admin.html
  X-Robots-Tag: noindex, nofollow
"""

ROBOTS = "User-agent: *\nDisallow: /admin.html\n"


def build_config():
    """src/config.js with production values from the environment (only the keys that are set)."""
    text = open(os.path.join(ROOT, 'src', 'config.js'), encoding='utf-8').read()
    for key, env in ENV_CONFIG.items():
        value = os.environ.get(env, '').strip()
        if not value:
            continue
        if not SAFE_VALUE.match(value):
            raise SystemExit(f'{env} has unexpected characters; refusing to write it into config.js')
        if env == 'SUPABASE_ANON_KEY' and 'service_role' in value:
            raise SystemExit('SUPABASE_ANON_KEY looks like a service_role key — never ship that to browsers')
        text, n = re.subn(rf"({key}:\s*)'[^']*'", lambda m: f"{m.group(1)}'{value}'", text, count=1)
        if not n:
            raise SystemExit(f'config.js has no {key} to set')
        print(f'config.js: {key} ← ${env}')
    return text


def main():
    config = build_config()
    demo = re.search(r"supabaseUrl:\s*''", config) is not None
    files = {f: open(os.path.join(ROOT, f), 'rb').read() for f in INCLUDE_FILES}
    for d in INCLUDE_DIRS:
        for base, _, names in os.walk(os.path.join(ROOT, d)):
            for f in sorted(names):
                full = os.path.join(base, f)
                if not SKIP.search(full):
                    files[os.path.relpath(full, ROOT)] = open(full, 'rb').read()
    files[os.path.join('src', 'config.js')] = config.encode('utf-8')
    files['.htaccess'] = HTACCESS.encode('utf-8')
    files['_headers'] = HEADERS.encode('utf-8')
    files['robots.txt'] = ROBOTS.encode('utf-8')

    # dist/web/ — the folder GitHub Actions uploads to Hostinger (rebuilt from scratch each time)
    shutil.rmtree(OUT_DIR, ignore_errors=True)
    for rel, data in files.items():
        path = os.path.join(OUT_DIR, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(data)
    # dist/flood-map-web.zip — the same files, for uploading by hand in hPanel's File Manager
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel, data in files.items():
            z.writestr(rel.replace(os.sep, '/'), data)
    print(f'dist/web/ + {os.path.relpath(OUT, ROOT)}: {len(files)} files, {os.path.getsize(OUT) / 1024:.0f} KB')
    if demo:
        print('\n⚠️  DEMO MODE: src/config.js has no supabaseUrl. Reports stay on each visitor\'s device and\n'
              '    reach no one. The page shows a warning banner; set up Supabase before real use.')


if __name__ == '__main__':
    sys.exit(main())
