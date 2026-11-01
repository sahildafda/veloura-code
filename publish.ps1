# Veloura Code Release & Publish Script
Write-Host "✦ Veloura Code Release Pipeline" -ForegroundColor Cyan

# 1. Run Tests & Linter
Write-Host "`nStep 1: Running linter and automated tests..." -ForegroundColor Yellow
npm run lint
if ($LASTEXITCODE -ne 0) {
    Write-Host "Lint failed! Aborting publish." -ForegroundColor Red
    exit 1
}

npm test
if ($LASTEXITCODE -ne 0) {
    Write-Host "Tests failed! Aborting publish." -ForegroundColor Red
    exit 1
}

# 2. Build Production Bundle
Write-Host "`nStep 2: Building production bundle..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed! Aborting publish." -ForegroundColor Red
    exit 1
}

# 3. Check NPM Auth
Write-Host "`nStep 3: Checking NPM authentication..." -ForegroundColor Yellow
$whoami = npm whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "You are not logged into npm. Please log in:" -ForegroundColor Yellow
    npm login
} else {
    Write-Host "Logged into npm as: $whoami" -ForegroundColor Green
}

# 4. Publish to NPM
Write-Host "`nStep 4: Publishing veloura-code to NPM registry..." -ForegroundColor Yellow
npm publish --access public
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✓ Successfully published veloura-code to npm!" -ForegroundColor Green
    Write-Host "  URL: https://www.npmjs.com/package/veloura-code" -ForegroundColor Cyan
} else {
    Write-Host "`nNPM publish did not succeed. Check errors above." -ForegroundColor Red
}

# 5. Push to GitHub
Write-Host "`nStep 5: Pushing code to GitHub..." -ForegroundColor Yellow
git push -u origin main
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✓ Successfully pushed code to GitHub!" -ForegroundColor Green
    Write-Host "  URL: https://github.com/sahildafda/veloura-code" -ForegroundColor Cyan
} else {
    Write-Host "Make sure the repository 'veloura-code' is created at https://github.com/new before pushing." -ForegroundColor Yellow
}
