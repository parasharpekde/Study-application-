// FlowState - GitHub Push Utility via REST API
const fs = require('fs');
const path = require('path');
const https = require('https');

const OWNER = 'parasharpekde';
const REPO = 'Study-application-';
const BRANCH = 'main';
const TOKEN = process.env.GITHUB_TOKEN || process.argv[2];

if (!TOKEN) {
  console.error('❌ Error: Please provide a GitHub Token (e.g. node scripts/github-push.js ghp_yourTokenHere)');
  process.exit(1);
}

const FILES_TO_PUSH = [
  'index.html',
  'login.html',
  'server.js',
  'sw.js',
  'manifest.json',
  'supabase-schema.sql',
  'README.md',
  '.gitignore',
  'css/main.css',
  'css/timer.css',
  'css/audio.css',
  'css/squad.css',
  'css/analytics.css',
  'js/app.js',
  'js/login.js',
  'js/state.js',
  'js/timer.js',
  'js/audio-engine.js',
  'js/task-logger.js',
  'js/squad-engine.js',
  'js/analytics-engine.js',
  'js/supabase-client.js',
  'js/auth-engine.js',
  'js/custom-audio-db.js',
  'js/offline-sync-manager.js'
];

function githubRequest(endpoint, method, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`);
    const bodyStr = data ? JSON.stringify(data) : null;

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'User-Agent': 'FlowState-Uploader',
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };

    if (bodyStr) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject({ status: res.statusCode, data: parsed });
          }
        } catch (e) {
          resolve(chunks);
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function uploadFile(relPath) {
  const fullPath = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`File not found: ${relPath}`);
    return;
  }

  const content = fs.readFileSync(fullPath);
  const base64Content = content.toString('base64');

  // Check if file already exists to get sha
  let existingSha = null;
  try {
    const existing = await githubRequest(`/repos/${OWNER}/${REPO}/contents/${relPath}?ref=${BRANCH}`, 'GET');
    if (existing && existing.sha) {
      existingSha = existing.sha;
    }
  } catch (e) {
    // File does not exist yet
  }

  const payload = {
    message: `Add ${relPath}`,
    content: base64Content,
    branch: BRANCH
  };
  if (existingSha) {
    payload.sha = existingSha;
  }

  try {
    await githubRequest(`/repos/${OWNER}/${REPO}/contents/${relPath}`, 'PUT', payload);
    console.log(`✅ Uploaded: ${relPath}`);
  } catch (err) {
    console.error(`❌ Failed ${relPath}:`, err.data ? err.data.message : err);
  }
}

async function run() {
  console.log(`🚀 Pushing FlowState to https://github.com/${OWNER}/${REPO} on branch [${BRANCH}]...`);
  for (const file of FILES_TO_PUSH) {
    await uploadFile(file);
  }
  console.log(`\n🎉 All files pushed successfully to https://github.com/${OWNER}/${REPO}!`);

  try {
    await githubRequest(`/repos/${OWNER}/${REPO}/pages`, 'POST', {
      source: { branch: BRANCH, path: '/' }
    });
    console.log(`🌐 GitHub Pages enabled! Live at: https://${OWNER}.github.io/${REPO}/`);
  } catch (pagesErr) {
    console.log(`🌐 GitHub Pages URL: https://${OWNER}.github.io/${REPO}/`);
  }
}

run();
