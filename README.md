# Instant Context Website

Professional landing page for Instant Context app.

## What's Inside

- `index.html` - Beautiful, responsive landing page with app info and testing CTA
- `app-ads.txt` - AdMob verification file

## Deploy to Vercel (Free)

### Step 1: Prepare
1. Install Git if you don't have it: https://git-scm.com
2. Open PowerShell in this folder (`website`)

### Step 2: Deploy (Choose One Method)

**Method A: Upload via Vercel Dashboard (Easiest)**
1. Go to https://vercel.com (sign up with GitHub/Google/email)
2. Click "Add New" → "Project"
3. Click "Deploy" (under "Just want to deploy from Git?")
4. Drag & drop this folder (`website`) onto the upload area
5. Wait 30 seconds for deployment
6. You'll get a URL like: `https://instantcontext.vercel.app`

**Method B: Deploy via Vercel CLI**
1. Install Vercel CLI: `npm install -g vercel`
2. In PowerShell, run: `vercel` (in this `website` folder)
3. Follow prompts (accept defaults)
4. Done!

### Step 3: Update Play Store & AdMob

1. Go to [Google Play Console](https://play.google.com/console)
2. Select "Instant Context"
3. Go to **Store listing** → **Store presence**
4. Add your Vercel URL as "Developer website"
   - Example: `https://instantcontext.vercel.app`

2. Go to [AdMob](https://admob.google.com)
3. Click "Verify app"
4. Click "Check for updates"
5. ✅ Verified!

## What the Site Does

- ✅ Professional landing page for your app
- ✅ Hosts `app-ads.txt` for AdMob verification
- ✅ Free forever (Vercel hobby tier)
- ✅ Auto-deployed when you update files
- ✅ Custom domain ready (if you want)

## Need Changes?

Edit `index.html` on your local machine, then:
- **Method A:** Drag & drop to Vercel dashboard again
- **Method B:** Run `vercel --prod` in PowerShell

That's it! Site auto-updates in 30 seconds.
