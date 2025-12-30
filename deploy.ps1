# Instant Context Website - Auto Deploy Script
# This script pushes your website to GitHub and deploys to Vercel

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Instant Context Website - Auto Deploy" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Git is installed
$gitInstalled = git --version 2>$null
if (-not $gitInstalled) {
    Write-Host "❌ Git is not installed. Install from: https://git-scm.com" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Git found" -ForegroundColor Green

# Get GitHub username
$githubUser = Read-Host "Enter your GitHub username"
if (-not $githubUser) {
    Write-Host "❌ GitHub username required" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor Yellow
Write-Host "1. Go to https://github.com/new" -ForegroundColor White
Write-Host "2. Create a NEW repository named: instantcontext-website" -ForegroundColor White
Write-Host "3. Click 'Create repository'" -ForegroundColor White
Write-Host "4. Press ENTER here when done..." -ForegroundColor White
Read-Host

Write-Host ""
Write-Host "🚀 Initializing Git repository..." -ForegroundColor Cyan

# Initialize Git repo
git init
git config user.email "dev@instantcontext.app"
git config user.name "Instant Context Developer"

Write-Host "📦 Adding files..." -ForegroundColor Cyan
git add .

Write-Host "💾 Creating commit..." -ForegroundColor Cyan
git commit -m "Initial commit: Instant Context website and AdMob verification"

Write-Host "🔗 Setting remote origin..." -ForegroundColor Cyan
$repoUrl = "https://github.com/$githubUser/instantcontext-website.git"
git remote add origin $repoUrl

Write-Host "📤 Pushing to GitHub..." -ForegroundColor Cyan
$branch = git rev-parse --abbrev-ref HEAD
git branch -M main
git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Successfully pushed to GitHub!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Your repo URL:" -ForegroundColor Yellow
    Write-Host "   $repoUrl" -ForegroundColor White
    Write-Host ""
    Write-Host "🚀 Next: Deploy to Vercel" -ForegroundColor Yellow
    Write-Host "1. Go to https://vercel.com" -ForegroundColor White
    Write-Host "2. Click 'Add New' → 'Project'" -ForegroundColor White
    Write-Host "3. Click 'Import Project'" -ForegroundColor White
    Write-Host "4. Paste this URL: $repoUrl" -ForegroundColor White
    Write-Host "5. Click 'Import' and wait for deployment" -ForegroundColor White
    Write-Host ""
    Write-Host "📌 After deployment, Vercel will give you a URL like:" -ForegroundColor White
    Write-Host "   https://instantcontext.vercel.app" -ForegroundColor White
    Write-Host ""
    Write-Host "Then add that URL to:" -ForegroundColor Yellow
    Write-Host "1. Google Play Console → Store listing → Developer website" -ForegroundColor White
    Write-Host "2. AdMob → Click 'Verify app' → Click 'Check for updates'" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "❌ Git push failed. Check your GitHub credentials." -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
