const fs = require('fs');
const path = './src/App.jsx';
let appStr = fs.readFileSync(path, 'utf8');

// 1. Remove dark mode state and toggle
// Replace the useState for darkMode with just a constant or remove it.
appStr = appStr.replace(/const \[darkMode, setDarkMode\] = useState\([\s\S]*?\}\);\s*// Updated document theme[\s\S]*?\}, \[darkMode\]\);/m, '');
appStr = appStr.replace(/const \[darkMode, setDarkMode\].*?;/, '');

// Find the toggle button and remove it
const buttonRegex = /<button[^>]*onClick=\{\(\) => \{\s*setDarkMode\(!darkMode\);\s*Haptics\.impact\(\{ style: ImpactStyle\.Light \}\);\s*\}\}[\s\S]*?<\/button>/m;
appStr = appStr.replace(buttonRegex, '');

// Clean up any remaining dark: classes
appStr = appStr.replace(/dark:[^\s"']+/g, '');

// Also clean up any lingering text-white that should be text-black on light bg
// Check some specific instances:
// "bg-sand-100 text-black" 

fs.writeFileSync(path, appStr);
console.log('Removed dark mode from App.jsx');
