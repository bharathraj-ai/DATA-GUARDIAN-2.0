const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src/app/globals.css');
let css = fs.readFileSync(cssPath, 'utf8');

// 1. Update root variables for light mode / monochrome enterprise
css = css.replace(/:root\s*\{[^}]+\}/m, `:root {
  --primary-blue: #111111;
  --primary-blue-dark: #000000;
  --accent-cyan: #111111;
  --accent-purple: #111111;
  --dark-bg: #FFFFFF;
  --darker-bg: #FAFAFA;
  --card-bg: #FFFFFF;
  --border-color: #E5E7EB;
  --text-primary: #111111;
  --text-secondary: #6B7280;
  --text-muted: #9CA3AF;
  --success: #10B981;
  --warning: #F59E0B;
  --danger: #EF4444;
  --bg-tertiary: #F3F4F6;
}`);

// 2. Remove backdrop-filters (glassmorphism)
css = css.replace(/backdrop-filter:[^;]+;/g, '');

// 3. Remove text gradients and linear-gradients
css = css.replace(/background:\s*linear-gradient\([^;]+\);/g, 'background: transparent;');
css = css.replace(/background-image:\s*linear-gradient\([^;]+\);/g, 'background-image: none;');
css = css.replace(/-webkit-background-clip:[^;]+;/g, '');
css = css.replace(/-webkit-text-fill-color:[^;]+;/g, '');
css = css.replace(/background-clip:[^;]+;/g, '');

// Restore specific backgrounds that we just broke
// Buttons
css = css.replace(/\.btn-primary\s*\{[^\}]+\}/g, `.btn-primary { background: var(--primary-blue); color: #fff; box-shadow: none; border: 1px solid var(--primary-blue); }`);
css = css.replace(/\.btn-primary:hover\s*\{[^\}]+\}/g, `.btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); background: var(--primary-blue-dark); }`);
css = css.replace(/\.btn-secondary\s*\{[^\}]+\}/g, `.btn-secondary { background: #FFFFFF; color: var(--text-primary); border: 1px solid var(--border-color); box-shadow: 0 1px 2px rgba(0,0,0,0.05); }`);
css = css.replace(/\.btn-secondary:hover\s*\{[^\}]+\}/g, `.btn-secondary:hover { background: #F9FAFB; transform: translateY(-1px); }`);

// Nav
css = css.replace(/\.navbar\s*\{[^\}]+\}/g, `.navbar { position: fixed; top: 0; left: 0; right: 0; height: 72px; z-index: 2000; background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border-color); transition: all 0.3s ease; }`);
css = css.replace(/\.navbar-scrolled\s*\{[^\}]+\}/g, `.navbar-scrolled { height: 60px; background: rgba(255, 255, 255, 0.98); box-shadow: 0 1px 3px rgba(0,0,0,0.05); }`);

// Remove floating/glowing
css = css.replace(/animation:\s*float[^;]+;/g, '');
css = css.replace(/animation:\s*glow[^;]+;/g, '');

// Cards
css = css.replace(/box-shadow:.+;/g, 'box-shadow: 0 1px 3px rgba(0,0,0,0.05);');
css = css.replace(/background:\s*rgba\(15,\s*23,\s*42,\s*[^)]+\);/g, 'background: #FFFFFF;');
css = css.replace(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.0[0-9]+\);/g, 'background: #F4F4F5;');

fs.writeFileSync(cssPath, css, 'utf8');
console.log('CSS Re-themed');
