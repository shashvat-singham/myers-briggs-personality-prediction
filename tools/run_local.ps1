# Run the backend locally on Windows without Docker.
#
#   powershell -ExecutionPolicy Bypass -File tools\run_local.ps1
#   powershell -ExecutionPolicy Bypass -File tools\run_local.ps1 -Port 5001
#
# Why this script exists:
#   * gunicorn does not run on Windows (it needs fcntl), so the production
#     command in the Dockerfile is not usable here. This starts Flask's server
#     with the reloader off -- the reloader would load ~24 MB of joblib
#     artifacts twice, in both the parent and child process.
#   * models/*.joblib were serialised with scikit-learn 0.23.2, whose newest
#     supported interpreter is CPython 3.8, so the venv must be a 3.8 one.
#     `uv` can fetch a standalone 3.8 on a machine that has no system 3.8:
#         pip install uv
#         uv python install 3.8
#         uv venv --python 3.8 C:\mbpp38
#         uv pip install --python C:\mbpp38\Scripts\python.exe -r requirements.txt
#         C:\mbpp38\Scripts\python.exe -m nltk.downloader punkt stopwords wordnet omw-1.4 averaged_perceptron_tagger
#
# Database: if secrets\service-account.json exists it is used and predictions
# are persisted to the Realtime Database. Otherwise persistence is switched off
# and predictions come back with "stored": false -- everything else still works.

param(
    [string]$Python = "C:\mbpp38\Scripts\python.exe",
    [int]$Port = 5000,
    [string]$DatabaseUrl = "https://mbpp-7347c-default-rtdb.firebaseio.com",
    [string]$ProjectId = "mbpp-7347c"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

if (-not (Test-Path $Python)) {
    Write-Error "Python 3.8 interpreter not found at $Python. See the header of this script for how to create it."
}

$version = & $Python -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ($version -ne "3.8") {
    Write-Warning "Interpreter at $Python reports Python $version. The pinned model stack needs 3.8; joblib.load will likely fail."
}

$env:APP_ENV = "development"
$env:LOG_JSON = "false"
$env:LOG_LEVEL = "INFO"
$env:PORT = "$Port"
if (-not $env:SECRET_KEY) { $env:SECRET_KEY = "local-dev-only" }

$keyPath = Join-Path $root "secrets\service-account.json"
if (Test-Path $keyPath) {
    $env:DATABASE_ENABLED = "true"
    $env:DATABASE_BACKEND = "rtdb"
    $env:FIREBASE_PROJECT_ID = $ProjectId
    $env:FIREBASE_DATABASE_URL = $DatabaseUrl
    $env:GOOGLE_APPLICATION_CREDENTIALS = $keyPath
    # Without a salt, client IPs are dropped rather than stored as a
    # brute-forceable hash. Fine locally; set a real one in production.
    $env:IP_HASH_SALT = "local-salt-not-secret"
    Write-Host "Persistence ON  -> $DatabaseUrl (key: secrets\service-account.json)" -ForegroundColor Green
} else {
    $env:DATABASE_ENABLED = "false"
    Write-Host "Persistence OFF -> no secrets\service-account.json found." -ForegroundColor Yellow
    Write-Host "  Firebase console -> Project settings -> Service accounts -> Generate new private key," -ForegroundColor Yellow
    Write-Host "  save it as secrets\service-account.json (gitignored), then rerun this script." -ForegroundColor Yellow
}

Write-Host "Loading models (about 10s), then serving on http://127.0.0.1:$Port" -ForegroundColor Cyan

& $Python -W ignore -c @"
from mbpp import create_app
app = create_app('development', {'DEBUG': False})
app.run(host='127.0.0.1', port=$Port, debug=False, use_reloader=False, threaded=True)
"@
